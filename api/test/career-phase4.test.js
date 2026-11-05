import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canTransitionApplication } from "../src/careerApplications.js";
import { registerCareerRoutes } from "../src/careerRoutes.js";

const job = (id, fitScore, eligibility) => ({
  id,
  source_key: "jobicy",
  source_name: "Jobicy",
  attribution_text: "Jobicy",
  source_job_id: `${id}-source`,
  url: `https://careers.example.test/jobs/${id}`,
  title: `Security analyst ${id}`,
  company: "Example Security Ltd",
  location_text: "Kenya",
  remote_scope_text: "",
  description_text: "Listing text",
  tags: [],
  posted_at: null,
  first_seen_at: new Date().toISOString(),
  status: "screened",
  risk_assessment: "not yet assessed",
  assessment: {
    eligibility,
    eligibility_evidence: [{ phrase: "Kenya" }],
    fit_score: fitScore,
    fit_breakdown: {},
    matched: [],
    missing: [],
    reason_codes: [],
    uncertainty: [],
  },
  fit_score: fitScore,
  eligibility,
});

function createDb({ qualifiedRows = [], dailyCap = 2 } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      queries.push({ statement, values });
      if (statement.startsWith("SELECT table_name FROM information_schema.tables")) {
        const absent = new Set(["jr_application_packets", "jr_gmail_oauth_states", "jr_gmail_credentials"]);
        return { rows: values[0].filter((table_name) => !absent.has(table_name)).map((table_name) => ({ table_name })) };
      }
      if (statement.startsWith("SELECT score_threshold, max_packets_per_day")) {
        return { rows: [{ score_threshold: 65, max_packets_per_day: dailyCap }] };
      }
      if (statement.startsWith("SELECT status, count(*)::integer AS count")) {
        return { rows: [{ status: "screened", count: 4 }] };
      }
      if (statement.startsWith("SELECT state, count(*)::integer AS count")) {
        return { rows: [{ state: "shortlisted", count: 2 }] };
      }
      if (statement.startsWith("SELECT max(finished_at) AS last_success_at")) {
        return { rows: [{ last_success_at: new Date().toISOString() }] };
      }
      if (statement.startsWith("SELECT s.key, s.name, s.enabled")) return { rows: [] };
      if (statement.startsWith("SELECT count(*)::integer AS count FROM public.jr_jobs WHERE status")) {
        return { rows: [{ count: 3 }] };
      }
      if (statement.startsWith("SELECT count(*)::integer AS count FROM public.jr_jobs WHERE first_seen_at")) {
        return { rows: [{ count: 4 }] };
      }
      if (statement.startsWith("SELECT j.id, j.source_key, s.name AS source_name")) {
        return { rows: qualifiedRows };
      }
      if (statement.startsWith("INSERT INTO public.jr_audit_events")) return { rows: [] };
      throw new Error(`Unexpected Phase 4 query: ${statement}`);
    },
  };
}

async function createFixture(options = {}) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  const db = createDb(options);
  const requireAdmin = (req, res, next) => {
    if (req.get("x-test-admin") !== "yes") return res.status(401).json({ error: "Admin session required." });
    next();
  };
  const requireSameOrigin = (req, res, next) => {
    if (req.get("origin") !== "http://localhost:3000") return res.status(403).json({ error: "Origin rejected." });
    next();
  };
  const requireCsrfToken = (req, res, next) => {
    if (req.get("x-csrf-token") !== "test-csrf") return res.status(403).json({ error: "CSRF rejected." });
    next();
  };
  const applicationService = {
    async list() { return []; },
    async get() { return { id: "00000000-0000-4000-8000-000000000001" }; },
    async events() { return []; },
    async create() { return { application: { id: "application-id" } }; },
    async changeState(_id, state) {
      return state === "shortlisted"
        ? { application: { id: "application-id", state } }
        : { invalidTransition: true, previousState: "discovered" };
    },
    async updateDetails() { return {}; },
  };
  registerCareerRoutes(app, db, { requireAdmin, requireSameOrigin, requireCsrfToken }, {
    applicationService,
    assessmentService: { async assessJob() {}, async reassessAll() { return { assessed: 0, failed: 0 }; } },
    runService: { async start() { return { started: true }; } },
  });
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    db,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    request: (path, { method = "GET", body, admin = false, origin = "http://localhost:3000", csrf = true } = {}) => fetch(
      `http://127.0.0.1:${address.port}${path}`,
      {
        method,
        headers: {
          ...(origin ? { Origin: origin } : {}),
          ...(admin ? { "X-Test-Admin": "yes" } : {}),
          ...(csrf ? { "X-CSRF-Token": "test-csrf" } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    ),
  };
}

const admin = { admin: true };

test("Phase 4 overview counts, shortlists to the cap, and does not pad", async () => {
  const first = await createFixture({
    dailyCap: 2,
    qualifiedRows: [
      job("job-1", 94, "eligible"),
      job("job-2", 85, "unknown"),
      job("job-3", 75, "unknown"),
    ],
  });
  try {
    const response = await first.request("/api/admin/career/overview", admin);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.review_count, 3);
    assert.equal(result.new_jobs_count, 4);
    assert.equal(result.applications_by_state.shortlisted, 2);
    assert.equal(result.shortlist.length, 2);
    assert.equal(result.qualified.length, 0);
    assert.equal(result.maybe.length, 1);
    assert.equal(result.shortlist[0].risk_assessment.risk_level, "low");
    assert.match(result.shortlist[0].risk_assessment.label, /not proof of legitimacy/i);
    const shortlistQuery = first.db.queries.find(({ statement }) => statement.startsWith("SELECT j.id, j.source_key, s.name AS source_name"));
    assert.deepEqual(shortlistQuery.values.slice(1), [65]);
    assert.match(shortlistQuery.statement, /a\.fit_score >= \$2/);
    assert.match(shortlistQuery.statement, /a\.eligibility IN \('eligible', 'unknown'\)/);
    assert.match(shortlistQuery.statement, /first_seen_at >= .*Africa\/Nairobi/);
  } finally {
    await first.close();
  }

  const second = await createFixture({ dailyCap: 5, qualifiedRows: [job("job-4", 90, "eligible")] });
  try {
    const response = await second.request("/api/admin/career/overview", admin);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).shortlist.length, 1);
  } finally {
    await second.close();
  }
});

test("Phase 4 routes require admin session, same-origin, and CSRF", async () => {
  const fixture = await createFixture();
  try {
    const applicationId = "00000000-0000-4000-8000-000000000001";
    for (const [path, method] of [
      ["/api/admin/career/overview", "GET"],
      ["/api/admin/career/applications", "GET"],
      [`/api/admin/career/applications/${applicationId}`, "GET"],
      [`/api/admin/career/applications/${applicationId}/events`, "GET"],
      [`/api/admin/career/applications/${applicationId}/state`, "PATCH"],
    ]) {
      const response = await fixture.request(path, {
        method,
        ...(method === "GET" ? {} : { body: {} }),
        admin: false,
      });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }

    const mutations = [
      [`/api/admin/career/jobs/${applicationId}/status`, "PATCH", { status: "shortlisted" }],
      ["/api/admin/career/applications", "POST", { job_id: applicationId }],
      [`/api/admin/career/applications/${applicationId}/state`, "PATCH", { state: "shortlisted" }],
      [`/api/admin/career/applications/${applicationId}`, "PATCH", { private_notes: "test note" }],
    ];
    for (const [path, method, body] of mutations) {
      const noOrigin = await fixture.request(path, { method, body, ...admin, origin: null });
      assert.equal(noOrigin.status, 403, `${method} ${path} without Origin`);
      const noCsrf = await fixture.request(path, { method, body, ...admin, csrf: false });
      assert.equal(noCsrf.status, 403, `${method} ${path} without CSRF`);
      assert.equal(noCsrf.headers.get("cache-control"), "no-store");
    }

    const invalidCreate = await fixture.request("/api/admin/career/applications", {
      method: "POST",
      body: { job_id: "not-a-uuid" },
      ...admin,
    });
    assert.equal(invalidCreate.status, 400);
    const badStatus = await fixture.request("/api/admin/career/jobs/00000000-0000-4000-8000-000000000001/status", {
      method: "PATCH",
      ...admin,
      body: { status: "sent" },
    });
    assert.equal(badStatus.status, 400);
  } finally {
    await fixture.close();
  }
});

test("application state rules allow expected review and reject protected or invalid transitions", async () => {
  assert.equal(canTransitionApplication("discovered", "shortlisted"), true);
  assert.equal(canTransitionApplication("discovered", "approved_to_send"), false);
  assert.equal(canTransitionApplication("discovered", "sent"), false);
  assert.equal(canTransitionApplication("discovered", "submitted"), false);

  const fixture = await createFixture();
  try {
    const id = "00000000-0000-4000-8000-000000000001";
    for (const state of ["approved_to_send", "sent"]) {
      const response = await fixture.request(`/api/admin/career/applications/${id}/state`, {
        method: "PATCH",
        body: { state },
        ...admin,
      });
      assert.equal(response.status, 409);
    }
    const invalid = await fixture.request(`/api/admin/career/applications/${id}/state`, {
      method: "PATCH",
      body: { state: "submitted" },
      ...admin,
    });
    assert.equal(invalid.status, 409);
  } finally {
    await fixture.close();
  }
});

test("Phase 4 SQL is additive, private, idempotent, and event records are append-only", () => {
  const sql = readFileSync(new URL("../../docs/career-automation/sql/phase-4.sql", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../migrations/007_career_applications.sql", import.meta.url), "utf8");
  const verify = readFileSync(new URL("../../docs/career-automation/sql/phase-4.verify.sql", import.meta.url), "utf8");
  const phase3Verify = readFileSync(new URL("../../docs/career-automation/sql/phase-3a.verify.sql", import.meta.url), "utf8");
  assert.equal(sql, migration);
  assert.match(sql, /^\s*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /\b(?:DROP|ALTER)\s+TABLE\s+public\.(?!jr_)[a-z_]+/i);
  const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(jr_[a-z_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(tables, ["jr_applications", "jr_application_events"]);
  for (const table of tables) {
    const creation = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table}`);
    const rls = sql.indexOf(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    const revoke = sql.indexOf(`REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`);
    assert.ok(rls > creation, `${table} enables RLS after creation`);
    assert.ok(revoke > rls, `${table} revokes public and client roles after RLS`);
  }
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.jr_application_events/);
  assert.match(sql, /RAISE EXCEPTION/);
  assert.match(verify, /c\.relname AS table_name/);
  assert.match(verify, /ORDER BY c\.relname/);
  assert.match(phase3Verify, /c\.relname AS table_name/);
  assert.match(phase3Verify, /ORDER BY c\.relname/);
  assert.match(phase3Verify, /has_table_privilege\('authenticated', c\.oid/);
});

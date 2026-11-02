import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { registerCareerRoutes } from "../src/careerRoutes.js";

const jobId = "00000000-0000-4000-8000-000000000001";
const riskColumns = [
  "risk_level", "risk_findings", "risk_confidence", "unknowns", "url_checks", "risk_assessed_at",
];
const cacheColumns = [
  "domain", "checked_at", "rdap_age_days", "dns_ok", "https_ok", "ats_provider", "expires_at",
];

function createDb({ riskSqlInstalled = true } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      queries.push({ statement, values });
      if (statement.startsWith("SELECT table_name FROM information_schema.tables")) {
        return { rows: values[0].map((table_name) => ({ table_name })) };
      }
      if (statement.startsWith("SELECT table_name, column_name FROM information_schema.columns")) {
        if (!riskSqlInstalled) return { rows: [] };
        return {
          rows: [
            ...riskColumns.map((column_name) => ({ table_name: "jr_assessments", column_name })),
            ...cacheColumns.map((column_name) => ({ table_name: "jr_domain_cache", column_name })),
          ],
        };
      }
      if (statement.startsWith("INSERT INTO public.jr_audit_events")) return { rows: [] };
      throw new Error(`Unexpected Phase 3B query: ${statement}`);
    },
  };
}

async function createFixture(options = {}) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  const db = createDb(options);
  const requireAdmin = (req, res, next) => req.get("x-test-admin") === "yes"
    ? next()
    : res.status(401).json({ error: "Admin session required." });
  const requireSameOrigin = (req, res, next) => req.get("origin") === "http://localhost:3000"
    ? next()
    : res.status(403).json({ error: "Origin rejected." });
  const requireCsrfToken = (req, res, next) => req.get("x-csrf-token") === "test-csrf"
    ? next()
    : res.status(403).json({ error: "CSRF rejected." });
  let inspections = 0;
  registerCareerRoutes(app, db, { requireAdmin, requireSameOrigin, requireCsrfToken }, {
    riskService: {
      async assessJob(id) {
        inspections++;
        return { risk_level: "needs_manual_verification", job_id: id };
      },
    },
    assessmentService: { async assessJob() {}, async reassessAll() { return { assessed: 0, failed: 0 }; } },
    applicationService: {},
    runService: {},
  });
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    db,
    get inspections() { return inspections; },
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

test("manual link inspection is admin-only, CSRF protected, validated, and audited", async () => {
  const fixture = await createFixture();
  const path = `/api/admin/career/jobs/${jobId}/inspect-link`;
  try {
    const unauthenticated = await fixture.request(path, { method: "POST", body: {} });
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get("cache-control"), "no-store");

    const noCsrf = await fixture.request(path, { method: "POST", body: {}, admin: true, csrf: false });
    assert.equal(noCsrf.status, 403);
    assert.equal(fixture.inspections, 0);

    const noOrigin = await fixture.request(path, { method: "POST", body: {}, admin: true, origin: null });
    assert.equal(noOrigin.status, 403);
    assert.equal(fixture.inspections, 0);

    const invalid = await fixture.request("/api/admin/career/jobs/not-a-uuid/inspect-link", {
      method: "POST", body: {}, admin: true,
    });
    assert.equal(invalid.status, 400);
    assert.equal(fixture.inspections, 0);

    const response = await fixture.request(path, { method: "POST", body: {}, admin: true });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      risk_level: "needs_manual_verification",
      job_id: jobId,
    });
    assert.equal(fixture.inspections, 1);
    assert.ok(fixture.db.queries.some(({ statement, values }) =>
      statement.startsWith("INSERT INTO public.jr_audit_events") && values[0].includes(jobId)));
  } finally {
    await fixture.close();
  }
});

test("manual link inspection reports uninstalled Phase 3B SQL without invoking inspector", async () => {
  const fixture = await createFixture({ riskSqlInstalled: false });
  try {
    const response = await fixture.request(`/api/admin/career/jobs/${jobId}/inspect-link`, {
      method: "POST", body: {}, admin: true,
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /phase-3b\.sql/);
    assert.equal(fixture.inspections, 0);
  } finally {
    await fixture.close();
  }
});

test("Phase 3B SQL is additive, idempotent, private, and copied exactly to migrations", () => {
  const sql = readFileSync(new URL("../../docs/career-automation/sql/phase-3b.sql", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../migrations/008_career_risk.sql", import.meta.url), "utf8");
  const verify = readFileSync(new URL("../../docs/career-automation/sql/phase-3b.verify.sql", import.meta.url), "utf8");
  const rollback = readFileSync(new URL("../../docs/career-automation/sql/phase-3b.rollback.sql", import.meta.url), "utf8");
  assert.equal(sql, migration);
  assert.match(sql, /^\s*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /\b(?:DROP|ALTER)\s+TABLE\s+public\.(?!jr_)[a-z_]+/i);
  assert.doesNotMatch(sql, /CREATE\s+POLICY/i);
  assert.match(sql, /ALTER TABLE public\.jr_assessments[\s\S]*?ADD COLUMN IF NOT EXISTS risk_assessed_at/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.jr_domain_cache/);
  const creation = sql.indexOf("CREATE TABLE IF NOT EXISTS public.jr_domain_cache");
  const rls = sql.indexOf("ALTER TABLE public.jr_domain_cache ENABLE ROW LEVEL SECURITY");
  const revoke = sql.indexOf("REVOKE ALL PRIVILEGES ON TABLE public.jr_domain_cache FROM PUBLIC, anon, authenticated;");
  assert.ok(rls > creation);
  assert.ok(revoke > rls);
  assert.match(verify, /has_table_privilege\('anon', c\.oid/);
  assert.match(verify, /has_table_privilege\('authenticated', c\.oid/);
  assert.match(verify, /c\.relname AS table_name/);
  assert.match(verify, /ORDER BY c\.relname/);
  assert.match(rollback, /^\s*-- manual, never auto-run/);
  assert.doesNotMatch(rollback, /\b(?:DROP|ALTER)\s+TABLE\s+public\.(?!jr_)[a-z_]+/i);
});

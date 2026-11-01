import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { registerCareerRoutes } from "../src/careerRoutes.js";

const tableNames = [
  "jr_settings",
  "jr_resume_profiles",
  "jr_sources",
  "jr_source_state",
  "jr_runs",
  "jr_audit_events",
];
const sourceRows = [
  { key: "jobicy", name: "Jobicy", private_use_allowed: true, enabled: true },
  { key: "reliefweb", name: "ReliefWeb", private_use_allowed: false, enabled: false },
];

class FakeCareerDatabase {
  tables = new Set(tableNames);
  settings = {
    role_tracks: ["Security Analyst/SOC", "Computer Skills/ICT Trainer"],
    countries: ["Kenya", "Tanzania", "Uganda"],
    remote_eligibility: { Kenya: true },
    score_threshold: 65,
    max_packets_per_day: 5,
    max_sends_per_day: 5,
    timezone: "Africa/Nairobi",
    show_company_name: false,
    public_publishing: false,
    updated_at: new Date().toISOString(),
  };
  profiles = new Map();
  sources = new Map(sourceRows.map((row) => [row.key, { ...row }]));
  runs = new Map();
  audits = [];

  async query(sql, values = []) {
    const statement = sql.replace(/\s+/g, " ").trim();
    if (statement.startsWith("SELECT table_name FROM information_schema.tables")) {
      return { rows: values[0].filter((name) => this.tables.has(name)).map((table_name) => ({ table_name })) };
    }
    if (statement.startsWith("SELECT role_tracks, countries")) return { rows: [{ ...this.settings }] };
    if (statement.startsWith("UPDATE public.jr_settings")) {
      this.settings = {
        role_tracks: values[0], countries: values[1], remote_eligibility: JSON.parse(values[2]),
        score_threshold: values[3], max_packets_per_day: values[4], max_sends_per_day: values[5],
        timezone: values[6], show_company_name: values[7], public_publishing: values[8],
        updated_at: new Date().toISOString(),
      };
      return { rows: [{ ...this.settings }] };
    }
    if (statement.startsWith("SELECT id, name, track, original_text")) {
      return { rows: [...this.profiles.values()] };
    }
    if (statement.startsWith("INSERT INTO public.jr_resume_profiles")) {
      const profile = {
        id: randomUUID(), name: values[0], track: values[1], original_text: values[2],
        verified_facts: JSON.parse(values[3]), created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(), archived_at: null,
      };
      this.profiles.set(profile.id, profile);
      return { rows: [{ ...profile }] };
    }
    if (statement.startsWith("UPDATE public.jr_resume_profiles SET name")) {
      const profile = this.profiles.get(values[3]);
      if (!profile || profile.archived_at) return { rows: [] };
      if (values[0] !== null) profile.name = values[0];
      if (values[1] !== null) profile.track = values[1];
      if (values[2] !== null) profile.verified_facts = JSON.parse(values[2]);
      profile.updated_at = new Date().toISOString();
      return { rows: [{ ...profile }] };
    }
    if (statement.startsWith("UPDATE public.jr_resume_profiles SET archived_at")) {
      const profile = this.profiles.get(values[0]);
      if (!profile || profile.archived_at) return { rows: [] };
      profile.archived_at = new Date().toISOString();
      profile.updated_at = profile.archived_at;
      return { rows: [{ id: profile.id, name: profile.name, track: profile.track, created_at: profile.created_at, updated_at: profile.updated_at, archived_at: profile.archived_at }] };
    }
    if (statement.startsWith("SELECT key, name, terms_url")) {
      return { rows: [...this.sources.values()] };
    }
    if (statement.startsWith("SELECT private_use_allowed FROM public.jr_sources")) {
      const source = this.sources.get(values[0]);
      return { rows: source ? [{ private_use_allowed: source.private_use_allowed }] : [] };
    }
    if (statement.startsWith("UPDATE public.jr_sources")) {
      const source = this.sources.get(values[3]);
      if (!source) return { rows: [] };
      if (values[0] !== null) source.enabled = values[0];
      if (values[2]) source.notes = values[1];
      return { rows: [{ ...source }] };
    }
    if (statement.startsWith("SELECT id, trigger, status")) {
      return { rows: [...this.runs.values()].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 100) };
    }
    if (statement.startsWith("UPDATE public.jr_runs") && statement.includes("stale run interrupted")) {
      for (const run of this.runs.values()) {
        if (run.status === "running" && Date.now() - Date.parse(run.started_at) > 15 * 60 * 1000) run.status = "interrupted";
      }
      return { rows: [] };
    }
    if (statement.startsWith("INSERT INTO public.jr_runs")) {
      return this.insertRun();
    }
    if (statement.startsWith("INSERT INTO public.jr_audit_events")) {
      this.audits.push({ action: statement.includes("run.started") ? "run.started" : "run.succeeded", detail: values[0] });
      return { rows: [] };
    }
    if (statement.startsWith("UPDATE public.jr_runs") && statement.includes("SET status = 'succeeded'")) {
      const run = this.runs.get(values[0]);
      if (run?.status === "running") {
        run.status = "succeeded";
        run.finished_at = new Date().toISOString();
        run.summary = JSON.parse(values[1]);
      }
      return { rows: [] };
    }
    if (statement.startsWith("UPDATE public.jr_runs") && statement.includes("SET status = 'failed'")) {
      const run = this.runs.get(values[0]);
      if (run?.status === "running") run.status = "failed";
      return { rows: [] };
    }
    throw new Error(`Unexpected career query: ${statement}`);
  }

  connect() {
    let activeRunId;
    return Promise.resolve({
      query: async (sql, values = []) => {
        const statement = sql.replace(/\s+/g, " ").trim();
        if (statement === "BEGIN" || statement === "COMMIT") return { rows: [] };
        if (statement === "ROLLBACK") {
          if (activeRunId) this.runs.delete(activeRunId);
          return { rows: [] };
        }
        if (statement.startsWith("UPDATE public.jr_runs")) return this.query(sql, values);
        if (statement.startsWith("INSERT INTO public.jr_runs")) {
          const result = await this.insertRun();
          activeRunId = result.rows[0].id;
          return result;
        }
        return this.query(sql, values);
      },
      release() {},
    });
  }

  async insertRun() {
    if ([...this.runs.values()].some((run) => run.status === "running")) {
      const error = new Error("unique run lock");
      error.code = "23505";
      error.constraint = "jr_runs_single_running_idx";
      throw error;
    }
    const run = {
      id: randomUUID(), trigger: "cron", status: "running",
      started_at: new Date().toISOString(), finished_at: null,
      summary: { message: "no adapters yet" },
    };
    this.runs.set(run.id, run);
    return { rows: [{ id: run.id }] };
  }
}

async function createFixture() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  const db = new FakeCareerDatabase();
  const requireAdmin = (req, res, next) => {
    if (req.get("x-test-admin") !== "yes") return res.status(401).json({ error: "Sign in to use the admin area." });
    next();
  };
  const requireSameOrigin = (req, res, next) => {
    if (req.get("origin") !== "http://localhost:3000") return res.status(403).json({ error: "Request origin was not accepted." });
    next();
  };
  const requireCsrfToken = (req, res, next) => {
    if (req.get("x-csrf-token") !== "test-csrf") return res.status(403).json({ error: "Request verification failed." });
    next();
  };
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  registerCareerRoutes(app, db, { requireAdmin, requireSameOrigin, requireCsrfToken });
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    app,
    db,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    request: (path, { method = "GET", body, admin = false, origin = "http://localhost:3000", csrf = true, headers = {} } = {}) => fetch(
      `http://127.0.0.1:${address.port}${path}`,
      {
        method,
        headers: {
          ...(origin ? { Origin: origin } : {}),
          ...(admin ? { "X-Test-Admin": "yes" } : {}),
          ...(csrf ? { "X-CSRF-Token": "test-csrf" } : {}),
          ...(body === undefined || method === "GET" || method === "HEAD" ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...(body === undefined || method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify(body) }),
      },
    ),
  };
}

const authorized = { admin: true };
const mutation = { ...authorized, method: "PUT", body: {} };

test("all career admin routes require an admin session", async () => {
  const fixture = await createFixture();
  try {
    const routes = [
      ["/api/admin/career/setup", "GET"],
      ["/api/admin/career/settings", "GET"],
      ["/api/admin/career/settings", "PUT"],
      ["/api/admin/career/resume-profiles", "GET"],
      ["/api/admin/career/resume-profiles", "POST"],
      ["/api/admin/career/resume-profiles/00000000-0000-4000-8000-000000000001", "PATCH"],
      ["/api/admin/career/resume-profiles/00000000-0000-4000-8000-000000000001/archive", "POST"],
      ["/api/admin/career/sources", "GET"],
      ["/api/admin/career/sources/jobicy", "PATCH"],
      ["/api/admin/career/runs", "GET"],
    ];
    for (const [path, method] of routes) {
      const response = await fixture.request(path, { method, body: {}, admin: false });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  } finally {
    await fixture.close();
  }
});

test("career mutations require same-origin and CSRF", async () => {
  const fixture = await createFixture();
  try {
    for (const [path, method] of [
      ["/api/admin/career/settings", "PUT"],
      ["/api/admin/career/resume-profiles", "POST"],
      ["/api/admin/career/resume-profiles/00000000-0000-4000-8000-000000000001", "PATCH"],
      ["/api/admin/career/resume-profiles/00000000-0000-4000-8000-000000000001/archive", "POST"],
      ["/api/admin/career/sources/jobicy", "PATCH"],
    ]) {
      const noOrigin = await fixture.request(path, { method, body: {}, ...authorized, origin: null });
      assert.equal(noOrigin.status, 403, `${method} ${path} without Origin`);
      const noCsrf = await fixture.request(path, { method, body: {}, ...authorized, csrf: false });
      assert.equal(noCsrf.status, 403, `${method} ${path} without CSRF`);
    }
  } finally {
    await fixture.close();
  }
});

test("setup reports only secret configuration booleans and safe metadata", async () => {
  const secretNames = [
    "JOB_CRON_SECRET", "DOC_ENCRYPTION_KEY", "GMAIL_USER", "GMAIL_APP_PASSWORD",
    "GEMINI_API_KEY", "JOOBLE_API_KEY", "CAREERJET_API_KEY", "RELIEFWEB_APPNAME",
  ];
  const previous = new Map(secretNames.map((name) => [name, process.env[name]]));
  const previousSendMode = process.env.JR_SEND_MODE;
  const fakeValues = new Map(secretNames.map((name) => [name, `test-only-${name}-secret`]));
  try {
    for (const [name, value] of fakeValues) process.env[name] = value;
    process.env.JR_SEND_MODE = "draft";
    const fixture = await createFixture();
    try {
      const response = await fixture.request("/api/admin/career/setup", authorized);
      assert.equal(response.status, 200);
      const text = await response.text();
      const result = JSON.parse(text);
      for (const name of secretNames) {
        assert.deepEqual(result.configuration[name], { configured: true });
        assert.equal(text.includes(fakeValues.get(name)), false);
      }
      assert.equal(result.JR_SEND_MODE, "draft");
      assert.equal(result.tables.configured, true);
    } finally {
      await fixture.close();
    }
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (previousSendMode === undefined) delete process.env.JR_SEND_MODE;
    else process.env.JR_SEND_MODE = previousSendMode;
  }
});

test("resume originals are accepted only at creation and cannot be changed through the API", async () => {
  const fixture = await createFixture();
  try {
    const original = "Verified resume original";
    const created = await fixture.request("/api/admin/career/resume-profiles", {
      ...authorized,
      method: "POST",
      body: { name: "Security profile", track: "Security Analyst/SOC", original_text: original, verified_facts: {} },
    });
    assert.equal(created.status, 201);
    const profile = await created.json();
    const changed = await fixture.request(`/api/admin/career/resume-profiles/${profile.id}`, {
      ...authorized,
      method: "PATCH",
      body: { original_text: "changed" },
    });
    assert.equal(changed.status, 400);
    assert.equal(fixture.db.profiles.get(profile.id).original_text, original);

    const oversized = await fixture.request("/api/admin/career/resume-profiles", {
      ...authorized,
      method: "POST",
      body: { name: "Too large", track: "Security Analyst/SOC", original_text: "x".repeat(60_001) },
    });
    assert.equal(oversized.status, 400);
  } finally {
    await fixture.close();
  }
});

test("settings and source inputs reject invalid fields and unauthorized source enabling", async () => {
  const fixture = await createFixture();
  try {
    const badSettings = await fixture.request("/api/admin/career/settings", {
      ...mutation,
      body: { max_sends_per_day: 6 },
    });
    assert.equal(badSettings.status, 400);
    const badProfile = await fixture.request("/api/admin/career/resume-profiles", {
      ...authorized, method: "POST",
      body: { name: "Bad profile", track: "SOC", original_text: "text", unexpected: true },
    });
    assert.equal(badProfile.status, 400);
    const deniedSource = await fixture.request("/api/admin/career/sources/reliefweb", {
      ...authorized, method: "PATCH", body: { enabled: true },
    });
    assert.equal(deniedSource.status, 409);
  } finally {
    await fixture.close();
  }
});

test("missing career tables return 409 without making unrelated routes unavailable", async () => {
  const fixture = await createFixture();
  try {
    fixture.db.tables.clear();
    const settings = await fixture.request("/api/admin/career/settings", authorized);
    assert.equal(settings.status, 409);
    assert.match((await settings.json()).error, /phase-1\.sql/);
    const setup = await fixture.request("/api/admin/career/setup", authorized);
    assert.equal(setup.status, 200);
    assert.equal((await setup.json()).tables.configured, false);
    const health = await fixture.request("/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
  } finally {
    await fixture.close();
  }
});

test("worker trigger is secret protected, locked, audited, and records the no-adapter result", async () => {
  const previousSecret = process.env.JOB_CRON_SECRET;
  const secret = "local-test-worker-secret";
  try {
    delete process.env.JOB_CRON_SECRET;
    const fixture = await createFixture();
    try {
      assert.equal((await fixture.request("/api/internal/jobs/run", { method: "POST", body: {} })).status, 404);
      process.env.JOB_CRON_SECRET = secret;
      const wrong = await fixture.request("/api/internal/jobs/run", {
        method: "POST", body: {}, headers: { "X-Cron-Secret": `${secret}x` },
      });
      assert.equal(wrong.status, 401);
      const rightLengthWrong = await fixture.request("/api/internal/jobs/run", {
        method: "POST", body: {}, headers: { "X-Cron-Secret": "x".repeat(Buffer.byteLength(secret)) },
      });
      assert.equal(rightLengthWrong.status, 401);
      const oversizedBody = await fixture.request("/api/internal/jobs/run", {
        method: "POST", body: { detail: "x".repeat(1100) }, headers: { "X-Cron-Secret": secret },
      });
      assert.equal(oversizedBody.status, 413);

      const [first, second] = await Promise.all([
        fixture.request("/api/internal/jobs/run", {
          method: "POST", body: {}, headers: { "X-Cron-Secret": secret },
        }),
        fixture.request("/api/internal/jobs/run", {
          method: "POST", body: {}, headers: { "X-Cron-Secret": secret },
        }),
      ]);
      assert.deepEqual([first.status, second.status], [202, 202]);
      const responses = await Promise.all([first.json(), second.json()]);
      assert.equal(responses.filter((item) => item.status === "already_running").length, 1);
      const run = [...fixture.db.runs.values()][0];
      assert.equal(run.status, "running");
      assert.ok(fixture.db.audits.some((event) => event.action === "run.started"));
      await new Promise((resolve) => setTimeout(resolve, 75));
      assert.equal(run.status, "succeeded");
      assert.deepEqual(run.summary, { message: "no adapters yet" });
    } finally {
      await fixture.close();
    }
  } finally {
    if (previousSecret === undefined) delete process.env.JOB_CRON_SECRET;
    else process.env.JOB_CRON_SECRET = previousSecret;
  }
});

test("phase 1 SQL is repeatable, isolated to jr_ tables, and locks table access", () => {
  const sql = readFileSync(new URL("../../docs/career-automation/sql/phase-1.sql", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../migrations/004_career_foundation.sql", import.meta.url), "utf8");
  const runner = readFileSync(new URL("../scripts/migrate.js", import.meta.url), "utf8");
  assert.equal(sql, migration);
  assert.match(runner, /migrations\/004_career_foundation\.sql/);
  assert.match(sql, /^\s*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /\b(?:DROP|ALTER)\s+TABLE\s+public\.(?!jr_)[a-z_]+/i);
  assert.doesNotMatch(sql, /CREATE\s+POLICY/i);
  const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(jr_[a-z_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(tables, tableNames);
  for (const table of tables) {
    const creation = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table}`);
    const rls = sql.indexOf(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    const revoke = sql.indexOf(`REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`);
    assert.ok(rls > creation, `${table} enables RLS`);
    assert.ok(revoke > rls, `${table} revokes client and public grants`);
  }
  const rollback = readFileSync(new URL("../../docs/career-automation/sql/phase-1.rollback.sql", import.meta.url), "utf8");
  assert.match(rollback, /^-- manual, never auto-run/);
  assert.deepEqual([...rollback.matchAll(/DROP TABLE IF EXISTS public\.(jr_[a-z_]+)/gi)].map((match) => match[1]), [...tableNames].reverse());
});

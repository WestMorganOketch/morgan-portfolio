import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createCareerRunService } from "../src/careerRun.js";

class FakeRunDatabase {
  tables = new Set([
    "jr_settings", "jr_resume_profiles", "jr_sources", "jr_source_state",
    "jr_runs", "jr_audit_events", "jr_jobs", "jr_ats_watchlist",
  ]);
  sources = [];
  states = new Map();
  watchlist = [];
  runs = new Map();
  audit = [];
  requests = [];

  async query(sql, values = []) {
    const statement = sql.replace(/\s+/g, " ").trim();
    if (statement.startsWith("SELECT table_name FROM information_schema.tables")) {
      return { rows: values[0].filter((name) => this.tables.has(name)).map((table_name) => ({ table_name })) };
    }
    if (statement.startsWith("SELECT s.key, s.name, s.enabled")) {
      return {
        rows: this.sources.filter((source) => source.enabled).map((source) => ({
          ...source,
          ...(this.states.get(source.key) ?? {}),
        })),
      };
    }
    if (statement.startsWith("SELECT provider, token, label FROM public.jr_ats_watchlist")) {
      return { rows: this.watchlist };
    }
    if (statement.startsWith("INSERT INTO public.jr_source_state")
      && statement.includes("requests_today, window_date") && !statement.includes("last_success_at")) {
      const state = this.states.get(values[0]) ?? { requests_today: 0 };
      state.requests_today = state.window_date === values[1] ? state.requests_today + 1 : 1;
      state.window_date = values[1];
      state.last_attempt_at = new Date().toISOString();
      state.next_allowed_at = new Date(Date.now() + Number(values[2]) * 1000).toISOString();
      this.states.set(values[0], state);
      this.requests.push(values[0]);
      return { rows: [{ requests_today: state.requests_today }] };
    }
    if (statement.startsWith("INSERT INTO public.jr_source_state") && statement.includes("last_success_at")) {
      const state = this.states.get(values[0]) ?? { requests_today: 0 };
      state.last_attempt_at = new Date().toISOString();
      state.last_status = values[1];
      state.window_date = values[2];
      state.last_success_at = values[1] === "succeeded" || values[1] === "partial"
        ? new Date().toISOString()
        : state.last_success_at ?? null;
      state.consecutive_failures = values[1] === "succeeded" || values[1] === "partial"
        ? 0
        : Number(state.consecutive_failures ?? 0) + 1;
      state.next_allowed_at = new Date(Date.now() + Number(values[3]) * 1000).toISOString();
      this.states.set(values[0], state);
      return { rows: [] };
    }
    if (statement.startsWith("UPDATE public.jr_runs") && statement.includes("stale run interrupted")) {
      for (const run of this.runs.values()) {
        if (run.status === "running" && Date.now() - Date.parse(run.started_at) > 15 * 60 * 1000) {
          run.status = "interrupted";
        }
      }
      return { rows: [] };
    }
    if (statement.startsWith("UPDATE public.jr_runs") && statement.includes("SET status = $2")) {
      const run = this.runs.get(values[0]);
      if (run?.status === "running") {
        run.status = values[1];
        run.finished_at = new Date().toISOString();
        run.summary = JSON.parse(values[2]);
      }
      return { rows: [] };
    }
    if (statement.startsWith("INSERT INTO public.jr_audit_events")) {
      this.audit.push(statement.includes("VALUES ('system', $1")
        ? { actor: "system", action: values[0], detail: values[1] }
        : { actor: values[0], action: "run.started", detail: values[1] });
      return { rows: [] };
    }
    throw new Error(`Unexpected run database query: ${statement}`);
  }

  async insertRun(trigger) {
    if ([...this.runs.values()].some((run) => run.status === "running")) {
      const error = new Error("run lock is held");
      error.code = "23505";
      error.constraint = "jr_runs_single_running_idx";
      throw error;
    }
    const run = {
      id: randomUUID(), trigger, status: "running",
      started_at: new Date().toISOString(), finished_at: null, summary: {},
    };
    this.runs.set(run.id, run);
    return { rows: [{ id: run.id }] };
  }

  async connect() {
    return {
      query: async (sql, values = []) => {
        const statement = sql.replace(/\s+/g, " ").trim();
        if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") return { rows: [] };
        if (statement.startsWith("UPDATE public.jr_runs")) return this.query(sql, values);
        if (statement.startsWith("INSERT INTO public.jr_runs")) return this.insertRun(values[0]);
        if (statement.startsWith("INSERT INTO public.jr_audit_events")) {
          this.audit.push({ actor: values[0], action: "run.started", detail: values[1] });
          return { rows: [] };
        }
        return this.query(sql, values);
      },
      release() {},
    };
  }
}

async function waitForRun(db, id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = db.runs.get(id);
    if (run && run.status !== "running") return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Career run did not finish in time.");
}

const source = (key, overrides = {}) => ({
  key,
  name: key,
  enabled: true,
  private_use_allowed: true,
  min_interval_seconds: 0,
  max_requests_per_day: 4,
  ...overrides,
});

test("one source outage is isolated and the next source completes", async () => {
  const db = new FakeRunDatabase();
  db.sources = [source("remoteok"), source("arbeitnow")];
  const saved = [];
  const service = createCareerRunService({
    db,
    adapter: async (key, options) => {
      await options.onRequest();
      if (key === "remoteok") throw new Error("provider unavailable");
      return {
        fetched: 1, discarded: 0, malformed: 0,
        jobs: [{ source_key: key, source_job_id: `${key}-1` }],
      };
    },
    saveJob: async (_database, job) => {
      saved.push(job.source_job_id);
      return { result: "new", id: randomUUID() };
    },
  });
  const started = await service.start("cron");
  assert.equal(started.status, "running");
  const run = await waitForRun(db, started.id);
  assert.equal(run.status, "succeeded");
  assert.match(run.summary.remoteok.error, /provider unavailable/);
  assert.equal(run.summary.arbeitnow.new, 1);
  assert.deepEqual(saved, ["arbeitnow-1"]);
  assert.equal(db.states.get("remoteok").last_status, "failed");
  assert.equal(db.states.get("arbeitnow").last_status, "succeeded");
  assert.ok(db.audit.some((event) => event.action === "run.started"));
  assert.ok(db.audit.some((event) => event.actor === "system"));
});

test("the durable running lock rejects concurrent triggers", async () => {
  const db = new FakeRunDatabase();
  const service = createCareerRunService({ db });
  const [first, second] = await Promise.all([service.start("cron"), service.start("manual")]);
  assert.deepEqual([first.status, second.status].sort(), ["already_running", "running"]);
  const id = first.id ?? second.id;
  assert.equal(await waitForRun(db, id).then((run) => run.status), "succeeded");
  assert.equal(db.runs.size, 1);
});

test("a stale run is marked interrupted before the next run starts", async () => {
  const db = new FakeRunDatabase();
  const staleId = randomUUID();
  db.runs.set(staleId, {
    id: staleId, trigger: "cron", status: "running",
    started_at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    finished_at: null, summary: {},
  });
  const service = createCareerRunService({ db });
  const started = await service.start("manual");
  assert.equal(started.status, "running");
  assert.equal(db.runs.get(staleId).status, "interrupted");
  await waitForRun(db, started.id);
});

test("daily request caps are checked before calling source adapters", async () => {
  const db = new FakeRunDatabase();
  db.sources = [source("remotive", { min_interval_seconds: 21_600 })];
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const date = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
  const today = `${date.year}-${date.month}-${date.day}`;
  db.states.set("remotive", { requests_today: 4, window_date: today });
  let called = false;
  const service = createCareerRunService({
    db,
    adapter: async () => { called = true; return { jobs: [] }; },
  });
  const started = await service.start("cron");
  const run = await waitForRun(db, started.id);
  assert.equal(called, false);
  assert.equal(run.summary.remotive.skipped_reason, "daily request cap reached");
});

test("runs stop as interrupted when their time budget is exceeded", async () => {
  const db = new FakeRunDatabase();
  db.sources = [source("remoteok")];
  let elapsed = 0;
  const service = createCareerRunService({
    db,
    budgetMs: 100,
    now: () => new Date(Date.now() + elapsed),
    adapter: async () => {
      elapsed = 101;
      return { jobs: [], fetched: 0 };
    },
  });
  const started = await service.start("cron");
  const run = await waitForRun(db, started.id);
  assert.equal(run.status, "interrupted");
});

test("missing intake tables reject a run without creating a ledger row", async () => {
  const db = new FakeRunDatabase();
  db.tables.delete("jr_jobs");
  const service = createCareerRunService({ db });
  const result = await service.start("cron");
  assert.equal(result.error, "missing_tables");
  assert.equal(db.runs.size, 0);
});

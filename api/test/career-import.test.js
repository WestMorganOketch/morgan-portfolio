import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { once } from "node:events";
import test from "node:test";
import { registerCareerRoutes } from "../src/careerRoutes.js";
import { normalizeImportedJob, saveCareerJob } from "../src/careerImport.js";
import { atsWatchlistCreateSchema, careerImportSchema } from "../src/careerValidation.js";

class FakeJobDatabase {
  tables = new Set([
    "jr_settings", "jr_resume_profiles", "jr_sources", "jr_source_state",
    "jr_runs", "jr_audit_events", "jr_jobs", "jr_ats_watchlist",
  ]);
  jobs = new Map();
  watchlist = new Map();

  async query(sql, values = []) {
    const statement = sql.replace(/\s+/g, " ").trim();
    if (statement.startsWith("SELECT table_name FROM information_schema.tables")) {
      return { rows: values[0].filter((name) => this.tables.has(name)).map((table_name) => ({ table_name })) };
    }
    if (statement.startsWith("SELECT id, source_key, canonical_key FROM public.jr_jobs")) {
      const row = [...this.jobs.values()].find((job) => job.source_key === values[0] && job.source_job_id === values[1]);
      return { rows: row ? [{ id: row.id, source_key: row.source_key, canonical_key: row.canonical_key }] : [] };
    }
    if (statement.startsWith("SELECT id, source_key, also_listed_on FROM public.jr_jobs WHERE canonical_key")) {
      const row = [...this.jobs.values()].find((job) => job.canonical_key === values[0]);
      return { rows: row ? [{ id: row.id, source_key: row.source_key, also_listed_on: [...row.also_listed_on] }] : [] };
    }
    if (statement.startsWith("UPDATE public.jr_jobs") && statement.includes("also_listed_on = $2")) {
      const row = this.jobs.get(values[0]);
      row.last_seen_at = new Date().toISOString();
      row.also_listed_on = values[1];
      return { rows: [] };
    }
    if (statement.startsWith("UPDATE public.jr_jobs") && statement.includes("SET url = $1")) {
      const row = this.jobs.get(values[11]);
      [
        "url", "title", "company", "location_text", "remote_scope_text", "description_text",
        "salary_text", "tags", "posted_at", "content_hash", "canonical_key",
      ].forEach((key, index) => { row[key] = values[index]; });
      row.last_seen_at = new Date().toISOString();
      return { rows: [{ id: row.id }] };
    }
    if (statement.startsWith("INSERT INTO public.jr_jobs")) {
      const job = {
        id: randomUUID(), source_key: values[0], source_job_id: values[1], url: values[2],
        title: values[3], company: values[4], location_text: values[5], remote_scope_text: values[6],
        description_text: values[7], salary_text: values[8], tags: values[9], posted_at: values[10],
        content_hash: values[11], canonical_key: values[12], also_listed_on: [],
        first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
      };
      this.jobs.set(job.id, job);
      return { rows: [{ id: job.id }] };
    }
    if (statement.startsWith("INSERT INTO public.jr_ats_watchlist")) {
      if ([...this.watchlist.values()].some((row) => row.provider === values[0] && row.token === values[1])) return { rows: [] };
      const row = {
        id: randomUUID(), provider: values[0], token: values[1], label: values[2],
        enabled: true, created_at: new Date().toISOString(),
      };
      this.watchlist.set(row.id, row);
      return { rows: [{ ...row }] };
    }
    if (statement.startsWith("SELECT id, provider, token, label, enabled")) {
      return { rows: [...this.watchlist.values()] };
    }
    if (statement.startsWith("DELETE FROM public.jr_ats_watchlist")) {
      return { rowCount: Number(this.watchlist.delete(values[0])), rows: [] };
    }
    throw new Error(`Unexpected job database query: ${statement}`);
  }
}

async function createFixture() {
  const app = express();
  app.use(express.json({ limit: "32kb", strict: true }));
  const db = new FakeJobDatabase();
  const requireAdmin = (req, res, next) => req.get("x-test-admin") === "yes"
    ? next()
    : res.status(401).json({ error: "Sign in to use the admin area." });
  const requireSameOrigin = (req, res, next) => req.get("origin") === "http://localhost:3000"
    ? next()
    : res.status(403).json({ error: "Request origin was not accepted." });
  const requireCsrfToken = (req, res, next) => req.get("x-csrf-token") === "test-csrf"
    ? next()
    : res.status(403).json({ error: "Request verification failed." });
  registerCareerRoutes(app, db, { requireAdmin, requireSameOrigin, requireCsrfToken }, {
    runService: { start: async () => ({ id: randomUUID(), status: "running" }) },
  });
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    app,
    db,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    request: (path, { method = "GET", body, admin = true, origin = "http://localhost:3000", csrf = true } = {}) => fetch(
      `http://127.0.0.1:${address.port}${path}`,
      {
        method,
        headers: {
          ...(admin ? { "X-Test-Admin": "yes" } : {}),
          ...(origin ? { Origin: origin } : {}),
          ...(csrf ? { "X-CSRF-Token": "test-csrf" } : {}),
          ...(body === undefined || method === "GET" ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined || method === "GET" ? {} : { body: JSON.stringify(body) }),
      },
    ),
  };
}

function importValues(overrides = {}) {
  return {
    title: "ICT Trainer",
    company: "  Skills Lab ",
    url: "https://employer.example/jobs/ict-trainer",
    text: "<p>Teach practical ICT skills.</p>",
    ...overrides,
  };
}

test("manual imports are normalized without fetching the submitted URL", async () => {
  const fixture = await createFixture();
  let externalRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, ...args) => {
    if (new URL(input).hostname !== "127.0.0.1") externalRequests++;
    return originalFetch(input, ...args);
  };
  try {
    const response = await fixture.request("/api/admin/career/import", {
      method: "POST",
      body: importValues(),
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.status, "new");
    const stored = [...fixture.db.jobs.values()][0];
    assert.equal(stored.source_key, "manual_import");
    assert.equal(stored.url, "https://employer.example/jobs/ict-trainer");
    assert.equal(stored.description_text, "Teach practical ICT skills.");
    assert.equal(externalRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await fixture.close();
  }
});

test("manual import validation rejects unsupported URLs, oversized text, and unrelated roles", async () => {
  assert.equal(careerImportSchema.safeParse(importValues({ url: "ftp://example.com/job" })).success, false);
  assert.equal(atsWatchlistCreateSchema.safeParse({ provider: "greenhouse", token: "x", label: "Example" }).success, false);
  const fixture = await createFixture();
  try {
    const badUrl = await fixture.request("/api/admin/career/import", {
      method: "POST", body: importValues({ url: "ftp://example.com/job" }),
    });
    assert.equal(badUrl.status, 400);
    const tooMuchText = await fixture.request("/api/admin/career/import", {
      method: "POST", body: importValues({ text: "x".repeat(6001) }),
    });
    assert.equal(tooMuchText.status, 400);
    const wrongTrack = await fixture.request("/api/admin/career/import", {
      method: "POST", body: importValues({ title: "Accountant" }),
    });
    assert.equal(wrongTrack.status, 422);
    assert.equal(fixture.db.jobs.size, 0);
  } finally {
    await fixture.close();
  }
});

test("manual import rejects unauthenticated and non-CSRF requests", async () => {
  const fixture = await createFixture();
  try {
    const anonymous = await fixture.request("/api/admin/career/import", {
      method: "POST", body: importValues(), admin: false,
    });
    assert.equal(anonymous.status, 401);
    const noOrigin = await fixture.request("/api/admin/career/import", {
      method: "POST", body: importValues(), origin: null,
    });
    assert.equal(noOrigin.status, 403);
    const noCsrf = await fixture.request("/api/admin/career/import", {
      method: "POST", body: importValues(), csrf: false,
    });
    assert.equal(noCsrf.status, 403);
  } finally {
    await fixture.close();
  }
});

test("canonical duplicates preserve the earliest job and append the other source", async () => {
  const db = new FakeJobDatabase();
  const original = normalizeImportedJob(importValues());
  original.source_key = "jobicy";
  original.source_job_id = "jobicy-1";
  const first = await saveCareerJob(db, original);
  assert.equal(first.result, "new");

  const second = {
    ...original,
    source_key: "remoteok",
    source_job_id: "remoteok-1",
    description_text: "A newer copy of the same role.",
  };
  const duplicate = await saveCareerJob(db, second);
  assert.equal(duplicate.result, "duplicate");
  assert.equal(duplicate.id, first.id);
  assert.deepEqual(db.jobs.get(first.id).also_listed_on, ["remoteok"]);
  assert.equal(db.jobs.size, 1);
});

test("a repeat listing from one source updates its existing row", async () => {
  const db = new FakeJobDatabase();
  const job = normalizeImportedJob(importValues());
  job.source_key = "jobicy";
  job.source_job_id = "jobicy-repeat";
  const first = await saveCareerJob(db, job);
  const updated = await saveCareerJob(db, { ...job, description_text: "Updated advert." });
  assert.equal(first.result, "new");
  assert.equal(updated.result, "updated");
  assert.equal(first.id, updated.id);
  assert.equal(db.jobs.get(first.id).description_text, "Updated advert.");
});

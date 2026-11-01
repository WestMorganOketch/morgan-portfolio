import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { atsWatchlistCreateSchema } from "../src/careerValidation.js";
import {
  buildJobIdentity,
  fetchArbeitnow,
  fetchAtsWatchlist,
  fetchJobicy,
  fetchRemoteOk,
  fetchRemotive,
  fetchSourceJson,
  matchesRoleTitle,
  normalizeHttpUrl,
  resetRequestPacingForTests,
  stripHtml,
} from "../src/careerSources.js";
import { sourceSkipReason } from "../src/careerRun.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/career/${name}.json`, import.meta.url), "utf8"));
const jsonResponse = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json", ...headers },
});

test("Jobicy normalizes valid matches, skips malformed rows, and counts irrelevant titles", async () => {
  resetRequestPacingForTests();
  const result = await fetchJobicy({
    fetchImpl: async (url, init) => {
      assert.equal(url.href, "https://jobicy.com/api/jobs");
      assert.equal(init.redirect, "manual");
      return jsonResponse(fixture("jobicy"));
    },
  });
  assert.equal(result.fetched, 3);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.discarded, 1);
  assert.equal(result.malformed, 1);
  assert.equal(result.jobs[0].source_key, "jobicy");
  assert.equal(result.jobs[0].url, "https://jobicy.com/jobs/101");
  assert.equal(result.jobs[0].description_text, "Monitor alerts & investigate incidents.");
  assert.equal(result.jobs[0].salary_text, "Confidential");
});

test("Jobicy tries its fallback endpoint when the primary response has no job rows", async () => {
  resetRequestPacingForTests();
  const requested = [];
  const result = await fetchJobicy({
    fetchImpl: async (url) => {
      requested.push(url.href);
      return jsonResponse(requested.length === 1
        ? { unexpected: [] }
        : { jobs: [{ id: "fallback-1", title: "Security Monitoring Analyst", url: "https://jobicy.com/jobs/fallback" }] });
    },
  });
  assert.deepEqual(requested, [
    "https://jobicy.com/api/jobs",
    "https://jobicy.com/api/v2/remote-jobs",
  ]);
  assert.equal(result.jobs.length, 1);
});

test("Remote OK skips its legal notice and retains valid security matches", async () => {
  resetRequestPacingForTests();
  const result = await fetchRemoteOk({
    fetchImpl: async (url) => {
      assert.equal(url.href, "https://remoteok.com/api");
      return jsonResponse(fixture("remoteok"));
    },
  });
  assert.equal(result.fetched, 3);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].title, "SOC Analyst");
  assert.equal(result.discarded, 1);
  assert.equal(result.malformed, 1);
});

test("Remotive preserves private-feed links and skips malformed or irrelevant listings", async () => {
  resetRequestPacingForTests();
  const result = await fetchRemotive({
    fetchImpl: async (url) => {
      assert.equal(url.href, "https://remotive.com/api/remote-jobs");
      return jsonResponse(fixture("remotive"));
    },
  });
  assert.equal(result.jobs[0].source_key, "remotive");
  assert.equal(result.jobs[0].url, "https://remotive.com/remote-jobs/education/ict-trainer-301");
  assert.equal(result.discarded, 1);
  assert.equal(result.malformed, 1);
});

test("Arbeitnow accepts the documented data array without inferring country eligibility", async () => {
  resetRequestPacingForTests();
  const result = await fetchArbeitnow({
    fetchImpl: async (url) => {
      assert.equal(url.href, "https://www.arbeitnow.com/api/job-board-api");
      return jsonResponse(fixture("arbeitnow"));
    },
  });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].location_text, "Berlin");
  assert.equal(result.jobs[0].remote_scope_text, "true");
  assert.equal(result.jobs[0].url, "https://www.arbeitnow.com/jobs/information-security-analyst");
});

test("ATS adapters use fixed read-only endpoints and validate public board tokens", async () => {
  resetRequestPacingForTests();
  const entries = [
    { provider: "greenhouse", token: "Example_Token", label: "Example Greenhouse" },
    { provider: "lever", token: "example-lever", label: "Example Lever" },
    { provider: "greenhouse", token: "x", label: "Invalid token" },
  ];
  assert.equal(atsWatchlistCreateSchema.safeParse(entries[0]).success, true);
  assert.equal(atsWatchlistCreateSchema.safeParse(entries[2]).success, false);
  const requested = [];
  const result = await fetchAtsWatchlist(entries, {
    fetchImpl: async (url) => {
      requested.push(url.href);
      return jsonResponse(url.hostname === "boards-api.greenhouse.io"
        ? fixture("greenhouse")
        : fixture("lever"));
    },
  });
  assert.deepEqual(requested, [
    "https://boards-api.greenhouse.io/v1/boards/Example_Token/jobs?content=true",
    "https://api.lever.co/v0/postings/example-lever?mode=json",
  ]);
  assert.equal(result.jobs.length, 2);
  assert.deepEqual(result.jobs.map((job) => job.source_job_id), ["greenhouse:401", "lever:lever-501"]);
  assert.equal(result.discarded, 2);
  assert.equal(result.malformed, 3);
});

test("role title and tag matching stays within the two requested tracks", () => {
  assert.equal(matchesRoleTitle("Junior Cybersecurity Analyst"), true);
  assert.equal(matchesRoleTitle("Senior IT Trainer"), true);
  assert.equal(matchesRoleTitle("Security Specialist", ["Security Operations Analyst"]), true);
  assert.equal(matchesRoleTitle("Business Intelligence Analyst", ["Power BI"]), false);
});

test("HTML is reduced to bounded plain text and invalid links are rejected", () => {
  assert.equal(stripHtml("<script>bad()</script><p>A &amp; B &#x1F680;</p>"), "A & B 🚀");
  assert.equal(stripHtml(` <p>${"x".repeat(6100)}</p> `).length, 6000);
  assert.equal(stripHtml("&#999999999;safe"), "safe");
  assert.equal(normalizeHttpUrl("javascript:alert(1)"), null);
  assert.equal(normalizeHttpUrl("https://user:pass@example.com/job"), null);
  assert.equal(normalizeHttpUrl("https://example.com/job/#apply"), "https://example.com/job");
});

test("source URLs remain pinned to provider hosts", async () => {
  await assert.rejects(fetchSourceJson("https://example.com/api/jobs", {
    source: "jobicy",
    fetchImpl: async () => { throw new Error("must not be called"); },
  }), /fixed HTTPS host/);
});

test("same-host redirects are followed but cross-host redirects are rejected", async () => {
  resetRequestPacingForTests();
  let requests = 0;
  const result = await fetchSourceJson("https://remoteok.com/api", {
    source: "remoteok",
    fetchImpl: async (_url, init) => {
      requests++;
      assert.equal(init.redirect, "manual");
      return requests === 1
        ? new Response(null, { status: 302, headers: { location: "/api/latest" } })
        : jsonResponse({ jobs: [] });
    },
  });
  assert.deepEqual(result, { jobs: [] });
  assert.equal(requests, 2);

  resetRequestPacingForTests();
  await assert.rejects(fetchSourceJson("https://remoteok.com/api", {
    source: "remoteok",
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/collect" },
    }),
    maxRequests: 1,
  }), /left its fixed HTTPS host/);
});

test("JSON response body size is capped at two megabytes", async () => {
  resetRequestPacingForTests();
  await assert.rejects(fetchSourceJson("https://remoteok.com/api", {
    source: "remoteok",
    maxRequests: 1,
    fetchImpl: async () => new Response("{}", {
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
    }),
  }), /exceeded the size limit/);
});

test("429 Retry-After is honored and retries remain bounded", async () => {
  resetRequestPacingForTests();
  let requests = 0;
  const delays = [];
  const result = await fetchSourceJson("https://remoteok.com/api", {
    source: "remoteok",
    fetchImpl: async () => {
      requests++;
      return requests === 1
        ? jsonResponse({ error: "rate limited" }, 429, { "retry-after": "2" })
        : jsonResponse({ ok: true });
    },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(requests, 2);
  assert.ok(delays.some((milliseconds) => milliseconds >= 2000));
});

test("Remotive spaces repeated requests by at least 30 seconds", async () => {
  resetRequestPacingForTests();
  let clock = 100_000;
  const delays = [];
  const options = {
    source: "remotive",
    now: () => clock,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
      clock += milliseconds;
    },
    fetchImpl: async () => jsonResponse({ jobs: [] }),
  };
  await fetchRemotive(options);
  await fetchRemotive(options);
  assert.ok(delays.includes(30_000));
});

test("source ledger enforces Jobicy intervals and Remotive daily request limits", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  const jobicy = {
    key: "jobicy", enabled: true, private_use_allowed: true,
    min_interval_seconds: 3600, max_requests_per_day: 24,
  };
  assert.equal(sourceSkipReason(jobicy, { last_attempt_at: new Date(now.getTime() - 3599_000) }, now), "minimum polling interval");
  assert.equal(sourceSkipReason(jobicy, { last_attempt_at: new Date(now.getTime() - 3600_000) }, now), null);
  const remotive = {
    key: "remotive", enabled: true, private_use_allowed: true,
    min_interval_seconds: 21600, max_requests_per_day: 4,
  };
  assert.equal(sourceSkipReason(remotive, { requests_today: 4, window_date: "2026-11-01" }, now), "daily request cap reached");
});

test("canonical identity combines normalized company, role, location, and original URL", () => {
  const job = {
    url: "https://example.com/jobs/1/#apply",
    title: " Security Analyst ",
    company: "Example   Security",
    location_text: "Nairobi, Kenya",
    remote_scope_text: "",
    description_text: "",
    salary_text: null,
    tags: [],
    posted_at: null,
  };
  const identity = buildJobIdentity(job);
  assert.equal(identity.canonical_key, "example security|security analyst|nairobi, kenya|https://example.com/jobs/1");
  assert.match(identity.content_hash, /^[a-f0-9]{64}$/);
});

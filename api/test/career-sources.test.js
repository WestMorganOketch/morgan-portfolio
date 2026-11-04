import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { atsWatchlistCreateSchema } from "../src/careerValidation.js";
import {
  buildCareerSearchTerms,
  buildJobIdentity,
  fetchArbeitnow,
  fetchAtsWatchlist,
  fetchJobicy,
  fetchRemoteOk,
  fetchRemotive,
  fetchSourceJson,
  jobicyQueryTerms,
  matchesRoleTitle,
  normalizeHttpUrl,
  remotiveQueryTerms,
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
      assert.equal(url.origin + url.pathname, "https://jobicy.com/api/jobs");
      assert.equal(url.searchParams.get("tag"), "security analyst");
      assert.equal(init.redirect, "manual");
      return jsonResponse(fixture("jobicy"));
    },
  });
  assert.equal(result.fetched, 3);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.discarded, 1);
  assert.equal(result.malformed, 1);
  assert.equal(result.jobs[0].source_key, "jobicy");
  assert.equal(result.jobs[0].title, "Junior Security Analyst");
  assert.equal(result.jobs[0].url, "https://jobicy.com/jobs/101");
  assert.equal(result.jobs[0].description_text, "Monitor alerts & investigate incidents.");
  assert.equal(result.jobs[0].salary_text, "Confidential");
  assert.deepEqual(result.query_results, [{
    label: "tag:security analyst",
    fetched: 3,
    matched: 1,
    discarded: 2,
  }]);
});

test("Jobicy creates an encoded, documented tag query using only current role keywords", async () => {
  resetRequestPacingForTests();
  const requested = [];
  await fetchJobicy({
    queryTerm: "computer skills trainer",
    fetchImpl: async (url) => {
      requested.push(url.href);
      return jsonResponse({ jobs: [] });
    },
  });
  assert.deepEqual(jobicyQueryTerms, [
    "security analyst",
    "soc analyst",
    "ict trainer",
    "computer skills trainer",
  ]);
  assert.equal(requested.length, 1);
  assert.match(requested[0], /tag=computer\+skills\+trainer/);
});

test("Jobicy does not retry inside its one-request hourly polling slot", async () => {
  resetRequestPacingForTests();
  let requests = 0;
  await assert.rejects(fetchJobicy({
    maxRequests: 3,
    fetchImpl: async () => {
      requests++;
      return jsonResponse({ error: "temporary failure" }, 503);
    },
    sleep: async () => {},
  }), /HTTP 503/);
  assert.equal(requests, 1);
});

test("Remote OK stays on its generic feed because its official API documents no query parameter", async () => {
  resetRequestPacingForTests();
  const result = await fetchRemoteOk({
    fetchImpl: async (url) => {
      assert.equal(url.href, "https://remoteok.com/api");
      return jsonResponse(fixture("remoteok"));
    },
  });
  assert.deepEqual(result.query_results.map(({ label }) => label), ["latest"]);
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
  assert.deepEqual(result.query_results.map(({ label }) => label), ["latest"]);
});

test("Remotive uses its documented, URL-encoded search parameter", async () => {
  resetRequestPacingForTests();
  const result = await fetchRemotive({
    queryTerm: "ict trainer",
    fetchImpl: async (url) => {
      assert.equal(url.origin + url.pathname, "https://remotive.com/api/remote-jobs");
      assert.equal(url.searchParams.get("search"), "ict trainer");
      assert.match(url.href, /search=ict\+trainer/);
      return jsonResponse(fixture("remotive"));
    },
  });
  assert.equal(result.jobs[0].source_key, "remotive");
  assert.equal(result.jobs[0].url, "https://remotive.com/remote-jobs/education/ict-trainer-301");
  assert.equal(result.jobs[0].title, "ICT Trainer");
  assert.equal(result.discarded, 1);
  assert.equal(result.malformed, 1);
  assert.deepEqual(remotiveQueryTerms, jobicyQueryTerms);
  assert.deepEqual(result.query_results.map(({ label }) => label), ["search:ict trainer"]);
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
  assert.equal(result.jobs[0].title, "Information Security Analyst");
});

test("Arbeitnow accepts an injected response between two and eight megabytes", async () => {
  resetRequestPacingForTests();
  const padding = "x".repeat(3 * 1024 * 1024);
  const payload = {
    data: [{
      slug: "security-analyst-large-response",
      title: "Information Security Analyst",
      company_name: "Example Security",
      location: "Nairobi",
      url: "https://www.arbeitnow.com/jobs/security-analyst",
      description: "Monitor security events.",
    }],
    padding,
  };
  const result = await fetchArbeitnow({
    fetchImpl: async () => new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].title, "Information Security Analyst");
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
  assert.equal(matchesRoleTitle("  sEcUrItY   aNaLySt  "), true);
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


test("saved custom role tracks generate provider query terms", () => {
  assert.deepEqual(
    buildCareerSearchTerms(["Security Analyst/SOC", "Computer Skills/ICT Trainer", "Cloud Security Engineer"]),
    [
      "security analyst",
      "SOC analyst",
      "cybersecurity analyst",
      "Security Analyst/SOC",
      "ICT trainer",
      "computer skills trainer",
      "digital skills trainer",
      "Computer Skills/ICT Trainer",
      "Cloud Security Engineer",
    ],
  );
});

test("Jobicy accepts a user-defined search title and filters using the same preference", async () => {
  resetRequestPacingForTests();
  const result = await fetchJobicy({
    queryTerm: "Cloud Security Engineer",
    roleTracks: ["Cloud Security Engineer"],
    fetchImpl: async (url) => {
      assert.equal(url.searchParams.get("tag"), "Cloud Security Engineer");
      return jsonResponse({ jobs: [
        {
          id: "cloud-1",
          title: "Cloud Security Engineer",
          company: "Example Cloud",
          jobGeo: "Kenya",
          url: "https://jobicy.com/jobs/cloud-1",
          description: "Protect cloud infrastructure.",
        },
        {
          id: "data-1",
          title: "Data Engineer",
          company: "Example Data",
          jobGeo: "Kenya",
          url: "https://jobicy.com/jobs/data-1",
          description: "Build data pipelines.",
        },
      ] });
    },
  });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].title, "Cloud Security Engineer");
  assert.equal(result.discarded, 1);
  assert.deepEqual(result.query_results.map(({ label }) => label), ["tag:Cloud Security Engineer"]);
});

test("generic feeds use saved custom titles for local matching", async () => {
  resetRequestPacingForTests();
  const result = await fetchRemoteOk({
    roleTracks: ["Cloud Security Engineer"],
    fetchImpl: async () => jsonResponse([
      { legal: "Remote OK terms" },
      {
        id: "cloud-2",
        position: "Cloud Security Engineer",
        company: "Example Cloud",
        location: "Remote",
        url: "https://remoteok.com/jobs/cloud-2",
        description: "Build secure cloud controls.",
      },
      {
        id: "irrelevant-2",
        position: "Product Manager",
        company: "Example Product",
        location: "Remote",
        url: "https://remoteok.com/jobs/irrelevant-2",
        description: "Lead product roadmaps.",
      },
    ]),
  });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].title, "Cloud Security Engineer");
  assert.equal(result.discarded, 1);
});

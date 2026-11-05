import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicCareerSnapshot, sanitizePublishedCareerSnapshot } from "../src/careerPublicSnapshot.js";

const now = () => new Date("2026-11-05T15:00:00.000Z");

const cleanJob = {
  id: "job-1",
  title: "Junior SOC Analyst",
  company: "Example Security Ltd",
  location_text: "Nairobi, Kenya",
  remote_scope_text: "Hybrid",
  description_text: "Monitor security alerts and document incidents.",
  salary_text: "Confidential",
  tags: ["SOC"],
  url: "https://careers.example.test/jobs/123",
  posted_at: "2026-11-04T10:00:00.000Z",
  first_seen_at: "2026-11-04T10:00:00.000Z",
  status: "screened",
  source_key: "jobicy",
  source_name: "Jobicy",
  attribution_text: "Jobicy and original source",
  public_redisplay_allowed: true,
};

function dbFixture({ showCompanyName = false, publicPublishing = true, rows = [cleanJob] } = {}) {
  return {
    queries: [],
    async query(statement, values = []) {
      this.queries.push({ statement, values });
      if (statement.includes("SELECT public_publishing, show_company_name")) {
        return { rows: [{ public_publishing: publicPublishing, show_company_name: showCompanyName }] };
      }
      if (statement.includes("SELECT j.id, j.title, j.company")) {
        return { rows: rows.filter((row) => row.public_redisplay_allowed === true
          && !["duplicate", "expired", "not_a_fit", "passed", "closed", "blocked_risk"].includes(row.status)) };
      }
      throw new Error("Unexpected database query: " + statement.slice(0, 100));
    },
  };
}

test("public snapshot uses explicit source permission, HTTPS and low-risk filters; company is off by default", async () => {
  const db = dbFixture({ rows: [
    cleanJob,
    { ...cleanJob, id: "job-2", url: "http://careers.example.test/jobs/2" },
    { ...cleanJob, id: "job-3", url: "https://careers.example.test/jobs/3", public_redisplay_allowed: false },
    { ...cleanJob, id: "job-4", url: "https://careers.example.test/jobs/4", description_text: "Applicants must pay a registration fee before interviews." },
  ] });
  const result = await buildPublicCareerSnapshot(db, { now });
  assert.equal(result.job_count, 1);
  assert.equal(result.snapshot.jobs[0].title, "Junior SOC Analyst");
  assert.equal("company" in result.snapshot.jobs[0], false);
  assert.equal("salary_text" in result.snapshot.jobs[0], false);
  assert.equal("description_text" in result.snapshot.jobs[0], false);
  assert.equal(result.snapshot_sha256.length, 64);
  assert.match(result.snapshot.verification_notice, /not independently verified/i);
});

test("company names are published only after the setting is explicitly enabled and the source permits redisplay", async () => {
  const result = await buildPublicCareerSnapshot(dbFixture({ showCompanyName: true }), { now });
  assert.equal(result.snapshot.jobs[0].company, "Example Security Ltd");
});

test("publishing disabled is fail-closed", async () => {
  await assert.rejects(buildPublicCareerSnapshot(dbFixture({ publicPublishing: false }), { now }), /publishing is disabled/i);
});

test("public serializer strips all fields outside the explicit allowlist", () => {
  const sanitized = sanitizePublishedCareerSnapshot({
    schema_version: 1,
    generated_at: "2026-11-05T15:00:00.000Z",
    verification_notice: "this notice is generated on the server",
    jobs: [{
      title: "SOC Analyst",
      location: "Nairobi",
      remote_scope: "Hybrid",
      source: "Jobicy",
      attribution: "Jobicy",
      url: "https://careers.example.test/123",
      posted_at: null,
      first_seen_at: "2026-11-04T10:00:00.000Z",
      company: "Explicitly approved employer",
      salary_text: "secret",
      application_id: "private",
      resume_text: "private",
      private_notes: "private",
      signed_url: "private",
    }],
    private_notes: "must not appear",
  });
  assert.equal(sanitized.jobs.length, 1);
  assert.equal(sanitized.jobs[0].company, "Explicitly approved employer");
  assert.equal("salary_text" in sanitized.jobs[0], false);
  assert.equal("application_id" in sanitized.jobs[0], false);
  assert.equal("resume_text" in sanitized.jobs[0], false);
  assert.equal("private_notes" in sanitized, false);
  assert.equal("signed_url" in sanitized.jobs[0], false);
});

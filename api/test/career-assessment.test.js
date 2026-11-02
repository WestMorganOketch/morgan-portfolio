import assert from "node:assert/strict";
import test from "node:test";
import {
  assessEligibility,
  assessJob,
  createCareerAssessmentService,
} from "../src/careerAssessment.js";

const settings = {
  score_threshold: 65,
  excluded_keywords: [],
  excluded_companies: [],
};
const baseJob = {
  title: "Junior Security Analyst",
  company: "Example",
  location_text: "Kenya",
  remote_scope_text: "",
  description_text: "Monitor alerts and investigate incidents.",
  tags: [],
  posted_at: "2026-11-01T10:00:00.000Z",
};

test("on-site roles in the three priority countries preserve work-permission uncertainty", () => {
  assert.equal(assessEligibility({ ...baseJob, location_text: "Nairobi, Kenya" }).eligibility, "eligible");
  for (const country of ["Tanzania", "Uganda"]) {
    const result = assessEligibility({ ...baseJob, location_text: country });
    assert.equal(result.eligibility, "unknown");
    assert.deepEqual(result.reasonCodes, ["needs_work_permission_review"]);
    assert.equal(result.evidence[0].phrase, country);
  }
});

test("remote eligibility requires explicit Kenya-compatible evidence", () => {
  for (const phrase of ["Worldwide", "Anywhere", "Africa", "EMEA", "East Africa", "Kenya"]) {
    const result = assessEligibility({
      ...baseJob,
      location_text: "Remote",
      remote_scope_text: phrase,
    });
    assert.equal(result.eligibility, "eligible", phrase);
    assert.ok(result.evidence[0].phrase.toLowerCase().includes(phrase.toLowerCase()));
  }
});

test("country restrictions and work-authorization requirements are ineligible", () => {
  for (const phrase of [
    "US only", "UK-only", "EU only", "must reside in the United States",
    "work authorization required", "Remote only in Canada, Mexico, and Germany",
    "not available in Kenya",
  ]) {
    const result = assessEligibility({
      ...baseJob,
      location_text: "Remote",
      remote_scope_text: phrase,
    });
    assert.equal(result.eligibility, "ineligible", phrase);
    assert.ok(result.evidence[0].phrase.toLowerCase().includes(phrase.toLowerCase()));
  }
});

test("ambiguous remote scope remains unknown instead of assuming eligibility", () => {
  const result = assessEligibility({
    ...baseJob,
    location_text: "Remote",
    remote_scope_text: "Remote within selected regions",
  });
  assert.equal(result.eligibility, "unknown");
  assert.ok(result.reasonCodes.includes("eligibility_ambiguous"));
  assert.equal(result.evidence[0].phrase, "Remote");
});

test("fit weights total 100 and verified skill evidence is not invented", () => {
  const profile = {
    verified_facts: {
      required_skills: ["incident response", "SIEM"],
      preferred_skills: ["Python"],
    },
  };
  const result = assessJob({
    ...baseJob,
    description_text: "Junior role requiring SIEM and Python.",
  }, profile, settings, { now: new Date("2026-11-02T10:00:00.000Z") });
  const weights = Object.values(result.fit_breakdown)
    .filter((entry) => entry && typeof entry === "object" && "weight" in entry)
    .reduce((sum, entry) => sum + entry.weight, 0);
  assert.equal(weights, 100);
  assert.deepEqual(
    result.matched.filter(({ value }) => value).map(({ value }) => value),
    ["SIEM", "Python", "Security Analyst/SOC"],
  );
  assert.equal(result.eligibility_evidence[0].phrase, "Kenya");
  assert.deepEqual(result.missing, [{ type: "verified_skill_or_task", value: "incident response" }]);
  assert.equal(result.fit_breakdown.required_skill_task_evidence.points, 17.5);
  assert.ok(result.uncertainty.length > 0);
});

test("excluded keywords and companies hard-filter the score", () => {
  const keywordFiltered = assessJob(baseJob, null, {
    ...settings,
    excluded_keywords: ["security analyst"],
  });
  assert.equal(keywordFiltered.fit_score, 0);
  assert.ok(keywordFiltered.reason_codes.includes("excluded_keyword"));
  const companyFiltered = assessJob({ ...baseJob, company: "Blocked Example Inc" }, null, {
    ...settings,
    excluded_companies: ["Blocked Example"],
  });
  assert.equal(companyFiltered.fit_score, 0);
  assert.ok(companyFiltered.reason_codes.includes("excluded_company"));
});

test("missing master profile scores from track keywords and requests reassessment", () => {
  const result = assessJob({
    ...baseJob,
    description_text: "Security analyst role focused on security monitoring and incident response.",
  }, null, settings);
  assert.ok(result.reason_codes.includes("profile_missing"));
  assert.ok(result.fit_score > 25);
  assert.ok(result.uncertainty.some((item) => item.includes("reassess")));
});

test("profile changes trigger reassessment using the latest active track profile", async () => {
  const writes = [];
  let profiles = [];
  const db = {
    async query(sql, values = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      if (statement.startsWith("SELECT id, title, company")) {
        return { rows: [{ id: "job-1", ...baseJob }] };
      }
      if (statement.startsWith("SELECT score_threshold")) return { rows: [settings] };
      if (statement.startsWith("SELECT id, track, verified_facts")) return { rows: profiles };
      if (statement.startsWith("INSERT INTO public.jr_assessments")) {
        writes.push({ statement, values });
        return { rows: [] };
      }
      if (statement.startsWith("UPDATE public.jr_jobs SET status")) return { rows: [] };
      if (statement.startsWith("SELECT id FROM public.jr_jobs")) return { rows: [{ id: "job-1" }] };
      throw new Error(`Unexpected assessment query: ${statement}`);
    },
  };
  const service = createCareerAssessmentService({ db });
  await service.assessJob("job-1");
  assert.match(writes[0].statement, /VALUES \(\$1, NULL/);
  profiles = [{
    id: "profile-1",
    track: "Security Analyst/SOC",
    verified_facts: { skills: ["SIEM"] },
  }];
  const result = await service.reassessAll();
  assert.deepEqual(result, { assessed: 1, failed: 0 });
  assert.equal(writes[1].values[1], "profile-1");
});

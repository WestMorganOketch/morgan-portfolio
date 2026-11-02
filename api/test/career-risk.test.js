import assert from "node:assert/strict";
import test from "node:test";
import { assessCareerRisk, createCareerRiskService } from "../src/careerRisk.js";

const now = new Date("2025-01-01T00:00:00.000Z");
const verifiedListing = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Junior Security Analyst",
  company: "Acme",
  location_text: "Nairobi, Kenya",
  description_text: "Acme is hiring a junior security analyst to monitor alerts, investigate incidents, and document findings. Applicants should have foundational networking knowledge and clear written communication skills. Apply through our official careers page.",
  posted_at: "2024-12-20T00:00:00.000Z",
  also_listed_on: [],
  url: "https://acme.example/careers/security-analyst",
};
const verifiedUrl = {
  ok: true,
  hostname: "acme.example",
  final_hostname: "acme.example",
  status: 200,
  redirect_count: 0,
  redirected_to_different_host: false,
  dns_ok: true,
  https_ok: true,
  ats_provider: null,
  rdap_age_days: 300,
  page_text: "Contact recruitment@acme.example",
};

test("lower-risk classification requires corroborating facts and still lists unknowns", () => {
  const result = assessCareerRisk(verifiedListing, verifiedUrl, { now });
  assert.equal(result.risk_level, "lower_risk");
  assert.ok(result.risk_confidence <= 100 && result.risk_confidence >= 0);
  assert.deepEqual(result.unknowns, []);
  assert.equal(result.url_checks.hostname, "acme.example");

  const incomplete = assessCareerRisk({ ...verifiedListing, description_text: "Short post" }, {
    ...verifiedUrl,
    rdap_age_days: null,
  }, { now });
  assert.equal(incomplete.risk_level, "needs_manual_verification");
  assert.ok(incomplete.unknowns.length > 0);
});

test("fee and unusual-payment evidence block a listing with exact plain-text phrases", () => {
  const result = assessCareerRisk({
    ...verifiedListing,
    description_text: "<p>Pay a registration fee before your interview.</p> Send bitcoin for processing.",
  }, verifiedUrl, { now });
  assert.equal(result.risk_level, "blocked_by_rule");
  assert.ok(result.risk_findings.some((finding) =>
    finding.code === "upfront_fee_request" && finding.evidence.toLowerCase().includes("registration fee")));
  assert.ok(result.risk_findings.some((finding) => finding.code === "unusual_payment_method"));
});

test("sensitive-data and Kenya public-service impersonation patterns are evidence-backed", () => {
  const result = assessCareerRisk({
    ...verifiedListing,
    company: "United Nations field office",
    description_text: "A visa processing fee is required. Send your passport and bank account number by message before interview.",
  }, verifiedUrl, { now });
  assert.equal(result.risk_level, "blocked_by_rule");
  assert.ok(result.risk_findings.some((finding) => finding.code === "kenya_public_service_impersonation_pattern"));
  assert.ok(result.risk_findings.some((finding) => finding.code === "sensitive_identity_document_request"));
  assert.ok(result.risk_findings.some((finding) => finding.code === "early_financial_data_request"));
});

test("identity-document mentions trigger manual review without automatically blocking", () => {
  const result = assessCareerRisk({
    ...verifiedListing,
    description_text: `${verifiedListing.description_text} Please bring your passport to the in-person interview.`,
  }, verifiedUrl, { now });
  assert.equal(result.risk_level, "needs_manual_verification");
  assert.ok(result.risk_findings.some((finding) => finding.code === "sensitive_identity_document_request"));
});

test("implausible pay, urgency, employer-domain mismatch, and contact anomalies raise review signals", () => {
  const result = assessCareerRisk({
    ...verifiedListing,
    company: "Acme Global",
    description_text: "Earn USD 1500 per hour. Apply immediately and reserve your guaranteed job today. Contact careers@gmail.com.",
  }, {
    ...verifiedUrl,
    final_hostname: "apply.unrelated.example",
    redirected_to_different_host: true,
    rdap_age_days: 20,
  }, { now });
  assert.equal(result.risk_level, "high_risk");
  for (const code of [
    "impossible_pay", "urgency_or_guarantee", "company_domain_mismatch",
    "free_mail_contact", "new_domain", "cross_host_redirect",
  ]) {
    assert.ok(result.risk_findings.some((finding) => finding.code === code), code);
  }
});

test("weak, contradictory, duplicate, stale, and messaging-only adverts remain reviewable", () => {
  const result = assessCareerRisk({
    ...verifiedListing,
    description_text: "Fully remote role; must report on-site every day. Contact us on WhatsApp.",
    posted_at: "2024-09-01T00:00:00.000Z",
    also_listed_on: ["remoteok"],
  }, { ...verifiedUrl, rdap_age_days: null, page_text: "" }, { now });
  assert.equal(result.risk_level, "needs_manual_verification");
  for (const code of [
    "vague_or_incomplete_advert", "contradictory_work_arrangement",
    "messaging_only_contact", "cross_source_duplicate", "stale_post",
  ]) {
    assert.ok(result.risk_findings.some((finding) => finding.code === code), code);
  }
  assert.ok(result.unknowns.length > 0);
});

test("risk service respects fit threshold and updates the exact assessment row", async () => {
  const queries = [];
  let inspectCalls = 0;
  const db = {
    async query(sql, values = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      queries.push({ statement, values });
      if (statement.startsWith("SELECT j.id, j.title")) {
        return { rows: [{
          ...verifiedListing,
          fit_score: 80,
          assessment_id: "00000000-0000-4000-8000-000000000002",
          risk_level: null,
        }] };
      }
      if (statement.startsWith("SELECT score_threshold")) return { rows: [{ score_threshold: 65 }] };
      if (statement.startsWith("SELECT rdap_age_days")) return { rows: [{ rdap_age_days: 300 }] };
      return { rows: [] };
    },
  };
  const service = createCareerRiskService({
    db,
    inspectUrl: async (_url, options) => {
      inspectCalls++;
      assert.equal(options.domainAgeDays, 300);
      assert.equal(options.skipRdapLookup, true);
      return verifiedUrl;
    },
    now: () => now,
  });
  const result = await service.assessJob(verifiedListing.id);
  assert.equal(result.risk_level, "lower_risk");
  assert.equal(inspectCalls, 1);
  const update = queries.find(({ statement }) => statement.startsWith("UPDATE public.jr_assessments"));
  assert.equal(update.values[6], "00000000-0000-4000-8000-000000000002");

  queries.length = 0;
  const lowFitDb = {
    async query(sql) {
      const statement = sql.replace(/\s+/g, " ").trim();
      if (statement.startsWith("SELECT j.id, j.title")) {
        return { rows: [{ ...verifiedListing, fit_score: 60, assessment_id: null }] };
      }
      if (statement.startsWith("SELECT score_threshold")) return { rows: [{ score_threshold: 65 }] };
      throw new Error(`Unexpected query: ${statement}`);
    },
  };
  const belowThreshold = createCareerRiskService({
    db: lowFitDb,
    inspectUrl: async () => { inspectCalls++; throw new Error("must not inspect"); },
  });
  assert.deepEqual(await belowThreshold.assessJob(verifiedListing.id), {
    skipped: true,
    skipped_reason: "below_fit_threshold",
  });
  assert.equal(inspectCalls, 1);
});

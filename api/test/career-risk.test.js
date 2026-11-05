import assert from "node:assert/strict";
import test from "node:test";
import { assessCareerRisk } from "../src/careerRisk.js";

const baseJob = {
  title: "Junior Security Analyst",
  company: "Example Security Ltd",
  location_text: "Nairobi, Kenya",
  remote_scope_text: "",
  salary_text: "Competitive salary",
  tags: ["SOC", "incident response"],
  description_text: "Monitor security alerts, document findings, and investigate network traffic.",
  url: "https://careers.example.test/jobs/security-analyst",
};

test("ordinary adverts with a public HTTPS URL have no obvious rule-based red flags but remain unverified", () => {
  const risk = assessCareerRisk(baseJob, { now: () => new Date("2026-11-05T08:00:00.000Z") });
  assert.equal(risk.risk_level, "low");
  assert.match(risk.label, /not proof of legitimacy/i);
  assert.equal(risk.url_checks.ok, true);
  assert.equal(risk.url_checks.https_ok, true);
  assert.equal(risk.url_checks.dns_ok, false);
  assert.ok(risk.unknowns.some((value) => value.toLowerCase().includes("offline, rule-based")));
  assert.equal(risk.risk_assessed_at, "2026-11-05T08:00:00.000Z");
});

test("explicit application fees are high risk and preserve the matching evidence", () => {
  const risk = assessCareerRisk({
    ...baseJob,
    description_text: "Applicants must pay a registration fee before interview scheduling.",
  });
  assert.equal(risk.risk_level, "high");
  assert.ok(risk.risk_findings.some((finding) =>
    finding.code === "candidate_payment_requested" && finding.severity === "high"
      && /registration fee/i.test(finding.evidence)));
});

test("requests for passwords or one-time codes are high risk", () => {
  const risk = assessCareerRisk({
    ...baseJob,
    description_text: "To proceed, provide your one-time password to our recruitment officer.",
  });
  assert.equal(risk.risk_level, "high");
  assert.ok(risk.risk_findings.some((finding) => finding.code === "sensitive_credentials_requested"));
});

test("private, IP-literal, credential-bearing, and non-HTTP listing URLs are blocked", () => {
  for (const url of [
    "http://127.0.0.1/admin",
    "https://192.168.1.5/jobs",
    "https://user:pass@careers.example.test/jobs",
    "javascript:alert(1)",
    "https://internal.local/jobs",
  ]) {
    const risk = assessCareerRisk({ ...baseJob, url });
    assert.equal(risk.risk_level, "high", `expected high risk for ${url}`);
    assert.ok(risk.risk_findings.some((finding) => finding.code === "unsafe_listing_url"));
  }
});

test("HTTP, missing, shortened and unidentified-employer adverts require manual review", () => {
  const cases = [
    { url: "http://careers.example.test/jobs", company: "Example Security Ltd" },
    { url: null, company: "Example Security Ltd" },
    { url: "https://bit.ly/hire-now", company: "Example Security Ltd" },
    { url: "https://careers.example.test/jobs", company: "Confidential" },
  ];
  for (const job of cases) {
    const risk = assessCareerRisk({ ...baseJob, ...job });
    assert.equal(risk.risk_level, "medium");
  }
});

test("unrealistic instant offers and chat-only recruitment channels are visible as medium-risk evidence", () => {
  const instant = assessCareerRisk({ ...baseJob, description_text: "Guaranteed instant job offer with no interview." });
  assert.equal(instant.risk_level, "medium");
  assert.ok(instant.risk_findings.some((finding) => finding.code === "high_pressure_or_unrealistic_offer"));

  const chat = assessCareerRisk({ ...baseJob, description_text: "Contact the recruiter on WhatsApp only." });
  assert.equal(chat.risk_level, "medium");
  assert.ok(chat.risk_findings.some((finding) => finding.code === "chat_only_recruitment_channel"));
});

test("ATS branding is informational, unknown text is bounded, and absence of flags is not called verified", () => {
  const risk = assessCareerRisk({
    ...baseJob,
    url: "https://boards.greenhouse.io/example/jobs/123",
    description_text: "ordinary role".repeat(3000),
  });
  assert.equal(risk.risk_level, "low");
  assert.equal(risk.url_checks.ats_provider, "Greenhouse");
  assert.ok(risk.url_checks.error.includes("not been performed"));
  assert.ok(risk.url_checks.error.length < 250);
});

test("anti-scam disclaimers are not mistaken for requests to pay or share sensitive information", () => {
  const result = assessCareerRisk({
    ...baseJob,
    description_text: "We never ask applicants to pay an application fee or share their password.",
  });
  assert.equal(result.risk_level, "low");
  assert.equal(result.risk_findings.some((finding) => finding.severity === "high"), false);
});

test("a genuine later payment demand is still detected after an anti-scam disclaimer", () => {
  const result = assessCareerRisk({
    ...baseJob,
    description_text: "We never ask applicants to pay an application fee. Candidates must pay a registration fee to continue.",
  });
  assert.equal(result.risk_level, "high");
  assert.ok(result.risk_findings.some((finding) => finding.code === "candidate_payment_requested"));
});

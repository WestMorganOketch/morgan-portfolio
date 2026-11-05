import assert from "node:assert/strict";
import test from "node:test";
import { buildApplicationDraft, createTextPdf } from "../src/careerPreparation.js";

const masterResume = [
  "Morgan West Oketch",
  "Nairobi, Kenya",
  "",
  "PROFESSIONAL SUMMARY",
  "Final-year Mathematics and Computer Science student focused on cybersecurity, IT support, and data systems.",
  "",
  "TECHNICAL SKILLS",
  "Security monitoring, incident response, SIEM fundamentals, and evidence-based alert triage.",
  "Network analysis using Wireshark, VPN configuration, and firewall rules.",
  "SQL, Power BI, Excel, Python, Pandas, and reproducible reporting workflows.",
  "",
  "EXPERIENCE",
  "Supported Windows and Linux lab infrastructure for more than 50 active users.",
  "Collected, validated, backed up, and documented operational data.",
  "Delivered practical training in networking, secure APIs, and database fundamentals.",
  "",
  "EDUCATION",
  "BSc Mathematics and Computer Science — Tom Mboya University (expected 2026).",
].join("\n");

const profile = {
  id: "profile-security",
  name: "Master CV — Security",
  track: "Security Analyst/SOC",
  original_text: masterResume,
  verified_facts: {
    required_skills: ["security monitoring", "incident response", "Wireshark"],
    tasks: ["validated operational data", "supported Windows and Linux"],
    preferred_skills: ["Python", "SIEM"],
  },
};

const job = {
  id: "job-security",
  title: "Junior Security Analyst",
  company: "Example Security",
  location_text: "Nairobi, Kenya",
  remote_scope_text: "",
  description_text: "Monitor security alerts, triage incidents, investigate network traffic using Wireshark, and document findings. SIEM familiarity is preferred.",
  tags: ["SOC", "incident response"],
  url: "https://jobs.example.test/security-analyst",
  source_name: "Example board",
  attribution_text: "Example board",
};

const assessment = {
  fit_score: 86,
  eligibility: "eligible",
  matched: [
    { type: "verified_skill_or_task", value: "security monitoring" },
    { type: "verified_skill_or_task", value: "incident response" },
    { type: "preferred_skill", value: "SIEM" },
  ],
  missing: [{ type: "verified_skill_or_task", value: "endpoint detection and response" }],
  uncertainty: [],
};

test("application draft preserves the exact master CV and cites only verbatim highlights", () => {
  const draft = buildApplicationDraft({
    job,
    profile,
    assessment,
    now: new Date("2026-11-05T08:00:00.000Z"),
  });
  assert.equal(draft.sourceMasterResume, masterResume);
  assert.ok(draft.resumeText.includes(masterResume));
  assert.match(draft.resumeText, /ROLE-ALIGNED HIGHLIGHTS/);
  assert.ok(draft.highlights.length > 0);
  for (const highlight of draft.highlights) {
    assert.equal(masterResume.split(/\r?\n/)[highlight.sourceLine - 1].trim(), highlight.text);
    assert.ok(highlight.evidenceTerms.length > 0);
  }
  assert.equal(draft.source.assessmentScore, 86);
  assert.equal(draft.source.eligibility, "eligible");
  assert.equal(draft.source.generatedAt, "2026-11-05T08:00:00.000Z");
});

test("cover letter identifies the role, employer, evidence and review warnings without inventing missing skills", () => {
  const draft = buildApplicationDraft({ job, profile, assessment });
  assert.match(draft.coverLetterText, /Junior Security Analyst/);
  assert.match(draft.coverLetterText, /Example Security/);
  assert.match(draft.coverLetterText, /incident response/i);
  assert.match(draft.coverLetterText, /Kind regards/);
  assert.ok(draft.warnings.some((warning) => warning.includes("endpoint detection and response")));
  assert.ok(!draft.coverLetterText.includes("I have endpoint detection and response experience"));
});

test("ambiguous eligibility and missing listing URL are explicit warnings", () => {
  const draft = buildApplicationDraft({
    job: { ...job, url: null },
    profile,
    assessment: { ...assessment, eligibility: "unknown" },
  });
  assert.ok(draft.warnings.some((warning) => warning.includes("not confirmed eligible")));
  assert.ok(draft.warnings.some((warning) => warning.includes("no verified application URL")));
});

test("short and oversized master CV inputs fail closed", () => {
  assert.throws(() => buildApplicationDraft({
    job,
    profile: { ...profile, original_text: "too short" },
  }), /too short/i);
  assert.throws(() => buildApplicationDraft({
    job,
    profile: { ...profile, original_text: "x".repeat(60_001) },
  }), /60,000-character limit/i);
});

test("PDF attachment generator produces a valid basic PDF envelope and bounded pages", () => {
  const pdf = createTextPdf({
    title: "Morgan West Oketch — Security Analyst",
    text: `CV (master) \\ notes\n${masterResume}`,
    generatedAt: new Date("2026-11-05T08:00:00.000Z"),
  });
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.subarray(0, 8).toString("latin1").startsWith("%PDF-1.4"));
  const text = pdf.toString("latin1");
  assert.match(text, /\/Type \/Catalog/);
  assert.match(text, /\/Type \/Pages/);
  assert.match(text, /xref\n/);
  assert.match(text, /startxref\n\d+\n%%EOF/);
  assert.match(text, /Private application draft/);
  assert.ok(text.includes("\\(master\\)"));
  assert.ok(text.length < 200_000);
});

test("PDF generator rejects empty content and wraps long words without dropping text", () => {
  assert.throws(() => createTextPdf({ title: "Empty", text: " " }), /empty text/i);
  const longWord = "A".repeat(250);
  const pdf = createTextPdf({ title: "Long word", text: longWord });
  assert.match(pdf.toString("latin1"), /\/Type \/Page/);
});

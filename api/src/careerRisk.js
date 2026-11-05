import { isIP } from "node:net";

const HIGH_RISK_PATTERNS = [
  ["candidate_payment_requested", /\b(?:application|registration|processing|recruitment|placement)\s+fee\b/i],
  ["candidate_payment_requested", /\bpay\s+(?:a|the|an)\s+(?:fee|deposit|charge)\b/i],
  ["sensitive_credentials_requested", /\b(?:password|one[- ]time password|\bOTP\b|seed phrase|private key)\b/i],
];
const REVIEW_PATTERNS = [
  ["high_pressure_or_unrealistic_offer", /\b(?:guaranteed|instant)\s+(?:job|employment|offer)\b/i],
  ["no_interview_claim", /\bno interview required\b/i],
  ["chat_only_recruitment_channel", /\b(?:WhatsApp|Telegram)\s+only\b/i],
];
const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "cutt.ly", "is.gd"]);

function text(value, max = 12000) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function isPrivateIp(host) {
  if (isIP(host) === 4) {
    const [a, b, c] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224
      || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(host) === 6) {
    const value = host.toLowerCase();
    return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd")
      || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb");
  }
  return false;
}

function checkUrl(raw) {
  const value = text(raw, 2000);
  if (!value) return { ok: false, blocked: false, hostname: null, https_ok: false, error: "No original listing URL was supplied." };
  let url;
  try { url = new URL(value); } catch {
    return { ok: false, blocked: false, hostname: null, https_ok: false, error: "The original listing URL is malformed." };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, blocked: true, hostname, https_ok: false, error: "Only HTTP(S) listing URLs are accepted." };
  }
  if (url.username || url.password || !hostname || hostname === "localhost"
      || hostname.endsWith(".localhost") || hostname.endsWith(".local")
      || hostname.endsWith(".internal") || isPrivateIp(hostname) || isIP(hostname)) {
    return { ok: false, blocked: true, hostname, https_ok: url.protocol === "https:", error: "The listing destination is not a safe public web URL." };
  }
  if (SHORTENERS.has(hostname)) {
    return { ok: true, blocked: false, hostname, https_ok: url.protocol === "https:", error: "Shortened links conceal the final destination; verify it manually.", ats_provider: null };
  }
  const atsProvider = hostname === "boards.greenhouse.io" || hostname.endsWith(".greenhouse.io") ? "Greenhouse" : hostname === "jobs.lever.co" || hostname.endsWith(".lever.co") ? "Lever" : null;
  return { ok: true, blocked: false, hostname, https_ok: url.protocol === "https:", error: "Static URL checks only; live DNS, TLS, redirects, domain age, and employer verification have not been performed.", ats_provider: atsProvider };
}

/** Rule-based screening of already-ingested advert data. Never fetches the original URL. */
export function assessCareerRisk(job, { now = () => new Date() } = {}) {
  const advert = [job?.title, job?.company, job?.location_text, job?.remote_scope_text, job?.salary_text, ...(Array.isArray(job?.tags) ? job.tags : []), job?.description_text]
    .map((value) => text(value))
    .filter(Boolean)
    .join(" ")
    .slice(0, 18000);
  const urlChecks = checkUrl(job?.url);
  const findings = [];
  const seen = new Set();
  const add = (code, severity, confidence, evidence) => {
    if (seen.has(code)) return;
    seen.add(code);
    findings.push({ code, severity, confidence, evidence: text(evidence, 180) });
  };
  for (const [code, pattern] of HIGH_RISK_PATTERNS) {
    const match = pattern.exec(advert);
    if (match) add(code, "high", 0.96, match[0]);
  }
  for (const [code, pattern] of REVIEW_PATTERNS) {
    const match = pattern.exec(advert);
    if (match) add(code, "medium", 0.78, match[0]);
  }
  const company = text(job?.company, 200);
  if (!company || /^(?:confidential|undisclosed|unknown|not provided)$/i.test(company)) {
    add("employer_not_identified", "medium", 0.9, "The advert does not identify an employer name.");
  }
  if (!urlChecks.ok && urlChecks.blocked) add("unsafe_listing_url", "high", 0.99, urlChecks.error);
  else if (!urlChecks.ok) add("listing_destination_missing_or_invalid", "medium", 0.92, urlChecks.error);
  else if (!urlChecks.https_ok) add("listing_not_https", "medium", 0.9, urlChecks.error);
  else if (SHORTENERS.has(urlChecks.hostname)) add("shortened_listing_url", "medium", 0.9, urlChecks.error);

  const high = findings.some((item) => item.severity === "high");
  const medium = findings.some((item) => item.severity === "medium");
  const riskLevel = high ? "high" : medium ? "medium" : "low";
  return {
    risk_level: riskLevel,
    label: high ? "High risk — do not prepare or send" : medium ? "Review required — verify first" : "No obvious red flags found; this is not proof of legitimacy",
    risk_findings: findings,
    risk_confidence: findings.length ? Math.max(...findings.map((item) => item.confidence)) : 0.35,
    unknowns: [
      "Offline rule-based screening only; employer identity, live DNS, TLS, redirects, domain age, and independent reputation have not been verified.",
      urlChecks.hostname ? "Open the employer's official careers page and confirm that this exact vacancy exists." : "Find the vacancy through the employer's official careers page before applying.",
    ],
    url_checks: { ...urlChecks, status: null, redirect_count: 0, redirected_to_different_host: false, dns_ok: false, ats_provider: urlChecks.ats_provider ?? null, rdap_age_days: null },
    risk_assessed_at: now().toISOString(),
  };
}

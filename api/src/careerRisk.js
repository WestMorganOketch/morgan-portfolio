import { careerUrlHostname, inspectCareerUrl } from "./careerUrlSafety.js";
import { stripHtml } from "./careerSources.js";

const freeMailDomains = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com",
  "icloud.com", "aol.com", "proton.me", "protonmail.com", "mail.com",
]);
const ignoredCompanyWords = new Set([
  "a", "an", "and", "company", "corp", "corporation", "group",
  "inc", "limited", "ltd", "llc", "plc", "services", "the",
]);
const seriousSignals = new Set([
  "new_domain", "company_domain_mismatch", "email_domain_mismatch",
  "free_mail_contact", "unlicensed_overseas_recruiter", "impossible_pay",
]);
const multiLabelPublicSuffixes = new Set([
  "ac.uk", "co.uk", "gov.uk", "org.uk", "com.au", "net.au", "org.au",
  "co.ke", "or.ke", "ac.ke", "go.ke", "sc.ke", "co.tz", "or.tz",
  "ac.tz", "go.tz", "co.ug", "or.ug", "ac.ug", "go.ug", "com.ng",
]);

function plain(value, limit = 6000) {
  return stripHtml(typeof value === "string" ? value : "", limit);
}

function tokens(value) {
  return plain(value, 300).toLowerCase().replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/).filter((token) => token.length > 1 && !ignoredCompanyWords.has(token));
}

function registrableDomain(hostname) {
  const labels = hostname.toLowerCase().replace(/^www\./, "").split(".");
  if (labels.length < 2) return hostname.toLowerCase();
  const suffix = labels.slice(-2).join(".");
  return labels.length >= 3 && multiLabelPublicSuffixes.has(suffix)
    ? labels.slice(-3).join(".")
    : suffix;
}

function addFinding(findings, code, severity, confidence, evidence) {
  findings.push({ code, severity, confidence, evidence: plain(evidence, 160) });
}

function domainMatchesCompany(company, hostname) {
  const companyTokens = tokens(company);
  const hostTokens = tokens(hostname.replace(/\.[a-z.]+$/i, "").replaceAll(".", " "));
  return companyTokens.length > 0 && companyTokens.some((token) => hostTokens.includes(token));
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function assessCareerRisk(job, urlCheck, { now = new Date() } = {}) {
  const title = plain(job.title, 300);
  const company = plain(job.company, 200);
  const description = plain(job.description_text, 6000);
  const pageText = plain(urlCheck?.page_text, 512 * 1024);
  const text = `${title}\n${company}\n${description}\n${plain(job.location_text, 300)}\n${plain(job.remote_scope_text, 300)}\n${pageText}`;
  const findings = [];
  const unknowns = [];
  let blockedByRule = false;

  const feePhrase = /\b(?:application|registration|processing|visa|medical|training|placement|recruitment)\s+(?:fee|charge|payment)\b|\bpay\s+(?:a|the|your)?\s*(?:fee|charge)\b|\bpay\s+(?:for|to obtain)\s+(?:a )?(?:visa|medical|processing)\b/i.exec(text)?.[0];
  if (feePhrase) {
    addFinding(findings, "upfront_fee_request", "critical", 98, feePhrase);
    blockedByRule = true;
  }
  const cryptoPhrase = /\b(?:cryptocurrency|crypto|bitcoin|gift cards?|wire transfer|western union|moneygram|cash app)\b/i.exec(text)?.[0];
  if (cryptoPhrase) {
    addFinding(findings, "unusual_payment_method", "critical", 98, cryptoPhrase);
    blockedByRule = true;
  }
  const bankPhrase = /\b(?:bank account|bank details|account number|routing number|card number|online banking|mobile money pin)\b/i.exec(text)?.[0];
  if (bankPhrase) {
    addFinding(findings, "early_financial_data_request", "critical", 97, bankPhrase);
    blockedByRule = true;
  }
  const identityPhrase = /\b(?:passport|national id|national identification|identity document|government id|kra pin|tax pin)\b/i.exec(text)?.[0];
  if (identityPhrase) {
    addFinding(findings, "sensitive_identity_document_request", "high", 92, identityPhrase);
  }

  const publicAgency = /\b(?:united nations|un agency|ngo|embassy|high commission)\b/i.exec(text)?.[0];
  const kenyaAgency = /\b(?:kenya revenue authority|kra|public service commission|national police service|kenya police|county government|ecitizen)\b/i.exec(text)?.[0];
  if ((publicAgency || kenyaAgency) && (feePhrase || cryptoPhrase || bankPhrase)) {
    const agency = publicAgency ?? kenyaAgency;
    const request = feePhrase ?? cryptoPhrase ?? bankPhrase;
    addFinding(findings, "kenya_public_service_impersonation_pattern", "critical", 96, `${agency}: ${request}`);
    blockedByRule = true;
  }

  const impossiblePay = /\b(?:\$|usd\s*)\s?\d{3,}(?:,\d{3})*(?:\.\d{1,2})?\s*(?:per hour|\/\s*hour|hourly)\b|\b(?:kes|ksh)\s?\d{5,}\s*(?:per day|\/\s*day|daily)\b/i.exec(text)?.[0];
  if (impossiblePay) addFinding(findings, "impossible_pay", "high", 82, impossiblePay);

  const urgency = /\b(?:act now|apply immediately|today only|limited slots|urgent hiring|guaranteed job|instant employment)\b/i.exec(text)?.[0];
  if (urgency) addFinding(findings, "urgency_or_guarantee", "medium", 68, urgency);

  if (description.trim().length < 80) {
    addFinding(findings, "vague_or_incomplete_advert", "medium", 65, "Advert contains fewer than 80 plain-text characters.");
    unknowns.push("Advert details are too limited to assess duties and hiring context.");
  }

  if (/\bfully remote\b/i.test(text) && /\b(?:must report|on-site every day|onsite every day|office attendance required)\b/i.test(text)) {
    addFinding(findings, "contradictory_work_arrangement", "medium", 72, "Remote and mandatory daily office language both appear.");
  }

  const emailDomains = [...text.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi)]
    .map((match) => match[1].toLowerCase());
  const freeMail = emailDomains.find((domain) => freeMailDomains.has(domain));
  if (freeMail) addFinding(findings, "free_mail_contact", "high", 78, `Contact uses ${freeMail}.`);

  const urlDomain = urlCheck?.final_hostname ?? urlCheck?.hostname ?? careerUrlHostname(job.url);
  if (!company) unknowns.push("Employer identity is not specified.");
  if (!job.url) unknowns.push("No original listing URL is available.");
  if (job.url && !urlCheck?.ok) unknowns.push("The listing URL could not be safely inspected.");
  if (urlCheck?.ok && !urlCheck.https_ok) {
    addFinding(findings, "listing_not_https", "medium", 72, "The final listing page uses HTTP rather than HTTPS.");
  }
  if (urlCheck?.redirected_to_different_host) {
    addFinding(findings, "cross_host_redirect", "medium", 67, "The listing redirected to a different host.");
  }
  if (urlCheck?.ats_provider) {
    addFinding(findings, "supported_ats_host", "informational", 55, `Listing is hosted by supported ATS provider: ${urlCheck.ats_provider}.`);
  }
  const careersPath = (() => {
    try {
      return /\b(?:career|careers|jobs|job-openings)\b/i.test(new URL(job.url).pathname);
    } catch {
      return false;
    }
  })();
  if (urlDomain && company && !urlCheck?.ats_provider && !domainMatchesCompany(company, urlDomain)) {
    addFinding(findings, "company_domain_mismatch", "high", 76, `Listing host ${registrableDomain(urlDomain)} does not resemble the employer name.`);
  }
  const companyEmailDomains = emailDomains.filter((domain) => !freeMailDomains.has(domain));
  if (urlDomain && companyEmailDomains.some((domain) => registrableDomain(domain) !== registrableDomain(urlDomain))) {
    const mismatch = companyEmailDomains.find((domain) => registrableDomain(domain) !== registrableDomain(urlDomain));
    addFinding(findings, "email_domain_mismatch", "high", 76, `Contact domain ${registrableDomain(mismatch)} differs from listing domain ${registrableDomain(urlDomain)}.`);
  }
  if (urlCheck?.rdap_age_days === null || urlCheck?.rdap_age_days === undefined) {
    unknowns.push("Domain registration age is unavailable.");
  } else if (urlCheck.rdap_age_days < 90) {
    addFinding(findings, "new_domain", "high", 80, `Domain registration age is ${urlCheck.rdap_age_days} days.`);
  }

  const contactChannels = /\b(?:whatsapp|telegram)\b/i.test(text);
  const businessEmail = companyEmailDomains.length > 0;
  if (contactChannels && !businessEmail) {
    addFinding(findings, "messaging_only_contact", "medium", 70, "Only messaging-app contact is evident; verify the employer independently.");
  } else if (!businessEmail && emailDomains.length === 0 && !contactChannels) {
    unknowns.push("No employer-domain contact information is present.");
  }

  if (/\b(?:overseas|international)\s+(?:recruit(?:er|ment)|staffing|employment)\b/i.test(text)
    && !/\b(?:license|licen[cs]ed|registration number|regulator)\b/i.test(text)) {
    addFinding(findings, "unlicensed_overseas_recruiter", "high", 78, "Overseas recruiting is mentioned without licensing or regulator details.");
    unknowns.push("Recruiter licensing could not be verified from the advert.");
  }
  if (Array.isArray(job.also_listed_on) && job.also_listed_on.length > 0) {
    addFinding(findings, "cross_source_duplicate", "low", 58, "The listing also appeared on another monitored source.");
  }
  const postedAt = validDate(job.posted_at);
  if (!postedAt) unknowns.push("The posting date is unavailable.");
  else if (now.getTime() - postedAt.getTime() > 60 * 86_400_000) {
    addFinding(findings, "stale_post", "medium", 67, "The recorded posting date is more than 60 days old.");
  }

  if (urlCheck?.error) unknowns.push(`URL inspection could not complete (${urlCheck.error}).`);
  if (job.url && !urlCheck) unknowns.push("URL inspection has not been run.");
  if (urlDomain && !urlCheck?.ats_provider && !careersPath && !domainMatchesCompany(company, urlDomain)) {
    unknowns.push("An official employer careers page or supported ATS could not be established.");
  }

  const severeCount = findings.filter((finding) => seriousSignals.has(finding.code)).length;
  const highRisk = !blockedByRule && (
    severeCount >= 2
    || (findings.some((finding) => finding.code === "new_domain")
      && findings.some((finding) => finding.code === "company_domain_mismatch"))
    || (findings.some((finding) => finding.code === "impossible_pay")
      && findings.some((finding) => ["urgency_or_guarantee", "free_mail_contact", "company_domain_mismatch"].includes(finding.code)))
  );
  const confirmedChannel = Boolean(urlCheck?.ok && urlCheck.https_ok && (urlCheck.ats_provider || careersPath
    || domainMatchesCompany(company, urlDomain ?? "")));
  const sufficientEvidence = Boolean(
    company && title && description.length >= 160 && postedAt && urlCheck?.ok
    && urlCheck.https_ok && urlCheck.rdap_age_days >= 180 && confirmedChannel
    && unknowns.length === 0 && findings.every((finding) => finding.severity === "informational"),
  );
  const riskLevel = blockedByRule ? "blocked_by_rule"
    : highRisk ? "high_risk"
      : sufficientEvidence ? "lower_risk"
        : "needs_manual_verification";
  const confidence = blockedByRule ? 98 : highRisk ? 85
    : sufficientEvidence ? 72
      : Math.min(75, 35 + (findings.length * 5) + Math.max(0, 4 - unknowns.length) * 3);

  return {
    risk_level: riskLevel,
    risk_findings: findings.slice(0, 20),
    risk_confidence: confidence,
    unknowns: [...new Set(unknowns)].slice(0, 16),
    url_checks: urlCheck ? {
      ok: Boolean(urlCheck.ok),
      error: urlCheck.error ?? null,
      hostname: plain(urlCheck.hostname, 253),
      final_hostname: plain(urlCheck.final_hostname, 253),
      status: Number.isInteger(urlCheck.status) ? urlCheck.status : null,
      redirect_count: Number(urlCheck.redirect_count ?? 0),
      redirected_to_different_host: Boolean(urlCheck.redirected_to_different_host),
      dns_ok: Boolean(urlCheck.dns_ok),
      https_ok: Boolean(urlCheck.https_ok),
      ats_provider: urlCheck.ats_provider ?? null,
      rdap_age_days: urlCheck.rdap_age_days ?? null,
    } : { ok: false, error: "not_inspected" },
    risk_assessed_at: now.toISOString(),
  };
}

function safeErrorCode(error) {
  const code = String(error?.code ?? "inspection_failed");
  return /^[a-z_]{1,40}$/.test(code) ? code : "inspection_failed";
}

export function createCareerRiskService({
  db,
  inspectUrl = inspectCareerUrl,
  resolver,
  fetchImpl,
  now = () => new Date(),
} = {}) {
  if (!db) throw new TypeError("Career risk service requires a database.");

  async function assessJob(jobId, { signal } = {}) {
    if (signal?.aborted) throw Object.assign(new Error("Risk assessment was cancelled."), { code: "cancelled" });
    const { rows } = await db.query(
      `SELECT j.id, j.title, j.company, j.location_text, j.remote_scope_text,
              j.description_text, j.posted_at, j.also_listed_on, j.url,
              a.id AS assessment_id, a.fit_score, a.risk_level
       FROM public.jr_jobs AS j
       LEFT JOIN LATERAL (
         SELECT id, fit_score, risk_level FROM public.jr_assessments
         WHERE job_id = j.id
         ORDER BY assessed_at DESC, id DESC LIMIT 1
       ) AS a ON true
       WHERE j.id = $1::uuid`,
      [jobId],
    );
    const job = rows[0];
    if (!job) return { notFound: true };
    const { rows: settingsRows } = await db.query(
      "SELECT score_threshold FROM public.jr_settings WHERE id = 1",
    );
    const threshold = Number(settingsRows[0]?.score_threshold);
    if (!Number.isFinite(job.fit_score) || !Number.isFinite(threshold) || job.fit_score < threshold) {
      return { skipped: true, skipped_reason: "below_fit_threshold" };
    }

    let urlCheck = null;
    let hostname = careerUrlHostname(job.url);
    if (job.url) {
      let cachedAge = null;
      let rdapCached = false;
      if (hostname && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) && !hostname.includes(":")) {
        const cached = await db.query(
          `SELECT rdap_age_days FROM public.jr_domain_cache
           WHERE domain = $1::text AND expires_at > $2::timestamptz`,
          [hostname, now()],
        );
        rdapCached = Boolean(cached.rows[0]);
        cachedAge = cached.rows[0]?.rdap_age_days ?? null;
      }
      try {
        urlCheck = await inspectUrl(job.url, {
          ...(resolver ? { resolver } : {}),
          ...(fetchImpl ? { fetchImpl } : {}),
          now,
          domainAgeDays: cachedAge,
          skipRdapLookup: rdapCached,
          signal,
        });
        if (signal?.aborted) throw Object.assign(new Error("Risk assessment was cancelled."), { code: "cancelled" });
        hostname = urlCheck.hostname ?? hostname;
      } catch (error) {
        if (signal?.aborted) throw error;
        urlCheck = {
          ok: false,
          error: safeErrorCode(error),
          hostname,
          final_hostname: hostname,
          status: null,
          redirect_count: 0,
          redirected_to_different_host: false,
          dns_ok: false,
          https_ok: false,
          ats_provider: null,
          rdap_age_days: cachedAge,
          page_text: "",
        };
      }
    } else {
      urlCheck = { ok: false, error: "missing_url", hostname: null, final_hostname: null, page_text: "" };
    }

    if (hostname) {
      await db.query(
        `INSERT INTO public.jr_domain_cache (
           domain, checked_at, rdap_age_days, dns_ok, https_ok, ats_provider, expires_at
         ) VALUES ($1::text, $2::timestamptz, $3::integer, $4::boolean, $5::boolean, $6::text, $2::timestamptz + interval '30 days')
         ON CONFLICT (domain) DO UPDATE SET
           checked_at = EXCLUDED.checked_at, rdap_age_days = EXCLUDED.rdap_age_days,
           dns_ok = EXCLUDED.dns_ok, https_ok = EXCLUDED.https_ok,
           ats_provider = EXCLUDED.ats_provider, expires_at = EXCLUDED.expires_at`,
        [
          hostname, now(), urlCheck.rdap_age_days ?? null,
          Boolean(urlCheck.dns_ok), Boolean(urlCheck.https_ok), urlCheck.ats_provider ?? null,
        ],
      );
    }

    if (signal?.aborted) throw Object.assign(new Error("Risk assessment was cancelled."), { code: "cancelled" });
    const risk = assessCareerRisk(job, urlCheck, { now: now() });
    await db.query(
      `UPDATE public.jr_assessments
       SET risk_level = $1::text, risk_findings = $2::jsonb,
           risk_confidence = $3::integer, unknowns = $4::jsonb,
           url_checks = $5::jsonb, risk_assessed_at = $6::timestamptz,
           assessed_at = assessed_at
       WHERE id = $7::uuid`,
      [
        risk.risk_level, JSON.stringify(risk.risk_findings), risk.risk_confidence,
        JSON.stringify(risk.unknowns), JSON.stringify(risk.url_checks),
        risk.risk_assessed_at, job.assessment_id,
      ],
    );
    return risk;
  }

  return { assessJob };
}

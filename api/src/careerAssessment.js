import { careerRoleTrackTerms, stripHtml } from "./careerSources.js";

const remoteEligiblePhrases = ["East Africa", "worldwide", "anywhere", "EMEA", "Africa", "Kenya"];
const restrictedScopePatterns = [
  /\b(?:US|USA|United States)(?:-|\s+)only\b/i,
  /\b(?:UK|United Kingdom)(?:-|\s+)only\b/i,
  /\b(?:EU|European Union)(?:-|\s+)only\b/i,
  /\b(?:not available|not eligible|cannot hire|excluding|except)\s+(?:applicants?\s+in\s+|residents?\s+of\s+|for\s+|in\s+)?Kenya\b/i,
  /\bKenya\s+(?:is\s+)?(?:excluded|not eligible|not available)\b/i,
  /\bmust\s+(?:be\s+located|reside|live)\s+in\s+(?:the\s+)?(?:US|USA|United States|UK|United Kingdom|EU|European Union)\b/i,
  /\b(?:requires?|requiring|must have|must hold)\s+(?:valid\s+)?(?:work|employment)\s+authori[sz]ation\b/i,
  /\b(?:must|required to)\s+(?:have|hold|be eligible for)\s+(?:work\s+)?authori[sz]ation\b/i,
  /\b(?:authorized|authorised|eligible|legally entitled)\s+to\s+work\s+in\b/i,
  /\b(?:work|employment)\s+authori[sz]ation\s+(?:is\s+)?required\b/i,
  /\bvisa sponsorship (?:is )?not (?:available|provided)\b/i,
];
const seniorityPreferred = /\b(junior|entry[- ]level|graduate|trainee|intern(?:ship)?)\b/i;
const seniorityAdvanced = /\b(senior|lead|principal|staff|manager|director|head of)\b/i;

function normalized(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findPhrase(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const match = new RegExp(`(^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])`, "i").exec(text);
  return match ? match[2] : null;
}

function findPattern(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

function detectTrack(title, tags = []) {
  const haystack = normalized([title, ...tags].join(" "));
  return Object.entries(careerRoleTrackTerms).find(([, terms]) =>
    terms.some((term) => haystack.includes(normalized(term))))?.[0] ?? null;
}

export function assessEligibility(job) {
  const location = String(job.location_text ?? "");
  const remoteScope = String(job.remote_scope_text ?? "");
  const description = String(job.description_text ?? "");
  const combined = `${location}\n${remoteScope}\n${description}`;
  const evidence = [];
  const reasonCodes = [];
  const restrictedPhrase = findPattern(combined, restrictedScopePatterns);
  if (restrictedPhrase) {
    evidence.push({ rule: "restricted_scope", phrase: stripHtml(restrictedPhrase, 120) });
    return { eligibility: "ineligible", evidence, reasonCodes: ["restricted_scope"] };
  }

  const remote = /\b(remote|hybrid|work from (?:anywhere|home))\b/i.test(`${location} ${remoteScope}`)
    || /\bremote\b/i.test(description);
  if (remote) {
    for (const phrase of remoteEligiblePhrases) {
      const matched = findPhrase(combined, phrase);
      if (matched) {
        evidence.push({ rule: "remote_location", phrase: stripHtml(matched, 120) });
        return { eligibility: "eligible", evidence, reasonCodes: ["remote_kenya_evidence"] };
      }
    }

    for (const country of ["Tanzania", "Uganda"]) {
      const phrase = findPhrase(combined, country);
      if (phrase) {
        evidence.push({ rule: "work_permission_review", phrase: stripHtml(phrase, 120) });
        return { eligibility: "unknown", evidence, reasonCodes: ["needs_work_permission_review"] };
      }
    }

    const scopedCountryText = `${location}\n${remoteScope}`;
    const scopedCountryList = [...scopedCountryText.matchAll(/\b(?:US|USA|United States|UK|United Kingdom|Canada|Mexico|Australia|New Zealand|Germany|France|Spain|Italy|Netherlands|Sweden|Norway|Denmark|India|Singapore|Brazil|Japan|China|South Africa|Nigeria|Ghana)\b/gi)];
    const descriptionCountryList = findPattern(description, [
      /\b(?:eligible countries|eligible locations|locations|countries|available in|remote only in)\s*[:=-]\s*[^.;\n]{3,160}/i,
    ]);
    const countryListPhrase = scopedCountryList.length
      ? scopedCountryText
      : descriptionCountryList;
    if (countryListPhrase) {
      const kenyaMention = findPhrase(combined, "Kenya");
      if (!kenyaMention) {
        evidence.push({ rule: "country_list_excludes_kenya", phrase: stripHtml(countryListPhrase, 120) });
        return { eligibility: "ineligible", evidence, reasonCodes: ["kenya_excluded"] };
      }
    }
    reasonCodes.push("eligibility_ambiguous");
    const ambiguousPhrase = findPhrase(combined, "remote") ?? findPhrase(combined, "hybrid");
    if (ambiguousPhrase) evidence.push({ rule: "ambiguous_remote_scope", phrase: ambiguousPhrase });
    return { eligibility: "unknown", evidence, reasonCodes };
  }

  const kenya = findPhrase(location, "Kenya");
  if (kenya) {
    evidence.push({ rule: "onsite_country", phrase: stripHtml(kenya, 120) });
    return { eligibility: "eligible", evidence, reasonCodes: ["kenya_onsite_or_hybrid"] };
  }
  for (const country of ["Tanzania", "Uganda"]) {
    const phrase = findPhrase(location, country);
    if (phrase) {
      evidence.push({ rule: "work_permission_review", phrase: stripHtml(phrase, 120) });
      return {
        eligibility: "unknown",
        evidence,
        reasonCodes: ["needs_work_permission_review"],
      };
    }
  }
  reasonCodes.push("eligibility_ambiguous");
  return { eligibility: "unknown", evidence, reasonCodes };
}

function extractFactTerms(value, keyPath = "", output = []) {
  if (Array.isArray(value)) {
    for (const item of value) extractFactTerms(item, keyPath, output);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      extractFactTerms(nested, `${keyPath} ${key}`, output);
    }
  } else if (typeof value === "string"
    && /\b(skills?|tasks?|competenc(?:y|ies)|requirements?)\b/i.test(keyPath.replace(/[_-]+/g, " "))
    && !/\b(preferred|nice.to.have|optional)\b/i.test(keyPath.replace(/[_-]+/g, " "))) {
    const term = stripHtml(value, 120).trim();
    if (term.length >= 2 && !output.includes(term)) output.push(term);
  }
  return output;
}

function extractPreferredTerms(value, keyPath = "", output = []) {
  if (Array.isArray(value)) {
    for (const item of value) extractPreferredTerms(item, keyPath, output);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      extractPreferredTerms(nested, `${keyPath} ${key}`, output);
    }
  } else if (typeof value === "string"
    && /\b(preferred|nice.to.have|optional)\b/i.test(keyPath.replace(/[_-]+/g, " "))) {
    const term = stripHtml(value, 120).trim();
    if (term.length >= 2 && !output.includes(term)) output.push(term);
  }
  return output;
}

function containsTerm(text, term) {
  const haystack = normalized(text);
  const needle = normalized(term);
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}

function datePoints(job, now) {
  const deadline = job.deadline_at ? new Date(job.deadline_at) : null;
  if (deadline && !Number.isNaN(deadline.getTime())) {
    return deadline >= now ? 5 : 0;
  }
  const posted = job.posted_at ? new Date(job.posted_at) : null;
  if (!posted || Number.isNaN(posted.getTime())) return 2.5;
  const ageDays = (now.getTime() - posted.getTime()) / 86_400_000;
  if (ageDays <= 7) return 5;
  if (ageDays <= 30) return 3;
  return 0;
}

export function assessJob(job, profile, settings, { now = new Date() } = {}) {
  const track = detectTrack(job.title, job.tags ?? []);
  const eligibility = assessEligibility(job);
  const profileFacts = profile?.verified_facts ?? {};
  const requiredTerms = extractFactTerms(profileFacts);
  const preferredTerms = extractPreferredTerms(profileFacts);
  const roleTerms = track ? careerRoleTrackTerms[track] : [];
  const jobText = [job.title, ...(job.tags ?? []), job.description_text].join(" ");
  const requiredMatches = requiredTerms.filter((term) => containsTerm(jobText, term));
  const preferredMatches = preferredTerms.filter((term) => containsTerm(jobText, term));
  const trackMatches = roleTerms.filter((term) => containsTerm(job.description_text ?? "", term));
  const hasProfile = Boolean(profile);
  const skillPoints = hasProfile
    ? requiredTerms.length ? 35 * requiredMatches.length / requiredTerms.length : 0
    : roleTerms.length ? 35 * trackMatches.length / roleTerms.length : 0;
  const titlePoints = track ? 25 : 0;
  const locationPoints = eligibility.eligibility === "eligible" ? 15 : eligibility.eligibility === "unknown" ? 7.5 : 0;
  const seniorityText = `${job.title ?? ""} ${job.description_text ?? ""}`;
  const seniorityPoints = seniorityPreferred.test(seniorityText)
    ? 10
    : seniorityAdvanced.test(seniorityText) ? 0 : 5;
  const preferredPoints = preferredTerms.length ? 10 * preferredMatches.length / preferredTerms.length : 0;
  const recencyPoints = datePoints(job, now);
  const excludedText = `${job.title ?? ""} ${job.company ?? ""} ${job.location_text ?? ""} ${job.description_text ?? ""}`;
  const excludedKeyword = (settings.excluded_keywords ?? []).find((keyword) => containsTerm(excludedText, keyword));
  const excludedCompany = (settings.excluded_companies ?? []).find((company) =>
    normalized(company) && normalized(job.company).includes(normalized(company)));
  const reasonCodes = [...eligibility.reasonCodes];
  const uncertainty = [];
  if (!track) reasonCodes.push("track_unmatched");
  if (!hasProfile) {
    reasonCodes.push("profile_missing");
    uncertainty.push("Skill evidence uses track keywords only; reassess after a profile is available.");
  } else if (requiredTerms.length === 0) {
    uncertainty.push("No verified skill or task requirements were provided in the selected profile.");
  } else if (requiredMatches.length < requiredTerms.length) {
    uncertainty.push("Some verified profile skill or task terms do not appear in the advert.");
  }
  if (eligibility.eligibility === "unknown") uncertainty.push("Eligibility evidence is ambiguous.");
  if (excludedKeyword) reasonCodes.push("excluded_keyword");
  if (excludedCompany) reasonCodes.push("excluded_company");
  if (track) reasonCodes.push("track_match");

  const unfilteredScore = skillPoints + titlePoints + locationPoints
    + seniorityPoints + preferredPoints + recencyPoints;
  const fitScore = excludedKeyword || excludedCompany ? 0 : Math.round(unfilteredScore);
  const threshold = Number(settings.score_threshold ?? 65);
  if (fitScore < threshold) reasonCodes.push("below_threshold");
  else reasonCodes.push("threshold_met");
  const matched = [
    ...requiredMatches.map((term) => ({ type: "verified_skill_or_task", value: term })),
    ...preferredMatches.map((term) => ({ type: "preferred_skill", value: term })),
    ...(!hasProfile ? trackMatches.map((term) => ({ type: "track_keyword", value: term })) : []),
    ...(track ? [{ type: "role_track", value: track }] : []),
    ...eligibility.evidence.map((item) => ({ type: "eligibility_evidence", ...item })),
  ];
  const missing = [
    ...requiredTerms.filter((term) => !requiredMatches.includes(term))
      .map((term) => ({ type: "verified_skill_or_task", value: term })),
    ...preferredTerms.filter((term) => !preferredMatches.includes(term))
      .map((term) => ({ type: "preferred_skill", value: term })),
    ...(!hasProfile
      ? roleTerms.filter((term) => !trackMatches.includes(term))
        .map((term) => ({ type: "track_keyword", value: term }))
      : []),
  ];
  if (excludedKeyword) matched.push({ type: "excluded_keyword", value: excludedKeyword });
  if (excludedCompany) matched.push({ type: "excluded_company", value: excludedCompany });
  return {
    track,
    eligibility: eligibility.eligibility,
    eligibility_evidence: eligibility.evidence,
    fit_score: fitScore,
    fit_breakdown: {
      required_skill_task_evidence: { weight: 35, points: Math.round(skillPoints * 100) / 100 },
      title_role_family: { weight: 25, points: titlePoints },
      country_work_authorization_remote: { weight: 15, points: locationPoints },
      seniority_fit: { weight: 10, points: seniorityPoints },
      preferred_skill_overlap: { weight: 10, points: Math.round(preferredPoints * 100) / 100 },
      recency_deadline: { weight: 5, points: recencyPoints },
      threshold,
      excluded: Boolean(excludedKeyword || excludedCompany),
    },
    matched,
    missing,
    reason_codes: [...new Set(reasonCodes)],
    uncertainty,
  };
}

export function createCareerAssessmentService({ db, now = () => new Date() } = {}) {
  if (!db) throw new TypeError("Career assessment service requires a database.");

  async function assessJobId(jobId) {
    const [{ rows: jobs }, { rows: settingsRows }] = await Promise.all([
      db.query(
        `SELECT id, title, company, location_text, remote_scope_text, description_text,
                tags, posted_at, status
         FROM public.jr_jobs WHERE id = $1`,
        [jobId],
      ),
      db.query(
        `SELECT score_threshold, excluded_keywords, excluded_companies
         FROM public.jr_settings WHERE id = 1`,
      ),
    ]);
    const job = jobs[0];
    const settings = settingsRows[0];
    if (!job) return false;
    if (!settings) throw new Error("Career settings row is missing.");
    const track = detectTrack(job.title, job.tags ?? []);
    let profile = null;
    if (track) {
      const { rows } = await db.query(
        `SELECT id, track, verified_facts
         FROM public.jr_resume_profiles
         WHERE archived_at IS NULL
         ORDER BY updated_at DESC`,
      );
      profile = rows.find((candidate) => {
        const candidateTrack = normalized(candidate.track);
        return track === "Security Analyst/SOC"
          ? /(security|soc|cyber)/.test(candidateTrack)
          : /(computer|ict|trainer|training|digital skills)/.test(candidateTrack);
      }) ?? null;
    }
    const assessment = assessJob(job, profile, settings, { now: now() });
    const profileId = profile?.id ?? null;
    const query = profileId
      ? `INSERT INTO public.jr_assessments (
           job_id, profile_id, track, eligibility, eligibility_evidence, fit_score,
           fit_breakdown, matched, missing, reason_codes, uncertainty, rules_version
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11::jsonb, 1)
         ON CONFLICT (job_id, profile_id) DO UPDATE SET
           track = EXCLUDED.track, eligibility = EXCLUDED.eligibility,
           eligibility_evidence = EXCLUDED.eligibility_evidence, fit_score = EXCLUDED.fit_score,
           fit_breakdown = EXCLUDED.fit_breakdown, matched = EXCLUDED.matched,
           missing = EXCLUDED.missing, reason_codes = EXCLUDED.reason_codes,
           uncertainty = EXCLUDED.uncertainty, rules_version = EXCLUDED.rules_version,
           assessed_at = now()`
      : `INSERT INTO public.jr_assessments (
           job_id, profile_id, track, eligibility, eligibility_evidence, fit_score,
           fit_breakdown, matched, missing, reason_codes, uncertainty, rules_version
         ) VALUES ($1, NULL, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::jsonb, 1)
         ON CONFLICT (job_id) WHERE profile_id IS NULL DO UPDATE SET
           track = EXCLUDED.track, eligibility = EXCLUDED.eligibility,
           eligibility_evidence = EXCLUDED.eligibility_evidence, fit_score = EXCLUDED.fit_score,
           fit_breakdown = EXCLUDED.fit_breakdown, matched = EXCLUDED.matched,
           missing = EXCLUDED.missing, reason_codes = EXCLUDED.reason_codes,
           uncertainty = EXCLUDED.uncertainty, rules_version = EXCLUDED.rules_version,
           assessed_at = now()`;
    const values = profileId
      ? [
        job.id, profileId, assessment.track, assessment.eligibility,
        JSON.stringify(assessment.eligibility_evidence), assessment.fit_score,
        JSON.stringify(assessment.fit_breakdown), JSON.stringify(assessment.matched),
        JSON.stringify(assessment.missing), assessment.reason_codes,
        JSON.stringify(assessment.uncertainty),
      ]
      : [
        job.id, assessment.track, assessment.eligibility,
        JSON.stringify(assessment.eligibility_evidence), assessment.fit_score,
        JSON.stringify(assessment.fit_breakdown), JSON.stringify(assessment.matched),
        JSON.stringify(assessment.missing), assessment.reason_codes,
        JSON.stringify(assessment.uncertainty),
      ];
    await db.query(query, values);
    await db.query(
      "UPDATE public.jr_jobs SET status = 'screened' WHERE id = $1 AND status IN ('discovered', 'screened')",
      [job.id],
    );
    return true;
  }

  async function reassessAll() {
    const { rows } = await db.query("SELECT id FROM public.jr_jobs ORDER BY first_seen_at, id");
    const result = { assessed: 0, failed: 0 };
    for (const { id } of rows) {
      try {
        if (await assessJobId(id)) result.assessed++;
      } catch (error) {
        result.failed++;
        console.warn(`Career assessment for job ${id} failed: ${String(error?.message ?? "Assessment failed.").slice(0, 300)}`);
      }
    }
    return result;
  }

  return { assessJob: assessJobId, reassessAll };
}

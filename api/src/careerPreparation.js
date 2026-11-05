const MAX_RESUME_SOURCE_CHARS = 60_000;
const MAX_COVER_LETTER_CHARS = 12_000;
const MAX_HIGHLIGHTS = 8;
const MIN_HIGHLIGHT_SCORE = 2;

function cleanText(value, maxLength = 6000) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalize(value) {
  return cleanText(value, 1000).toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
}

function termsFrom(values) {
  const terms = [];
  for (const value of values) {
    const term = cleanText(value, 120);
    if (term.length < 2) continue;
    const normalized = normalize(term);
    if (normalized && !terms.some((entry) => entry.normalized === normalized)) {
      terms.push({ label: term, normalized });
    }
  }
  return terms;
}

function profileFactTerms(profile) {
  const facts = profile?.verified_facts && typeof profile.verified_facts === "object"
    ? profile.verified_facts
    : {};
  const values = [];
  for (const key of ["required_skills", "tasks", "preferred_skills", "skills", "experience", "certifications"]) {
    const entry = facts[key];
    if (Array.isArray(entry)) values.push(...entry);
    else if (typeof entry === "string" && entry.trim()) values.push(...entry.split(/[,;\n]/));
  }
  return termsFrom(values);
}

function isSectionHeading(line) {
  const value = line.trim();
  if (!value || value.length > 72) return false;
  if (/^(?:[A-Z][A-Z &/()\-]{2,}|(?:professional|technical|work|employment|education|certification|project|experience|skills|summary|profile|training)\s+(?:summary|experience|history|skills|details|and\s+certifications))$/i.test(value)) return true;
  return /^(?:\d+\.?\s+)?(?:professional summary|profile|work experience|employment history|technical skills|education|certifications?|projects|selected projects|volunteer experience|professional experience|core competencies|training|references)$/i.test(value);
}

function scoreSourceLine(line, roleTerms, factTerms) {
  const normalizedLine = normalize(line);
  if (normalizedLine.length < 24 || isSectionHeading(line)) return { score: 0, terms: [] };
  const matched = [];
  let score = 0;
  for (const term of roleTerms) {
    if (term.normalized.length >= 3 && (` ${normalizedLine} `).includes(` ${term.normalized} `)) {
      score += 2;
      matched.push(term.label);
    }
  }
  for (const term of factTerms) {
    if (term.normalized.length >= 3 && (` ${normalizedLine} `).includes(` ${term.normalized} `)) {
      score += 3;
      matched.push(term.label);
    }
  }
  return { score, terms: [...new Set(matched)] };
}

function relevantSourceLines(masterResume, job, factTerms) {
  const description = cleanText(job.description_text, 6000);
  const jobText = [job.title, job.company, job.location_text, job.remote_scope_text, ...((job.tags ?? []).filter((tag) => typeof tag === "string")), description].join(" ");
  const stopWords = new Set(["and", "the", "for", "with", "from", "your", "you", "our", "are", "will", "this", "that", "have", "has", "was", "were", "job", "role", "work", "team", "about", "into", "who", "what", "how", "their", "they", "our", "not", "all", "can", "may", "must", "should", "years", "year", "required", "requirements", "preferred", "experience", "knowledge", "skills"]);
  const roleTerms = termsFrom(jobText.match(/[A-Za-z][A-Za-z0-9+#./-]{2,}/g) ?? [])
    .filter(({ normalized }) => normalized.length >= 3 && !stopWords.has(normalized));
  const lines = masterResume.split(/\r?\n/);
  const ranked = lines.map((line, index) => {
    const result = scoreSourceLine(line, roleTerms, factTerms);
    return { line: line.trim(), index, ...result };
  }).filter((entry) => entry.score >= MIN_HIGHLIGHT_SCORE
    && entry.line.length > 24
    && entry.line.length <= 500);
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = ranked.slice(0, MAX_HIGHLIGHTS).sort((a, b) => a.index - b.index);
  const unique = [];
  for (const entry of selected) {
    if (!unique.some((item) => normalize(item.line) === normalize(entry.line))) unique.push(entry);
  }
  return unique.map((entry) => ({
    text: entry.line,
    evidenceTerms: entry.terms.slice(0, 8),
    sourceLine: entry.index + 1,
  }));
}

function applicantNameFrom(masterResume) {
  const first = masterResume.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  if (first.length >= 3 && first.length <= 80 && /^[\p{L}][\p{L} .'-]+$/u.test(first) && first.split(/\s+/).length >= 2) {
    return first;
  }
  return "Applicant";
}

function safeGreetingName(company) {
  const clean = cleanText(company, 120);
  return clean && clean.toLowerCase() !== "company not listed" ? clean : "your team";
}

export function buildApplicationDraft({ job, profile, assessment = null, now = new Date() } = {}) {
  if (!job || !profile) throw new TypeError("A matched job and verified master CV profile are required.");
  const masterResume = typeof profile.original_text === "string" ? profile.original_text : "";
  if (masterResume.length > MAX_RESUME_SOURCE_CHARS) {
    throw new Error("The saved master CV exceeds the 60,000-character limit. Review the saved original CV before generating an application.");
  }
  if (masterResume.trim().length < 120) {
    throw new Error("The master CV is too short to prepare a reliable application. Review the saved original CV first.");
  }
  const title = cleanText(job.title, 200);
  if (!title) throw new Error("The job advert has no usable title.");
  const company = safeGreetingName(job.company);
  const factTerms = profileFactTerms(profile);
  const highlights = relevantSourceLines(masterResume, job, factTerms);
  const verifiedFactList = factTerms.map((term) => term.label).slice(0, 20);
  const missingRequirements = Array.isArray(assessment?.missing)
    ? assessment.missing.map((item) => cleanText(item?.value, 120)).filter(Boolean).slice(0, 30)
    : [];
  const matchEvidence = Array.isArray(assessment?.matched)
    ? assessment.matched
      .filter((item) => item?.type === "verified_skill_or_task" || item?.type === "preferred_skill")
      .map((item) => cleanText(item.value, 120))
      .filter(Boolean)
      .slice(0, 20)
    : [];
  const resumeText = [
    "ROLE-ALIGNED HIGHLIGHTS",
    `Target role: ${title}`,
    `Employer: ${company}`,
    "The highlights below are selected from the saved master CV. The full original CV follows unchanged.",
    ...(highlights.length
      ? highlights.map((item) => `• ${item.text}`)
      : ["No high-confidence matching CV lines were found. Review the advert and master CV manually before sending."]),
    "",
    "FULL MASTER CV — ORIGINAL TEXT PRESERVED",
    "----------------------------------------",
    masterResume,
  ].join("\n").slice(0, MAX_RESUME_SOURCE_CHARS + 5000);
  const topFacts = matchEvidence.length ? matchEvidence.slice(0, 4) : verifiedFactList.slice(0, 4);
  const evidenceSentence = topFacts.length
    ? `My background includes ${topFacts.slice(0, 3).join(", ")}, with supporting details in my CV. I have kept the application grounded in that documented experience rather than adding new qualifications or claims.`
    : "I have kept this application grounded in my original CV and have not added qualifications or experience that are not documented there.";
  const roleContext = highlights.length
    ? `I was interested in this opportunity because it connects with experience documented in my CV, including ${highlights.slice(0, 2).map((item) => item.text.replace(/[.]+$/, "")).join("; ")}.`
    : "I would welcome the opportunity to discuss how my documented background may fit the team's current needs.";
  const coverLetterText = [
    "Dear Hiring Team,",
    "",
    `I am applying for the ${title} position at ${company}. ${roleContext}`,
    "",
    evidenceSentence,
    "",
    "I would welcome the opportunity to discuss the role and how my verified skills and experience align with the work required. Thank you for considering my application.",
    "",
    "Kind regards,",
    applicantNameFrom(masterResume),
  ].join("\n").slice(0, MAX_COVER_LETTER_CHARS);
  const warnings = [];
  if (!highlights.length) warnings.push("No high-confidence CV excerpts were matched. Review the full original CV rather than relying on the highlights.");
  if (!assessment || !Array.isArray(assessment.matched)) warnings.push("No current fit assessment was available when the packet was generated.");
  if (assessment?.eligibility !== "eligible") warnings.push("Work location/authorization is not confirmed eligible. Check it before applying.");
  if (missingRequirements.length) warnings.push(`The current assessment lists possible missing requirements: ${missingRequirements.join(", ")}. Do not claim these unless you can verify them.`);
  if (!job.url) warnings.push("The source listing has no verified application URL. Confirm the application destination before sending.");
  return {
    title,
    company,
    roleTrack: cleanText(profile.track, 120),
    sourceProfileId: profile.id,
    sourceProfileName: cleanText(profile.name, 120),
    sourceMasterResume: masterResume,
    resumeText,
    coverLetterText,
    verifiedFacts: verifiedFactList,
    highlights,
    missingRequirements,
    warnings,
    source: {
      jobId: job.id,
      applicationUrl: cleanText(job.url, 2000),
      sourceName: cleanText(job.source_name, 120),
      sourceAttribution: cleanText(job.attribution_text, 200),
      assessmentScore: typeof assessment?.fit_score === "number" ? assessment.fit_score : null,
      eligibility: assessment?.eligibility ?? "unknown",
      generatedAt: now.toISOString(),
    },
  };
}

function winAnsiBytes(value) {
  const mapped = String(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2022]/g, "*")
    .replace(/[\u2026]/g, "...")
    .replace(/[\u00A0]/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, "?");
  return Buffer.from(mapped, "latin1");
}

function pdfString(value) {
  const bytes = winAnsiBytes(value);
  let escaped = "";
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) escaped += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x20 || byte > 0x7e) escaped += `\\${byte.toString(8).padStart(3, "0")}`;
    else escaped += String.fromCharCode(byte);
  }
  return escaped;
}

function wrapLine(value, max = 92) {
  const words = value.trim().split(/\s+/);
  if (!value.trim()) return [""];
  const result = [];
  let current = "";
  for (const word of words) {
    if (word.length > max) {
      if (current) result.push(current);
      for (let start = 0; start < word.length; start += max) result.push(word.slice(start, start + max));
      current = "";
    } else if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= max) {
      current += ` ${word}`;
    } else {
      result.push(current);
      current = word;
    }
  }
  if (current) result.push(current);
  return result;
}

export function createTextPdf({ title, text, generatedAt = new Date() } = {}) {
  const cleanedTitle = cleanText(title, 160) || "Application document";
  const cleanedText = cleanText(text, MAX_RESUME_SOURCE_CHARS + 5000);
  if (!cleanedText) throw new TypeError("Cannot create a PDF from empty text.");
  const lines = [];
  for (const rawLine of cleanedText.split(/\r?\n/)) lines.push(...wrapLine(rawLine, 92));
  const linesPerPage = 49;
  const chunks = [];
  for (let index = 0; index < lines.length; index += linesPerPage) chunks.push(lines.slice(index, index + linesPerPage));
  if (!chunks.length) chunks.push([""]);
  const objects = [];
  const pushObject = (content) => {
    objects.push(Buffer.isBuffer(content) ? content : Buffer.from(content, "latin1"));
    return objects.length;
  };
  const catalogId = pushObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = pushObject("PAGES_PLACEHOLDER");
  const regularFontId = pushObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const boldFontId = pushObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const contentLines = [
      "BT",
      "/F2 15 Tf",
      "54 746 Td",
      `(${pdfString(cleanedTitle)}) Tj`,
      "/F1 8 Tf",
      "0 -18 Td",
      `(${pdfString(`Generated ${generatedAt.toISOString().slice(0, 10)} · Private application draft`)}) Tj`,
      "/F1 10 Tf",
      "0 -24 Td",
    ];
    let y = 704;
    for (const line of chunks[index]) {
      const trimmed = line.trim();
      const heading = trimmed.length > 0 && trimmed.length < 58
        && (/^[A-Z][A-Z0-9 &'()/+-]{2,}$/.test(trimmed) || /^ROLE-ALIGNED|^FULL MASTER CV|^Target role:|^Employer:/.test(trimmed));
      if (heading) contentLines.push("/F2 10 Tf");
      else contentLines.push("/F1 10 Tf");
      contentLines.push(`(${pdfString(line)}) Tj`);
      contentLines.push("0 -13 Td");
      y -= 13;
      if (y < 30) break;
    }
    contentLines.push("ET");
    const stream = Buffer.from(contentLines.join("\n"), "latin1");
    const contentObject = Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"),
      stream,
      Buffer.from("\nendstream", "latin1"),
    ]);
    pushObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pushObject(contentObject);
  }
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`, "latin1");
  const parts = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [0];
  let offset = parts[0].length;
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(offset);
    const head = Buffer.from(`${index + 1} 0 obj\n`, "latin1");
    const tail = Buffer.from("\nendobj\n", "latin1");
    parts.push(head, objects[index], tail);
    offset += head.length + objects[index].length + tail.length;
  }
  const xrefOffset = offset;
  const xrefLines = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ];
  parts.push(Buffer.from(xrefLines.join("\n"), "latin1"));
  return Buffer.concat(parts);
}

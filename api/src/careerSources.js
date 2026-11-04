import { createHash } from "node:crypto";

const sourceHosts = new Map([
  ["jobicy", new Set(["jobicy.com"])],
  ["remoteok", new Set(["remoteok.com"])],
  ["remotive", new Set(["remotive.com"])],
  ["arbeitnow", new Set(["arbeitnow.com", "www.arbeitnow.com"])],
  ["greenhouse", new Set(["boards-api.greenhouse.io"])],
  ["lever", new Set(["api.lever.co"])],
]);
const lastRequestAt = new Map();
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ARBEITNOW_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const requestTimeoutMs = 15_000;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export const careerRoleTrackTerms = {
  "Security Analyst/SOC": [
    "junior security analyst",
    "security analyst",
    "cybersecurity analyst",
    "cyber security analyst",
    "soc analyst",
    "security operations analyst",
    "information security analyst",
    "security monitoring analyst",
  ],
  "Computer Skills/ICT Trainer": [
    "computer skills trainer",
    "ict trainer",
    "digital skills trainer",
    "it trainer",
    "computer instructor",
    "ict tutor",
  ],
};
const roleTitleVariants = Object.values(careerRoleTrackTerms).flat();
export const jobicyQueryTerms = [
  "security analyst",
  "soc analyst",
  "ict trainer",
  "computer skills trainer",
];
export const remotiveQueryTerms = Object.freeze([...jobicyQueryTerms]);

const defaultRoleTracks = Object.freeze([
  "Security Analyst/SOC",
  "Computer Skills/ICT Trainer",
]);

export function buildCareerSearchTerms(roleTracks = defaultRoleTracks) {
  const terms = [];
  const add = (value) => {
    const clean = stripHtml(String(value ?? ""), 80).replace(/\\s+/g, " ").trim();
    if (clean && !terms.some((item) => item.toLowerCase() === clean.toLowerCase())) terms.push(clean);
  };
  for (const track of roleTracks) {
    const normalized = String(track ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!normalized) continue;
    add(track);
    if (/security|cyber|soc/.test(normalized)) {
      add("security analyst");
      add("SOC analyst");
      add("cybersecurity analyst");
    } else if (/trainer|training|ict|computer skills|digital skills|instructor/.test(normalized)) {
      add("ICT trainer");
      add("computer skills trainer");
      add("digital skills trainer");
    }
  }
  return (terms.length ? terms : [...defaultRoleTracks]).slice(0, 30);
}

function validSearchTerm(value) {
  const clean = stripHtml(typeof value === "string" ? value : "", 80).replace(/\\s+/g, " ").trim();
  return clean.length >= 2 ? clean : null;
}

function delay(milliseconds, signal) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Request aborted."));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryAfterMilliseconds(value, now) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

function decodeNumericEntity(codePoint) {
  const parsed = Number(codePoint);
  try {
    return Number.isInteger(parsed) ? String.fromCodePoint(parsed) : " ";
  } catch {
    return " ";
  }
}

function combineSignals(parent, controller) {
  if (!parent) return controller.signal;
  if (parent.aborted) {
    controller.abort(parent.reason);
    return controller.signal;
  }
  const abort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", abort, { once: true });
  controller.cleanup = () => parent.removeEventListener("abort", abort);
  return controller.signal;
}

async function readBoundedBody(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Source response exceeded the size limit.");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Source response exceeded the size limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function fetchSourceJson(urlValue, {
  source,
  fetchImpl = fetch,
  sleep = delay,
  now = Date.now,
  signal,
  onRequest = async () => {},
  maxRequests = 3,
  minIntervalMs = 0,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
} = {}) {
  const url = new URL(urlValue);
  const hosts = sourceHosts.get(source);
  if (url.protocol !== "https:" || !hosts?.has(url.hostname) || url.username || url.password) {
    throw new Error("Source URL is not on its fixed HTTPS host.");
  }

  let lastError;
  const attempts = Math.min(3, Math.max(0, maxRequests));
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error("Scan budget exceeded.");
    const controller = new AbortController();
    const requestSignal = combineSignals(signal, controller);
    const timeout = setTimeout(() => controller.abort(new Error("Source request timed out.")), requestTimeoutMs);
    try {
      let target = url;
      let response;
      for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
        if (signal?.aborted) throw signal.reason ?? new Error("Scan budget exceeded.");
        const previousAt = lastRequestAt.get(source) ?? 0;
        await sleep(Math.max(0, previousAt + minIntervalMs - now()), signal);
        await onRequest();
        lastRequestAt.set(source, now());
        response = await fetchImpl(target, {
          method: "GET",
          headers: { Accept: "application/json" },
          redirect: "manual",
          signal: requestSignal,
        });
        if (!redirectStatuses.has(response.status)) break;
        if (redirectCount === 3) throw new Error("Source exceeded the redirect limit.");
        const location = response.headers.get("location");
        if (!location) throw new Error("Source redirect did not include a location.");
        const redirected = new URL(location, target);
        if (redirected.protocol !== "https:" || redirected.hostname !== url.hostname
          || redirected.username || redirected.password) {
          throw new Error("Source redirect left its fixed HTTPS host.");
        }
        target = redirected;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < attempts - 1) {
        const backoff = Math.max(250 * (2 ** attempt), retryAfterMilliseconds(response.headers.get("retry-after"), now()));
        await sleep(backoff, signal);
        lastError = new Error(`Source returned HTTP ${response.status}.`);
        continue;
      }
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
      const body = await readBoundedBody(response, maxResponseBytes);
      try {
        return JSON.parse(body.toString("utf8"));
      } catch {
        throw new Error("Source response was not valid JSON.");
      }
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (error?.name === "AbortError" || error?.cause?.name === "AbortError") {
        lastError = new Error("Source request timed out.");
      }
      if (attempt < attempts - 1) await sleep(250 * (2 ** attempt), signal);
    } finally {
      clearTimeout(timeout);
      controller.cleanup?.();
    }
  }
  throw lastError ?? new Error("Source request failed.");
}

export function stripHtml(value, maxLength = 6000) {
  if (typeof value !== "string") return "";
  const plain = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => decodeNumericEntity(code))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => decodeNumericEntity(Number.parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(plain).slice(0, maxLength).join("");
}

export function normalizeHttpUrl(value) {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeText(value, maxLength) {
  return stripHtml(typeof value === "string" ? value : "", maxLength);
}

function normalizeTags(values) {
  const entries = Array.isArray(values) ? values : typeof values === "string" ? [values] : [];
  return [...new Set(entries.map((value) => normalizeText(
    typeof value === "string" ? value : value?.name ?? value?.label ?? "",
    80,
  )).filter(Boolean))].slice(0, 40);
}

function normalizeDate(value) {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function matchesRoleTitle(title, tags = [], customRoleTracks = []) {
  const haystack = [title, ...tags]
    .map((value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  const variants = [...roleTitleVariants, ...customRoleTracks.map((term) =>
    String(term).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter(Boolean)];
  return variants.some((variant) => variant.length >= 2
    && (` ${haystack} `).includes(` ${variant} `));
}

export function normalizeJob(raw, sourceKey, defaults = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const title = normalizeText(raw.title ?? raw.jobTitle ?? raw.position ?? raw.text, 300);
  if (!title) return null;
  const rawUrl = raw.url ?? raw.jobUrl ?? raw.absolute_url ?? raw.hostedUrl ?? raw.application_url;
  const url = normalizeHttpUrl(rawUrl);
  const tags = normalizeTags(raw.tags ?? raw.keywords ?? raw.departments ?? raw.jobIndustry ?? raw.jobType ?? raw.categories?.team);
  const description = normalizeText(
    raw.description ?? raw.jobDescription ?? raw.descriptionPlain ?? raw.content ?? raw.body ?? raw.description_html,
    6000,
  );
  const company = normalizeText(raw.company_name ?? raw.company ?? raw.organization ?? raw.companyName ?? defaults.company, 200) || null;
  const location = normalizeText(
    raw.jobGeo ?? raw.candidate_required_location ?? raw.location?.name ?? raw.location ?? raw.location_text ?? raw.categories?.location ?? raw.categories?.allLocations,
    300,
  );
  const remoteValue = raw.remote_scope_text ?? raw.workplaceType ?? raw.remote ?? "";
  const remoteScope = normalizeText(typeof remoteValue === "boolean" ? String(remoteValue) : remoteValue, 300);
  const salary = normalizeText(raw.jobSalary ?? raw.salary ?? raw.compensation ?? "", 300);
  const sourceJobId = String(raw.id ?? raw.uuid ?? url ?? "");
  if (!sourceJobId || sourceJobId.length > 500) return null;
  const postedAt = normalizeDate(raw.pubDate ?? raw.publication_date ?? raw.date ?? raw.created_at ?? raw.createdAt ?? raw.posted_at);
  return {
    source_key: sourceKey,
    source_job_id: sourceJobId,
    url,
    title,
    company,
    location_text: location,
    remote_scope_text: remoteScope,
    description_text: description,
    salary_text: salary || null,
    tags,
    posted_at: postedAt,
  };
}

function rowsFor(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload[key])) return payload[key];
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

function normalizePayload(rows, sourceKey, defaults = {}, customRoleTracks = []) {
  const jobs = [];
  let malformed = 0;
  let discarded = 0;
  const discard_reasons = { title_no_match: 0, malformed: 0, duplicate: 0, other: 0 };
  const sample_discarded_titles = [];
  const matched_titles = [];
  const addTitle = (titles, value) => {
    if (titles.length < 8) {
      const title = stripHtml(value, 120);
      if (title) titles.push(title);
    }
  };
  for (const raw of rows) {
    let job;
    try {
      job = normalizeJob(raw, sourceKey, defaults);
    } catch {
      malformed++;
      discard_reasons.malformed++;
      addTitle(sample_discarded_titles, raw?.title ?? raw?.jobTitle ?? raw?.position ?? raw?.text);
      continue;
    }
    if (!job) {
      malformed++;
      discard_reasons.malformed++;
      addTitle(sample_discarded_titles, raw?.title ?? raw?.jobTitle ?? raw?.position ?? raw?.text);
      continue;
    }
    if (!matchesRoleTitle(job.title, job.tags, customRoleTracks)) {
      discarded++;
      discard_reasons.title_no_match++;
      addTitle(sample_discarded_titles, raw.title ?? raw.jobTitle ?? raw.position ?? raw.text);
      continue;
    }
    jobs.push(job);
    addTitle(matched_titles, job.title);
  }
  return {
    jobs,
    fetched: rows.length,
    malformed,
    discarded,
    discard_reasons,
    sample_discarded_titles,
    matched_titles,
  };
}

async function requestJson(url, options) {
  return fetchSourceJson(url, options);
}

export async function fetchJobicy(options) {
  const term = validSearchTerm(options.queryTerm ?? jobicyQueryTerms[0]);
  if (!term) throw new TypeError("Jobicy search term must contain 2–80 plain-text characters.");
  const url = new URL("https://jobicy.com/api/jobs");
  url.searchParams.set("tag", term);
  const payload = await requestJson(url, {
    ...options,
    source: "jobicy",
    maxRequests: Math.min(1, options.maxRequests ?? 3),
  });
  const result = normalizePayload(rowsFor(payload, "jobs"), "jobicy", {}, options.roleTracks);
  return {
    ...result,
    query_results: [{
      label: `tag:${term}`,
      fetched: result.fetched,
      matched: result.jobs.length,
      discarded: result.discarded + result.malformed,
    }],
  };
}

export async function fetchRemoteOk(options) {
  const payload = await requestJson("https://remoteok.com/api", { ...options, source: "remoteok" });
  const rows = rowsFor(payload, "jobs");
  const result = normalizePayload(rows.slice(1), "remoteok", {}, options.roleTracks);
  return {
    ...result,
    query_results: [{
      label: "latest",
      fetched: result.fetched,
      matched: result.jobs.length,
      discarded: result.discarded + result.malformed,
    }],
  };
}

export async function fetchRemotive(options) {
  const term = validSearchTerm(options.queryTerm ?? remotiveQueryTerms[0]);
  if (!term) throw new TypeError("Remotive search term must contain 2–80 plain-text characters.");
  const url = new URL("https://remotive.com/api/remote-jobs");
  url.searchParams.set("search", term);
  const payload = await requestJson(url, {
    ...options,
    source: "remotive",
    minIntervalMs: 30_000,
  });
  const result = normalizePayload(rowsFor(payload, "jobs"), "remotive", {}, options.roleTracks);
  return {
    ...result,
    query_results: [{
      label: `search:${term}`,
      fetched: result.fetched,
      matched: result.jobs.length,
      discarded: result.discarded + result.malformed,
    }],
  };
}

export async function fetchArbeitnow(options) {
  const payload = await requestJson("https://www.arbeitnow.com/api/job-board-api", {
    ...options,
    source: "arbeitnow",
    maxResponseBytes: ARBEITNOW_MAX_RESPONSE_BYTES,
  });
  return normalizePayload(rowsFor(payload, "data"), "arbeitnow", {}, options.roleTracks);
}

export async function fetchAtsWatchlist(entries, options) {
  const jobs = [];
  let fetched = 0;
  let malformed = 0;
  let discarded = 0;
  const discard_reasons = { title_no_match: 0, malformed: 0, duplicate: 0, other: 0 };
  const sample_discarded_titles = [];
  const matched_titles = [];
  const errors = [];
  for (const entry of entries) {
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(entry.token)) {
      malformed++;
      discard_reasons.malformed++;
      continue;
    }
    const endpoint = entry.provider === "greenhouse"
      ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(entry.token)}/jobs?content=true`
      : entry.provider === "lever"
        ? `https://api.lever.co/v0/postings/${encodeURIComponent(entry.token)}?mode=json`
        : null;
    if (!endpoint) {
      malformed++;
      discard_reasons.malformed++;
      continue;
    }
    try {
      const payload = await requestJson(endpoint, {
        ...options,
        source: entry.provider,
        defaults: { company: entry.label },
      });
      const rows = Array.isArray(payload) ? payload : rowsFor(payload, "jobs");
      const normalized = normalizePayload(rows, "ats_watchlist", { company: entry.label }, options.roleTracks);
      fetched += normalized.fetched;
      malformed += normalized.malformed;
      discarded += normalized.discarded;
      for (const [reason, count] of Object.entries(normalized.discard_reasons)) {
        discard_reasons[reason] += count;
      }
      for (const title of normalized.sample_discarded_titles) {
        if (sample_discarded_titles.length >= 8) break;
        sample_discarded_titles.push(title);
      }
      for (const title of normalized.matched_titles) {
        if (matched_titles.length >= 8) break;
        matched_titles.push(title);
      }
      jobs.push(...normalized.jobs.map((job) => ({
        ...job,
        source_job_id: `${entry.provider}:${job.source_job_id}`,
      })));
    } catch (error) {
      errors.push(`${entry.provider}:${entry.label}: ${error.message}`);
      discard_reasons.other++;
    }
  }
  return {
    jobs,
    fetched,
    malformed,
    discarded,
    discard_reasons,
    sample_discarded_titles,
    matched_titles,
    errors,
  };
}

const adapters = new Map([
  ["jobicy", fetchJobicy],
  ["remoteok", fetchRemoteOk],
  ["remotive", fetchRemotive],
  ["arbeitnow", fetchArbeitnow],
]);

export async function fetchCareerSource(sourceKey, options = {}) {
  if (sourceKey === "ats_watchlist") {
    return fetchAtsWatchlist(options.watchlist ?? [], options);
  }
  const adapter = adapters.get(sourceKey);
  if (!adapter) throw new Error("No adapter is enabled for this source.");
  return adapter(options);
}

export function buildJobIdentity(job) {
  const normalizedUrl = normalizeHttpUrl(job.url) ?? "";
  const company = (job.company ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const title = job.title.toLowerCase().replace(/\s+/g, " ").trim();
  const locationBucket = job.location_text.toLowerCase().replace(/\s+/g, " ").trim();
  const canonicalKey = `${company}|${title}|${locationBucket}|${normalizedUrl}`;
  const contentHash = createHash("sha256").update(JSON.stringify([
    job.title, job.company, job.location_text, job.remote_scope_text,
    job.description_text, job.salary_text, job.tags, job.posted_at, job.url,
  ])).digest("hex");
  return { canonical_key: canonicalKey, content_hash: contentHash };
}

export function resetRequestPacingForTests() {
  lastRequestAt.clear();
}

import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { createCareerRunService, findMissingCareerTables, findMissingJobTables } from "./careerRun.js";
import { assessJob as calculateCareerJobAssessment, createCareerAssessmentService } from "./careerAssessment.js";
import { createCareerApplicationService, applicationStates } from "./careerApplications.js";
import { buildApplicationDraft, createTextPdf } from "./careerPreparation.js";
import { assessCareerRisk } from "./careerRisk.js";
import {
  beginGmailOAuth,
  completeGmailOAuth,
  disconnectGmail,
  getGmailSendAccessToken,
  gmailConnectionStatus,
  sendGmailMessage,
} from "./careerGmail.js";
import { normalizeImportedJob, saveCareerJob } from "./careerImport.js";
import { matchesRoleTitle, normalizeHttpUrl } from "./careerSources.js";
import {
  atsWatchlistCreateSchema,
  applicationCreateSchema,
  applicationPacketPatchSchema,
  applicationPacketSendSchema,
  applicationPrepareSchema,
  applicationPatchSchema,
  applicationStateSchema,
  applicationsQuerySchema,
  careerImportSchema,
  careerJobsQuerySchema,
  careerSettingsSchema,
  jobReviewStatusSchema,
  parseCareerInput,
  resumeProfileCreateSchema,
  resumeProfilePatchSchema,
  sourcePatchSchema,
  uuidSchema,
} from "./careerValidation.js";

const careerTableNames = [
  "jr_settings",
  "jr_resume_profiles",
  "jr_sources",
  "jr_source_state",
  "jr_runs",
  "jr_audit_events",
];
const setupSecretNames = [
  "JOB_CRON_SECRET",
  "DOC_ENCRYPTION_KEY",
  "GMAIL_OAUTH_CLIENT_ID",
  "GMAIL_OAUTH_CLIENT_SECRET",
  "GMAIL_OAUTH_REDIRECT_URI",
];
const missingTablesError = {
  error: "Career foundation tables are missing. Run docs/career-automation/sql/phase-1.sql in Supabase SQL Editor.",
};

function noStore(_req, res, next) {
  res.set("Cache-Control", "no-store");
  next();
}

function createRateLimiter(limit, message, windowMs = 60 * 60 * 1000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: message },
  });
}

async function findMissingTables(db) {
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [careerTableNames],
  );
  const found = new Set(rows.map((row) => row.table_name));
  return careerTableNames.filter((name) => !found.has(name));
}

function sendMissingTables(res, missing) {
  res.status(409).json({ ...missingTablesError, missingTables: missing });
}

function sendMissingIntakeTables(res, missing) {
  const foundationMissing = missing.filter((name) => careerTableNames.includes(name));
  if (foundationMissing.length) return sendMissingTables(res, foundationMissing);
  res.status(409).json({
    error: "Career intake tables are missing. Run docs/career-automation/sql/phase-2.sql in Supabase SQL Editor.",
    missingTables: missing,
  });
}

function findMissingAssessmentTable(db) {
  return db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [["jr_assessments"]],
  ).then(({ rows }) => rows.some((row) => row.table_name === "jr_assessments")
    ? []
    : ["jr_assessments"]);
}

function sendMissingAssessmentTable(res) {
  return res.status(409).json({
    error: "Career assessment table is missing. Run docs/career-automation/sql/phase-3a.sql in Supabase SQL Editor.",
    missingTables: ["jr_assessments"],
  });
}

const applicationTableNames = ["jr_applications", "jr_application_events"];
const phase4MissingTablesError = {
  error: "Career application tables are missing. Run docs/career-automation/sql/phase-4.sql in Supabase SQL Editor.",
};
const preparationTableNames = [
  "jr_application_packets",
  "jr_gmail_oauth_states",
  "jr_gmail_credentials",
];
const preparationMissingTablesError = {
  error: "Application preparation tables are missing. Run api/migrations/008_career_preparation.sql or docs/career-automation/sql/phase-6.sql in Supabase SQL Editor.",
};

async function findMissingApplicationTables(db) {
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [applicationTableNames],
  );
  const found = new Set(rows.map((row) => row.table_name));
  return applicationTableNames.filter((name) => !found.has(name));
}

function sendMissingApplicationTables(res, missing) {
  return res.status(409).json({ ...phase4MissingTablesError, missingTables: missing });
}

async function findMissingPreparationTables(db) {
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [preparationTableNames],
  );
  const found = new Set(rows.map((row) => row.table_name));
  return preparationTableNames.filter((name) => !found.has(name));
}

function sendMissingPreparationTables(res, missing) {
  return res.status(409).json({ ...preparationMissingTablesError, missingTables: missing });
}

function applicationPacketResponse(row) {
  return {
    id: row.id,
    application_id: row.application_id,
    job_id: row.job_id,
    source_profile_id: row.source_profile_id,
    version: Number(row.version),
    status: row.status,
    resume_text: row.resume_text,
    cover_letter_text: row.cover_letter_text,
    recipient_email: row.recipient_email ?? "",
    highlights: Array.isArray(row.highlights) ? row.highlights : [],
    missing_requirements: Array.isArray(row.missing_requirements) ? row.missing_requirements : [],
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    source_snapshot: row.source_snapshot && typeof row.source_snapshot === "object" ? row.source_snapshot : {},
    master_resume_sha256: row.master_resume_sha256,
    gmail_message_id: row.gmail_message_id ?? null,
    sent_at: row.sent_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    title: row.title,
    company: row.company,
    location_text: row.location_text,
    application_url: row.application_url,
    source_name: row.source_name,
    profile_name: row.profile_name,
    profile_track: row.profile_track,
    application_state: row.application_state,
  };
}

function normalizedRole(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function profileMatchesCareerTrack(track, profileTrack) {
  if (!track || !profileTrack) return false;
  const normalizedTrack = normalizedRole(track);
  const normalizedProfile = normalizedRole(profileTrack);
  if (normalizedTrack === normalizedProfile) return true;
  if (track === "Security Analyst/SOC") return /(security|soc|cyber)/.test(normalizedProfile);
  if (track === "Computer Skills/ICT Trainer") return /(computer|ict|trainer|training|digital skills)/.test(normalizedProfile);
  return false;
}

const applicationPacketSelect = `
  SELECT p.*, a.state AS application_state,
         j.title, j.company, j.location_text, j.url AS application_url,
         s.name AS source_name, rp.name AS profile_name, rp.track AS profile_track
  FROM public.jr_application_packets AS p
  JOIN public.jr_applications AS a ON a.id = p.application_id
  JOIN public.jr_jobs AS j ON j.id = p.job_id
  LEFT JOIN public.jr_sources AS s ON s.key = j.source_key
  JOIN public.jr_resume_profiles AS rp ON rp.id = p.source_profile_id
`;

async function findApplicationPacket(db, id) {
  const { rows } = await db.query(`${applicationPacketSelect} WHERE p.id = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
}

async function findLatestApplicationPacket(db, applicationId) {
  const { rows } = await db.query(
    `${applicationPacketSelect}
     WHERE p.application_id = $1
     ORDER BY p.version DESC
     LIMIT 1`,
    [applicationId],
  );
  return rows[0] ?? null;
}

function redirectToCareerCentre(res, query) {
  const allowedOrigin = (process.env.WEB_ORIGINS ?? "").split(",").map((value) => value.trim()).find(Boolean);
  let target;
  try {
    const origin = new URL(allowedOrigin ?? "");
    if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== allowedOrigin) throw new Error("invalid origin");
    target = new URL("/admin/career", origin.origin);
  } catch {
    return res.status(503).send("Career centre return URL is not configured.");
  }
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  return res.redirect(303, target.toString());
}

function nairobiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}`;
}

function serializeSettings(row) {
  return {
    role_tracks: row.role_tracks,
    countries: row.countries,
    remote_eligibility: row.remote_eligibility,
    score_threshold: row.score_threshold,
    max_packets_per_day: row.max_packets_per_day,
    max_sends_per_day: row.max_sends_per_day,
    timezone: row.timezone,
    show_company_name: row.show_company_name,
    public_publishing: row.public_publishing,
    excluded_keywords: row.excluded_keywords ?? [],
    excluded_companies: row.excluded_companies ?? [],
    updated_at: row.updated_at,
  };
}

function hasExpectedCronSecret(req, configuredSecret) {
  const expected = Buffer.from(configuredSecret, "utf8");
  const provided = Buffer.from(req.get("x-cron-secret") ?? "", "utf8");
  return expected.length > 0 && expected.length === provided.length && timingSafeEqual(expected, provided);
}

function requestBodyIsSmall(req) {
  const declaredLength = Number(req.get("content-length") ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength > 1024) return false;
  return Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8") <= 1024;
}

export function registerCareerRoutes(app, db, { requireAdmin, requireSameOrigin, requireCsrfToken }, {
  runService = createCareerRunService({ db }),
  assessmentService = createCareerAssessmentService({ db }),
  applicationService = createCareerApplicationService({ db }),
  fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  const admin = express.Router();
  admin.use(noStore, requireAdmin);

  const scheduleAssessmentRerun = () => {
    setTimeout(() => {
      assessmentService.reassessAll().catch((error) => {
        console.error(`Career profile change reassessment failed: ${String(error?.message ?? "Assessment failed.").slice(0, 300)}`);
      });
    }, 0);
  };

  admin.get("/setup", async (_req, res, next) => {
    try {
      const missing = await findMissingTables(db);
      const missingIntake = await findMissingJobTables(db);
      const missingAssessments = await findMissingAssessmentTable(db);
      const missingPreparation = await findMissingPreparationTables(db);
      const configuration = Object.fromEntries(setupSecretNames.map((name) => [
        name,
        { configured: typeof process.env[name] === "string" && process.env[name].length > 0 },
      ]));
      const sendMode = process.env.JR_SEND_MODE === "live" ? "live" : "draft";
      let gmail = { connected: false, email: null, scopes: [], connected_at: null };
      if (missingPreparation.length === 0) {
        gmail = await gmailConnectionStatus(db);
      }
      res.json({
        configuration,
        JR_SEND_MODE: sendMode,
        tables: { configured: missing.length === 0, missing },
        intakeTables: { configured: missingIntake.length === 0, missing: missingIntake },
        assessmentTables: { configured: missingAssessments.length === 0, missing: missingAssessments },
        preparationTables: { configured: missingPreparation.length === 0, missing: missingPreparation },
        gmail,
      });
    } catch (error) {
      next(error);
    }
  });

  admin.post(
    "/gmail/oauth/start",
    createRateLimiter(5, "Too many Gmail connection attempts.", 60 * 60 * 1000),
    requireSameOrigin,
    requireCsrfToken,
    async (_req, res, next) => {
      try {
        const missing = await findMissingPreparationTables(db);
        if (missing.length) return sendMissingPreparationTables(res, missing);
        const result = await beginGmailOAuth({ db, now });
        res.json(result);
      } catch (error) {
        const message = String(error?.message ?? "");
        if (message.startsWith("Gmail is not configured") || message.startsWith("DOC_ENCRYPTION_KEY")) {
          return res.status(409).json({ error: message });
        }
        next(error);
      }
    },
  );

  admin.get("/gmail/oauth/callback", async (req, res, next) => {
    if (typeof req.query.error === "string") {
      return redirectToCareerCentre(res, { gmail: "denied" });
    }
    const code = req.query.code;
    const state = req.query.state;
    if (typeof code !== "string" || typeof state !== "string") {
      return redirectToCareerCentre(res, { gmail: "error" });
    }
    try {
      const missing = await findMissingPreparationTables(db);
      if (missing.length) return sendMissingPreparationTables(res, missing);
      await completeGmailOAuth({ db, code, state, fetchImpl, now });
      return redirectToCareerCentre(res, { gmail: "connected" });
    } catch (error) {
      const message = String(error?.message ?? "");
      if (message.includes("authorization response")
        || message.includes("expired or was already used")
        || message.includes("does not match")
        || message.includes("did not return")
        || message.includes("grant does not include")
        || message.includes("did not confirm")
        || message.startsWith("Gmail is not configured")
        || message.startsWith("DOC_ENCRYPTION_KEY")) {
        return redirectToCareerCentre(res, { gmail: "error" });
      }
      next(error);
    }
  });

  admin.post(
    "/gmail/disconnect",
    createRateLimiter(10, "Too many Gmail disconnection requests."),
    requireSameOrigin,
    requireCsrfToken,
    async (_req, res, next) => {
      try {
        const missing = await findMissingPreparationTables(db);
        if (missing.length) return sendMissingPreparationTables(res, missing);
        await disconnectGmail(db);
        res.json({ connected: false });
      } catch (error) {
        next(error);
      }
    },
  );

  admin.get("/settings", async (_req, res, next) => {
    try {
      const missing = await findMissingTables(db);
      if (missing.length) return sendMissingTables(res, missing);
      const missingAssessments = await findMissingAssessmentTable(db);
      if (missingAssessments.length) return sendMissingAssessmentTable(res);
      const { rows } = await db.query(
        `SELECT role_tracks, countries, remote_eligibility, score_threshold,
                max_packets_per_day, max_sends_per_day, timezone,
                excluded_keywords, excluded_companies,
                show_company_name, public_publishing, updated_at
         FROM public.jr_settings WHERE id = 1`,
      );
      if (!rows[0]) return sendMissingTables(res, ["jr_settings (seed row id=1)"]);
      res.json(serializeSettings(rows[0]));
    } catch (error) {
      next(error);
    }
  });

  admin.put("/settings", createRateLimiter(30, "Too many career settings updates."), requireSameOrigin, requireCsrfToken, async (req, res, next) => {
    const parsed = parseCareerInput(careerSettingsSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: "Please check the career settings.", details: parsed.error });
    try {
      const missing = await findMissingTables(db);
      if (missing.length) return sendMissingTables(res, missing);
      const missingAssessments = await findMissingAssessmentTable(db);
      if (missingAssessments.length) return sendMissingAssessmentTable(res);
      const value = parsed.data;
      const { rows } = await db.query(
        `UPDATE public.jr_settings
         SET role_tracks = $1, countries = $2, remote_eligibility = $3::jsonb,
             score_threshold = $4, max_packets_per_day = $5, max_sends_per_day = $6,
             timezone = $7, show_company_name = $8, public_publishing = $9,
             excluded_keywords = COALESCE($10::text[], excluded_keywords),
             excluded_companies = COALESCE($11::text[], excluded_companies),
             updated_at = now()
         WHERE id = 1
         RETURNING role_tracks, countries, remote_eligibility, score_threshold,
                   max_packets_per_day, max_sends_per_day, timezone,
                   excluded_keywords, excluded_companies,
                   show_company_name, public_publishing, updated_at`,
        [
          value.role_tracks, value.countries, JSON.stringify(value.remote_eligibility),
          value.score_threshold, value.max_packets_per_day, value.max_sends_per_day,
          value.timezone, value.show_company_name, value.public_publishing,
          value.excluded_keywords ?? null, value.excluded_companies ?? null,
        ],
      );
      if (!rows[0]) return sendMissingTables(res, ["jr_settings (seed row id=1)"]);
      res.json(serializeSettings(rows[0]));
    } catch (error) {
      next(error);
    }
  });

  admin.get("/resume-profiles", async (_req, res, next) => {
    try {
      const missing = await findMissingTables(db);
      if (missing.length) return sendMissingTables(res, missing);
      const { rows } = await db.query(
        `SELECT id, name, track, original_text, verified_facts, created_at, updated_at, archived_at
         FROM public.jr_resume_profiles ORDER BY created_at DESC`,
      );
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  admin.post("/resume-profiles", createRateLimiter(30, "Too many resume profile changes."), requireSameOrigin, requireCsrfToken, async (req, res, next) => {
    const parsed = parseCareerInput(resumeProfileCreateSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: "Please check the resume profile.", details: parsed.error });
    try {
      const missing = await findMissingTables(db);
      if (missing.length) return sendMissingTables(res, missing);
      const value = parsed.data;
      const { rows } = await db.query(
        `INSERT INTO public.jr_resume_profiles (name, track, original_text, verified_facts)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id, name, track, original_text, verified_facts, created_at, updated_at, archived_at`,
        [value.name, value.track, value.original_text, JSON.stringify(value.verified_facts)],
      );
      scheduleAssessmentRerun();
      res.status(201).json(rows[0]);
    } catch (error) {
      next(error);
    }
  });

  admin.patch("/resume-profiles/:id", createRateLimiter(30, "Too many resume profile changes."), requireSameOrigin, requireCsrfToken, async (req, res, next) => {
    const parsedId = parseCareerInput(uuidSchema, req.params.id);
    const parsed = parseCareerInput(resumeProfilePatchSchema, req.body);
    if (parsedId.error || parsed.error) {
      return res.status(400).json({ error: "Please check the resume profile fields.", details: parsed.error ?? parsedId.error });
    }
    try {
      const missing = await findMissingTables(db);
      if (missing.length) return sendMissingTables(res, missing);
      const value = parsed.data;
      const { rows } = await db.query(
        `UPDATE public.jr_resume_profiles
         SET name = COALESCE($1, name), track = COALESCE($2, track),
             verified_facts = COALESCE($3::jsonb, verified_facts), updated_at = now()
         WHERE id = $4 AND archived_at IS NULL
         RETURNING id, name, track, original_text, verified_facts, created_at, updated_at, archived_at`,
        [
          value.name ?? null, value.track ?? null,
          value.verified_facts === undefined ? null : JSON.stringify(value.verified_facts),
          parsedId.data,
        ],
      );
      if (!rows[0]) return res.status(404).json({ error: "Active resume profile was not found." });
      scheduleAssessmentRerun();
      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  });

  admin.post("/resume-profiles/:id/archive", createRateLimiter(30, "Too many resume profile changes."), requireSameOrigin, requireCsrfToken, async (req, res, next) => {
    const parsedId = parseCareerInput(uuidSchema, req.params.id);
    if (parsedId.error) return res.status(400).json({ error: "Resume profile ID is invalid." });
    try {
      const missing = await findMissingTables(db);
      if (missing.length) return sendMissingTables(res, missing);
      const { rows } = await db.query(
        `UPDATE public.jr_resume_profiles SET archived_at = COALESCE(archived_at, now()), updated_at = now()
         WHERE id = $1 AND archived_at IS NULL
         RETURNING id, name, track, created_at, updated_at, archived_at`,
        [parsedId.data],
      );
      if (!rows[0]) return res.status(404).json({ error: "Active resume profile was not found." });
      scheduleAssessmentRerun();
      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  });

  admin.get("/sources", async (_req, res, next) => {
    try {
      const missing = await findMissingTables(db);
      if (missing.length) return sendMissingTables(res, missing);
      const { rows } = await db.query(
        `SELECT s.key, s.name, s.terms_url, s.docs_url, s.last_reviewed_at, s.auth_type,
                s.min_interval_seconds, s.max_requests_per_day, s.attribution_text,
                s.private_use_allowed, s.public_redisplay_allowed, s.enabled, s.notes,
                st.last_attempt_at, st.last_success_at, st.last_status,
                st.consecutive_failures, st.requests_today, st.window_date, st.next_allowed_at
         FROM public.jr_sources AS s
         LEFT JOIN public.jr_source_state AS st ON st.source_key = s.key
         ORDER BY s.name`,
      );
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  admin.patch("/sources/:key", createRateLimiter(30, "Too many source settings updates."), requireSameOrigin, requireCsrfToken, async (req, res, next) => {
    const key = /^[a-z0-9_]{1,60}$/.test(req.params.key) ? req.params.key : null;
    const parsed = parseCareerInput(sourcePatchSchema, req.body);
    if (!key || parsed.error) {
      return res.status(400).json({ error: "Please check the source key and permitted fields.", details: parsed.error });
    }
    try {
      const missing = await findMissingTables(db);
      if (missing.length) return sendMissingTables(res, missing);
      const existing = await db.query(
        "SELECT private_use_allowed FROM public.jr_sources WHERE key = $1",
        [key],
      );
      if (!existing.rows[0]) return res.status(404).json({ error: "Source was not found." });
      if (parsed.data.enabled === true && !existing.rows[0].private_use_allowed) {
        return res.status(409).json({ error: "This source cannot be enabled until private-use permission is verified." });
      }
      const { rows } = await db.query(
        `UPDATE public.jr_sources
         SET enabled = COALESCE($1, enabled),
             notes = CASE WHEN $3::boolean THEN $2::text ELSE notes END
         WHERE key = $4
         RETURNING key, name, terms_url, docs_url, last_reviewed_at, auth_type,
                   min_interval_seconds, max_requests_per_day, attribution_text,
                   private_use_allowed, public_redisplay_allowed, enabled, notes`,
        [
          parsed.data.enabled ?? null, parsed.data.notes ?? null,
          Object.hasOwn(parsed.data, "notes"), key,
        ],
      );
      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  });

  admin.get("/runs", async (_req, res, next) => {
    try {
      const missing = await findMissingTables(db);
      if (missing.length) return sendMissingTables(res, missing);
      const { rows } = await db.query(
        `SELECT id, trigger, status, started_at, finished_at, summary
         FROM public.jr_runs ORDER BY started_at DESC LIMIT 100`,
      );
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  admin.get("/overview", async (_req, res, next) => {
    try {
      const missing = await findMissingCareerTables(db);
      if (missing.length) return sendMissingIntakeTables(res, missing);
      const missingAssessments = await findMissingAssessmentTable(db);
      if (missingAssessments.length) return sendMissingAssessmentTable(res);
      const missingApplications = await findMissingApplicationTables(db);
      if (missingApplications.length) return sendMissingApplicationTables(res, missingApplications);
      const today = nairobiDate();
      const missingPreparation = await findMissingPreparationTables(db);
      const [{ rows: settingsRows }, { rows: jobCounts }, { rows: applicationCounts },
        { rows: scanRows }, { rows: sourceRows }, { rows: reviewRows }, { rows: newRows }, { rows: draftRows }] = await Promise.all([
        db.query("SELECT score_threshold, max_packets_per_day FROM public.jr_settings WHERE id = 1"),
        db.query("SELECT status, count(*)::integer AS count FROM public.jr_jobs GROUP BY status"),
        db.query("SELECT state, count(*)::integer AS count FROM public.jr_applications GROUP BY state"),
        db.query("SELECT max(finished_at) AS last_success_at FROM public.jr_runs WHERE status = 'succeeded'"),
        db.query(
          `SELECT s.key, s.name, s.enabled, s.min_interval_seconds, s.max_requests_per_day,
                  s.attribution_text, st.last_attempt_at, st.last_success_at, st.last_status,
                  st.consecutive_failures, st.requests_today, st.window_date, st.next_allowed_at
           FROM public.jr_sources AS s
           LEFT JOIN public.jr_source_state AS st ON st.source_key = s.key
           ORDER BY s.name`,
        ),
        db.query(
          `SELECT count(*)::integer AS count FROM public.jr_jobs
           WHERE status IN ('screened', 'match_review', 'needs_manual_attention')`,
        ),
        db.query(
          `SELECT count(*)::integer AS count FROM public.jr_jobs
           WHERE first_seen_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Nairobi')
             AND first_seen_at < (($1::date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi')`,
          [today],
        ),
        missingPreparation.length
          ? Promise.resolve({ rows: [{ count: 0 }] })
          : db.query(
              `SELECT count(*)::integer AS count
               FROM public.jr_application_packets AS p
               WHERE p.status IN ('draft', 'ready_for_review')
                 AND p.version = (
                   SELECT max(p2.version) FROM public.jr_application_packets AS p2
                   WHERE p2.application_id = p.application_id
                 )`,
            ),
      ]);
      if (!settingsRows[0]) return sendMissingTables(res, ["jr_settings (seed row id=1)"]);
      const threshold = Number(settingsRows[0].score_threshold);
      const dailyCap = Number(settingsRows[0].max_packets_per_day);
      const { rows: qualifiedRows } = await db.query(
        `SELECT j.id, j.source_key, s.name AS source_name, s.attribution_text,
                j.source_job_id, j.url, j.title, j.company, j.location_text,
                j.remote_scope_text, j.description_text, j.tags, j.posted_at,
                j.first_seen_at, j.status, 'not yet assessed'::text AS risk_assessment,
                jsonb_build_object(
                  'eligibility', a.eligibility,
                  'eligibility_evidence', a.eligibility_evidence,
                  'fit_score', a.fit_score,
                  'fit_breakdown', a.fit_breakdown,
                  'matched', a.matched,
                  'missing', a.missing,
                  'reason_codes', a.reason_codes,
                  'uncertainty', a.uncertainty
                ) AS assessment,
                a.fit_score, a.eligibility
         FROM public.jr_jobs AS j
         JOIN public.jr_sources AS s ON s.key = j.source_key
         JOIN LATERAL (
           SELECT * FROM public.jr_assessments
           WHERE job_id = j.id
           ORDER BY assessed_at DESC LIMIT 1
         ) AS a ON true
         WHERE j.first_seen_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Nairobi')
           AND j.first_seen_at < (($1::date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi')
           AND a.fit_score >= $2
           AND a.eligibility IN ('eligible', 'unknown')
           AND j.status NOT IN ('duplicate', 'expired', 'not_a_fit', 'passed', 'closed')
         ORDER BY a.fit_score DESC, j.first_seen_at DESC, j.id
         LIMIT 5000`,
        [today, threshold],
      );
      const riskReviewedRows = qualifiedRows.map((row) => ({ ...row, risk_assessment: assessCareerRisk(row, { now }) }));
      const lowRiskRows = riskReviewedRows.filter((row) => row.risk_assessment.risk_level === "low");
      const shortlist = lowRiskRows.slice(0, dailyCap);
      const shortlistedIds = new Set(shortlist.map((row) => row.id));
      const remaining = riskReviewedRows.filter((row) => row.risk_assessment.risk_level !== "high" && !shortlistedIds.has(row.id));
      const byStatus = Object.fromEntries(jobCounts.map((row) => [row.status, Number(row.count)]));
      const applicationsByState = Object.fromEntries(
        applicationStates.map((state) => [state, 0]),
      );
      for (const row of applicationCounts) applicationsByState[row.state] = Number(row.count);
      const lastSuccess = scanRows[0]?.last_success_at ?? null;
      const stale = !lastSuccess || Date.now() - new Date(lastSuccess).getTime() >= 12 * 60 * 60 * 1000;
      res.json({
        last_success_at: lastSuccess,
        stale,
        new_jobs_count: Number(newRows[0]?.count ?? 0),
        shortlist_count: shortlist.length,
        drafts_waiting: Number(draftRows[0]?.count ?? 0),
        preparation_tables_configured: missingPreparation.length === 0,
        preparation_tables_missing: missingPreparation,
        review_count: Number(reviewRows[0]?.count ?? 0),
        job_counts: byStatus,
        applications_by_state: applicationsByState,
        sources: sourceRows,
        shortlist,
        qualified: remaining.filter((job) => job.eligibility === "eligible" && job.risk_assessment.risk_level === "low"),
        maybe: remaining.filter((job) => job.eligibility === "unknown" || job.risk_assessment.risk_level === "medium"),
      });
    } catch (error) {
      next(error);
    }
  });

  admin.post(
    "/scan-now",
    requireSameOrigin,
    requireCsrfToken,
    createRateLimiter(4, "The manual scan limit has been reached.", 24 * 60 * 60 * 1000),
    async (_req, res, next) => {
      try {
        const result = await runService.start("manual");
        if (result.error === "missing_tables") return sendMissingIntakeTables(res, result.missing);
        res.status(202).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  admin.get("/jobs", async (req, res, next) => {
    const parsed = parseCareerInput(careerJobsQuerySchema, req.query);
    if (parsed.error) return res.status(400).json({ error: "Please check the job filters.", details: parsed.error });
    try {
      const missing = await findMissingCareerTables(db);
      if (missing.length) return sendMissingIntakeTables(res, missing);
      const { source, status, q, limit, cursor } = parsed.data;
      const missingAssessments = await findMissingAssessmentTable(db);
      if (missingAssessments.length) return sendMissingAssessmentTable(res);
      const values = [];
      const predicates = [];
      if (source) {
        values.push(source);
        predicates.push(`j.source_key = $${values.length}`);
      }
      if (status) {
        values.push(status);
        predicates.push(`j.status = $${values.length}`);
      }
      if (q) {
        values.push(`%${q}%`);
        predicates.push(`(j.title ILIKE $${values.length} OR j.company ILIKE $${values.length} OR j.location_text ILIKE $${values.length})`);
      }
      if (parsed.data.min_score !== undefined) {
        values.push(parsed.data.min_score);
        predicates.push(`a.fit_score >= $${values.length}`);
      }
      if (parsed.data.eligibility) {
        values.push(parsed.data.eligibility);
        predicates.push(`a.eligibility = $${values.length}`);
      }
      const offset = Number(cursor ?? 0);
      values.push(limit + 1);
      const limitParameter = values.length;
      values.push(offset);
      const offsetParameter = values.length;
      const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
      const { rows } = await db.query(
        `SELECT j.id, j.source_key, s.name AS source_name, s.attribution_text,
                j.source_job_id, j.url, j.title, j.company, j.location_text,
                j.remote_scope_text, j.description_text, j.salary_text, j.tags,
                j.posted_at, j.first_seen_at, j.last_seen_at, j.status, j.also_listed_on,
                CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
                  'id', a.id, 'profile_id', a.profile_id, 'track', a.track,
                  'eligibility', a.eligibility, 'eligibility_evidence', a.eligibility_evidence,
                  'fit_score', a.fit_score, 'fit_breakdown', a.fit_breakdown,
                  'matched', a.matched, 'missing', a.missing, 'reason_codes', a.reason_codes,
                  'uncertainty', a.uncertainty, 'rules_version', a.rules_version,
                  'assessed_at', a.assessed_at
                ) END AS assessment
         FROM public.jr_jobs AS j
         JOIN public.jr_sources AS s ON s.key = j.source_key
         LEFT JOIN LATERAL (
           SELECT * FROM public.jr_assessments
           WHERE job_id = j.id
           ORDER BY assessed_at DESC LIMIT 1
         ) AS a ON true
         ${where}
         ORDER BY j.first_seen_at DESC, j.id
         LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
        values,
      );
      const hasMore = rows.length > limit;
      const jobs = (hasMore ? rows.slice(0, limit) : rows)
        .map((job) => ({ ...job, risk_assessment: assessCareerRisk(job, { now }) }));
      res.json({
        jobs,
        nextCursor: hasMore ? String(offset + limit) : null,
      });
    } catch (error) {
      next(error);
    }
  });

  admin.get("/jobs/:id", async (req, res, next) => {
    const parsedId = parseCareerInput(uuidSchema, req.params.id);
    if (parsedId.error) return res.status(400).json({ error: "Job ID is invalid." });
    try {
      const missing = await findMissingCareerTables(db);
      if (missing.length) return sendMissingIntakeTables(res, missing);
      const missingAssessments = await findMissingAssessmentTable(db);
      if (missingAssessments.length) return sendMissingAssessmentTable(res);
      const { rows } = await db.query(
        `SELECT j.id, j.source_key, s.name AS source_name, s.attribution_text,
                j.source_job_id, j.url, j.title, j.company, j.location_text,
                j.remote_scope_text, j.description_text, j.salary_text, j.tags,
                j.posted_at, j.first_seen_at, j.last_seen_at, j.content_hash,
                j.canonical_key, j.also_listed_on, j.status,
                CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
                  'id', a.id, 'profile_id', a.profile_id, 'track', a.track,
                  'eligibility', a.eligibility, 'eligibility_evidence', a.eligibility_evidence,
                  'fit_score', a.fit_score, 'fit_breakdown', a.fit_breakdown,
                  'matched', a.matched, 'missing', a.missing, 'reason_codes', a.reason_codes,
                  'uncertainty', a.uncertainty, 'rules_version', a.rules_version,
                  'assessed_at', a.assessed_at
                ) END AS assessment
         FROM public.jr_jobs AS j
         JOIN public.jr_sources AS s ON s.key = j.source_key
         LEFT JOIN LATERAL (
           SELECT * FROM public.jr_assessments
           WHERE job_id = j.id
           ORDER BY assessed_at DESC LIMIT 1
         ) AS a ON true
         WHERE j.id = $1`,
        [parsedId.data],
      );
      if (!rows[0]) return res.status(404).json({ error: "Job was not found." });
      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  });

  admin.patch(
    "/jobs/:id/status",
    createRateLimiter(60, "Too many job review changes."),
    requireSameOrigin,
    requireCsrfToken,
    async (req, res, next) => {
      const parsedId = parseCareerInput(uuidSchema, req.params.id);
      const parsed = parseCareerInput(jobReviewStatusSchema, req.body);
      if (parsedId.error || parsed.error) {
        return res.status(400).json({ error: "Please check the job review status.", details: parsed.error ?? parsedId.error });
      }
      try {
        const missing = await findMissingJobTables(db);
        if (missing.length) return sendMissingIntakeTables(res, missing);
        const { rows } = await db.query(
          `UPDATE public.jr_jobs SET status = $1
           WHERE id = $2 AND status NOT IN ('duplicate', 'expired', 'closed')
           RETURNING id, status`,
          [parsed.data.status, parsedId.data],
        );
        if (!rows[0]) return res.status(404).json({ error: "Active job was not found." });
        await db.query(
          `INSERT INTO public.jr_audit_events (actor, action, detail)
           VALUES ('admin', 'job.status_changed', $1::jsonb)`,
          [JSON.stringify({ job_id: rows[0].id, status: rows[0].status })],
        );
        res.json(rows[0]);
      } catch (error) {
        next(error);
      }
    },
  );

  admin.post(
    "/jobs/:id/prepare",
    createRateLimiter(20, "Too many application packet requests."),
    requireSameOrigin,
    requireCsrfToken,
    async (req, res, next) => {
      const parsedId = parseCareerInput(uuidSchema, req.params.id);
      const parsed = parseCareerInput(applicationPrepareSchema, req.body);
      if (parsedId.error || parsed.error) {
        return res.status(400).json({ error: "Choose a valid job and master CV profile.", details: parsed.error ?? parsedId.error });
      }
      try {
        const missingJobs = await findMissingCareerTables(db);
        if (missingJobs.length) return sendMissingIntakeTables(res, missingJobs);
        const missingAssessments = await findMissingAssessmentTable(db);
        if (missingAssessments.length) return sendMissingAssessmentTable(res);
        const missingApplications = await findMissingApplicationTables(db);
        if (missingApplications.length) return sendMissingApplicationTables(res, missingApplications);
        const missingPreparation = await findMissingPreparationTables(db);
        if (missingPreparation.length) return sendMissingPreparationTables(res, missingPreparation);

        const [{ rows: jobRows }, { rows: profileRows }, { rows: settingsRows }] = await Promise.all([
          db.query(
            `SELECT j.id, j.source_key, s.name AS source_name, s.attribution_text,
                    j.url, j.title, j.company, j.location_text, j.remote_scope_text,
                    j.description_text, j.tags, j.posted_at, j.status
             FROM public.jr_jobs AS j
             JOIN public.jr_sources AS s ON s.key = j.source_key
             WHERE j.id = $1`,
            [parsedId.data],
          ),
          db.query(
            `SELECT id, name, track, original_text, verified_facts
             FROM public.jr_resume_profiles
             WHERE id = $1 AND archived_at IS NULL`,
            [parsed.data.profile_id],
          ),
          db.query(
            `SELECT role_tracks, score_threshold, excluded_keywords, excluded_companies
             FROM public.jr_settings WHERE id = 1`,
          ),
        ]);
        const job = jobRows[0];
        const profile = profileRows[0];
        const settings = settingsRows[0];
        if (!job) return res.status(404).json({ error: "This advert is no longer available in Job Radar." });
        if (["duplicate", "expired", "closed"].includes(job.status)) {
          return res.status(409).json({ error: "This advert is marked as duplicate, expired, or closed. Review its status before preparing an application." });
        }
        if (!profile) return res.status(404).json({ error: "The selected master CV profile is missing or archived." });
        if (!settings) return sendMissingTables(res, ["jr_settings (seed row id=1)"]);

        const assessment = calculateCareerJobAssessment(job, profile, settings, { now: now() });
        const riskAssessment = assessCareerRisk(job, { now });
        if (riskAssessment.risk_level === "high") {
          return res.status(409).json({
            error: "This advert has high-risk indicators. Job Radar will not prepare an application packet for it.",
            risk_assessment: riskAssessment,
          });
        }
        if (!profileMatchesCareerTrack(assessment.track, profile.track)) {
          return res.status(409).json({
            error: "The selected master CV does not match this advert's assessed role track. Choose the correct CV profile or update Search Preferences before preparing the packet.",
            assessedTrack: assessment.track,
            selectedProfileTrack: profile.track,
          });
        }

        await db.query(
          `INSERT INTO public.jr_assessments (
             job_id, profile_id, track, eligibility, eligibility_evidence, fit_score,
             fit_breakdown, matched, missing, reason_codes, uncertainty, rules_version
           ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11::jsonb, 1)
           ON CONFLICT (job_id, profile_id) DO UPDATE SET
             track = EXCLUDED.track, eligibility = EXCLUDED.eligibility,
             eligibility_evidence = EXCLUDED.eligibility_evidence, fit_score = EXCLUDED.fit_score,
             fit_breakdown = EXCLUDED.fit_breakdown, matched = EXCLUDED.matched,
             missing = EXCLUDED.missing, reason_codes = EXCLUDED.reason_codes,
             uncertainty = EXCLUDED.uncertainty, rules_version = EXCLUDED.rules_version,
             assessed_at = now()`,
          [
            job.id, profile.id, assessment.track, assessment.eligibility,
            JSON.stringify(assessment.eligibility_evidence), assessment.fit_score,
            JSON.stringify(assessment.fit_breakdown), JSON.stringify(assessment.matched),
            JSON.stringify(assessment.missing), assessment.reason_codes,
            JSON.stringify(assessment.uncertainty),
          ],
        );

        const created = await applicationService.create(job.id);
        const applicationId = created.application?.id ?? created.id;
        if (created.notFound || !applicationId) return res.status(404).json({ error: "The application tracker could not find this job." });
        const existingApplication = created.application ?? await applicationService.get(applicationId);
        if (!existingApplication) return res.status(404).json({ error: "The application tracker record could not be loaded." });
        if (["sent", "approved_to_send", "needs_manual_attention"].includes(existingApplication.state)) {
          return res.status(409).json({ error: "This job already has a send or uncertain-send state. Check the existing packet and Gmail Sent before taking any further action." });
        }

        const draft = buildApplicationDraft({ job, profile, assessment, now: now() });
        const packetWarnings = [
          ...draft.warnings,
          ...(riskAssessment.risk_level === "medium"
            ? [`Risk review required: ${riskAssessment.risk_findings.map((item) => item.evidence).filter(Boolean).join("; ") || riskAssessment.label}`]
            : []),
        ];
        const masterResumeSha = createHash("sha256").update(profile.original_text, "utf8").digest("hex");
        const sourceSnapshot = {
          jobId: job.id,
          applicationUrl: draft.source.applicationUrl,
          sourceName: draft.source.sourceName,
          sourceAttribution: draft.source.sourceAttribution,
          assessmentScore: draft.source.assessmentScore,
          eligibility: draft.source.eligibility,
          riskLevel: riskAssessment.risk_level,
          riskAssessment,
          matched: assessment.matched,
          missing: assessment.missing,
          reasonCodes: assessment.reason_codes,
          generatedAt: draft.source.generatedAt,
          sourceProfileId: profile.id,
          sourceProfileName: profile.name,
          sourceProfileTrack: profile.track,
        };
        const client = await db.connect();
        let packetId;
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`jr-application-packet:${applicationId}`]);
          const { rows: latestRows } = await client.query(
            "SELECT id, version, status FROM public.jr_application_packets WHERE application_id = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE",
            [applicationId],
          );
          const latest = latestRows[0];
          if (latest && ["sent", "sending", "approved_to_send", "needs_manual_attention"].includes(latest.status)) {
            await client.query("ROLLBACK");
            return res.status(409).json({
              error: "A previous packet has already been sent or has an uncertain send outcome. Check Gmail Sent and the application timeline before preparing another version.",
            });
          }
          const version = Number(latest?.version ?? 0) + 1;
          const { rows: inserted } = await client.query(
            `INSERT INTO public.jr_application_packets (
               application_id, job_id, source_profile_id, version, status,
               resume_text, cover_letter_text, recipient_email, highlights,
               missing_requirements, warnings, source_snapshot, master_resume_sha256
             ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, NULL, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11)
             RETURNING id`,
            [
              applicationId, job.id, profile.id, version, draft.resumeText, draft.coverLetterText,
              JSON.stringify(draft.highlights), JSON.stringify(draft.missingRequirements),
              JSON.stringify(packetWarnings), JSON.stringify(sourceSnapshot), masterResumeSha,
            ],
          );
          packetId = inserted[0]?.id;
          await client.query(
            `UPDATE public.jr_applications
             SET state = 'preparation_in_progress', updated_at = $2
             WHERE id = $1 AND state NOT IN ('sent', 'approved_to_send', 'needs_manual_attention')`,
            [applicationId, now()],
          );
          await client.query(
            `INSERT INTO public.jr_application_events (application_id, event, detail)
             VALUES ($1, 'application.packet_generated', $2::jsonb)`,
            [applicationId, JSON.stringify({ packet_id: packetId, version, profile_id: profile.id, master_resume_sha256: masterResumeSha })],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        const packet = await findApplicationPacket(db, packetId);
        if (!packet) return res.status(500).json({ error: "The packet was generated but could not be reloaded. Refresh the Application drafts tab." });
        res.status(201).json(applicationPacketResponse(packet));
      } catch (error) {
        next(error);
      }
    },
  );

  admin.get("/application-packets", async (_req, res, next) => {
    try {
      const missing = await findMissingPreparationTables(db);
      if (missing.length) return sendMissingPreparationTables(res, missing);
      const { rows } = await db.query(
        `SELECT p.id, p.application_id, p.job_id, p.source_profile_id, p.version, p.status,
                p.recipient_email, p.highlights, p.missing_requirements, p.warnings,
                p.source_snapshot, p.master_resume_sha256, p.gmail_message_id, p.sent_at,
                p.created_at, p.updated_at, a.state AS application_state,
                j.title, j.company, j.location_text, j.url AS application_url,
                s.name AS source_name, rp.name AS profile_name, rp.track AS profile_track
         FROM public.jr_application_packets AS p
         JOIN public.jr_applications AS a ON a.id = p.application_id
         JOIN public.jr_jobs AS j ON j.id = p.job_id
         LEFT JOIN public.jr_sources AS s ON s.key = j.source_key
         JOIN public.jr_resume_profiles AS rp ON rp.id = p.source_profile_id
         WHERE p.version = (
           SELECT max(p2.version) FROM public.jr_application_packets AS p2
           WHERE p2.application_id = p.application_id
         )
         ORDER BY p.updated_at DESC LIMIT 100`,
      );
      res.json(rows.map((row) => ({
        ...applicationPacketResponse(row),
        has_resume: true,
        has_cover_letter: true,
      })));
    } catch (error) {
      next(error);
    }
  });

  admin.get("/application-packets/:id/resume.pdf", async (req, res, next) => {
    const parsedId = parseCareerInput(uuidSchema, req.params.id);
    if (parsedId.error) return res.status(400).json({ error: "Application packet ID is invalid." });
    try {
      const missing = await findMissingPreparationTables(db);
      if (missing.length) return sendMissingPreparationTables(res, missing);
      const packet = await findApplicationPacket(db, parsedId.data);
      if (!packet) return res.status(404).json({ error: "Application packet was not found." });
      const latest = await findLatestApplicationPacket(db, packet.application_id);
      if (latest?.id !== packet.id) return res.status(409).json({ error: "This is an older packet version. Open the latest version before downloading." });
      const pdf = createTextPdf({ title: `${packet.title} — CV draft`, text: packet.resume_text, generatedAt: new Date(packet.updated_at) });
      const filename = `Morgan-West-Oketch-CV-${String(packet.title).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "application"}.pdf`;
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
      });
      return res.send(pdf);
    } catch (error) {
      next(error);
    }
  });

  admin.get("/application-packets/:id/cover-letter.pdf", async (req, res, next) => {
    const parsedId = parseCareerInput(uuidSchema, req.params.id);
    if (parsedId.error) return res.status(400).json({ error: "Application packet ID is invalid." });
    try {
      const missing = await findMissingPreparationTables(db);
      if (missing.length) return sendMissingPreparationTables(res, missing);
      const packet = await findApplicationPacket(db, parsedId.data);
      if (!packet) return res.status(404).json({ error: "Application packet was not found." });
      const latest = await findLatestApplicationPacket(db, packet.application_id);
      if (latest?.id !== packet.id) return res.status(409).json({ error: "This is an older packet version. Open the latest version before downloading." });
      const pdf = createTextPdf({ title: `${packet.title} — cover letter`, text: packet.cover_letter_text, generatedAt: new Date(packet.updated_at) });
      const filename = `Morgan-West-Oketch-Cover-Letter-${String(packet.title).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "application"}.pdf`;
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
      });
      return res.send(pdf);
    } catch (error) {
      next(error);
    }
  });

  admin.get("/application-packets/:id", async (req, res, next) => {
    const parsedId = parseCareerInput(uuidSchema, req.params.id);
    if (parsedId.error) return res.status(400).json({ error: "Application packet ID is invalid." });
    try {
      const missing = await findMissingPreparationTables(db);
      if (missing.length) return sendMissingPreparationTables(res, missing);
      const packet = await findApplicationPacket(db, parsedId.data);
      if (!packet) return res.status(404).json({ error: "Application packet was not found." });
      const latest = await findLatestApplicationPacket(db, packet.application_id);
      if (latest?.id !== packet.id) {
        return res.status(409).json({ error: "This packet has an older version. Refresh the Application drafts list to open the current version." });
      }
      return res.json(applicationPacketResponse(packet));
    } catch (error) {
      next(error);
    }
  });

  admin.patch(
    "/application-packets/:id",
    createRateLimiter(60, "Too many application draft edits."),
    requireSameOrigin,
    requireCsrfToken,
    async (req, res, next) => {
      const parsedId = parseCareerInput(uuidSchema, req.params.id);
      const parsed = parseCareerInput(applicationPacketPatchSchema, req.body);
      if (parsedId.error || parsed.error) {
        return res.status(400).json({ error: "Check the application draft fields.", details: parsed.error ?? parsedId.error });
      }
      try {
        const missing = await findMissingPreparationTables(db);
        if (missing.length) return sendMissingPreparationTables(res, missing);
        const packet = await findApplicationPacket(db, parsedId.data);
        if (!packet) return res.status(404).json({ error: "Application packet was not found." });
        const latest = await findLatestApplicationPacket(db, packet.application_id);
        if (latest?.id !== packet.id) return res.status(409).json({ error: "This is an older packet version. Open the latest version before editing." });
        if (!["draft", "ready_for_review"].includes(packet.status)) {
          return res.status(409).json({ error: "This packet can no longer be edited because it is sending, sent, or needs manual review." });
        }
        const { rows: profiles } = await db.query(
          "SELECT original_text FROM public.jr_resume_profiles WHERE id = $1 AND archived_at IS NULL",
          [packet.source_profile_id],
        );
        const originalResume = profiles[0]?.original_text;
        if (typeof originalResume !== "string"
          || createHash("sha256").update(originalResume, "utf8").digest("hex") !== packet.master_resume_sha256) {
          return res.status(409).json({ error: "The master CV source could not be verified. Do not send this packet; review the profile first." });
        }
        const nextResume = parsed.data.resume_text ?? packet.resume_text;
        if (!nextResume.endsWith(originalResume)) {
          return res.status(422).json({
            error: "Keep the complete master CV text unchanged at the end of the tailored CV draft. You may edit the role-aligned highlights above it, but must not alter or remove the original CV section.",
          });
        }
        const nextCoverLetter = parsed.data.cover_letter_text ?? packet.cover_letter_text;
        const recipient = parsed.data.recipient_email === undefined
          ? packet.recipient_email
          : parsed.data.recipient_email || null;
        const client = await db.connect();
        let nextId;
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`jr-application-packet:${packet.application_id}`]);
          const { rows: latestRows } = await client.query(
            "SELECT id, version, status FROM public.jr_application_packets WHERE application_id = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE",
            [packet.application_id],
          );
          if (latestRows[0]?.id !== packet.id || !["draft", "ready_for_review"].includes(latestRows[0]?.status)) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "This packet changed while you were editing it. Refresh and review the latest version." });
          }
          const { rows: inserted } = await client.query(
            `INSERT INTO public.jr_application_packets (
               application_id, job_id, source_profile_id, version, status,
               resume_text, cover_letter_text, recipient_email, highlights,
               missing_requirements, warnings, source_snapshot, master_resume_sha256
             ) VALUES ($1, $2, $3, $4, 'ready_for_review', $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12)
             RETURNING id`,
            [
              packet.application_id, packet.job_id, packet.source_profile_id, Number(packet.version) + 1,
              nextResume, nextCoverLetter, recipient, JSON.stringify(packet.highlights),
              JSON.stringify(packet.missing_requirements), JSON.stringify(packet.warnings),
              JSON.stringify(packet.source_snapshot), packet.master_resume_sha256,
            ],
          );
          nextId = inserted[0]?.id;
          await client.query(
            `INSERT INTO public.jr_application_events (application_id, event, detail)
             VALUES ($1, 'application.packet_edited', $2::jsonb)`,
            [packet.application_id, JSON.stringify({ packet_id: nextId, version: Number(packet.version) + 1 })],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        const updated = await findApplicationPacket(db, nextId);
        return res.status(201).json(applicationPacketResponse(updated));
      } catch (error) {
        next(error);
      }
    },
  );

  admin.post(
    "/application-packets/:id/send",
    createRateLimiter(5, "Too many send attempts. Review the latest packet and Gmail Sent before trying again.", 24 * 60 * 60 * 1000),
    requireSameOrigin,
    requireCsrfToken,
    async (req, res, next) => {
      const parsedId = parseCareerInput(uuidSchema, req.params.id);
      const parsed = parseCareerInput(applicationPacketSendSchema, req.body);
      if (parsedId.error || parsed.error) {
        return res.status(400).json({ error: "Review the exact packet version and confirm the send details.", details: parsed.error ?? parsedId.error });
      }
      try {
        const missing = await findMissingPreparationTables(db);
        if (missing.length) return sendMissingPreparationTables(res, missing);
        const packet = await findApplicationPacket(db, parsedId.data);
        if (!packet) return res.status(404).json({ error: "Application packet was not found." });
        const latest = await findLatestApplicationPacket(db, packet.application_id);
        if (latest?.id !== packet.id || Number(packet.version) !== parsed.data.reviewed_version) {
          return res.status(409).json({ error: "The packet changed after you reviewed it. Refresh the packet and review the new version before sending." });
        }
        if (!["draft", "ready_for_review"].includes(packet.status)) {
          return res.status(409).json({ error: "This packet has already been sent, is already sending, or requires manual review. Do not resend automatically." });
        }
        const snapshot = packet.source_snapshot && typeof packet.source_snapshot === "object" ? packet.source_snapshot : {};
        const eligibility = snapshot.eligibility ?? "unknown";
        if (eligibility === "ineligible") {
          return res.status(409).json({ error: "This advert failed the location/work-authorization rules. The platform will not send it automatically." });
        }
        if (eligibility === "unknown" && !parsed.data.confirm_eligibility) {
          return res.status(409).json({ error: "Confirm that you manually checked location and work-authorization eligibility before sending." });
        }
        const { rows: riskJobRows } = await db.query(
          `SELECT title, company, location_text, remote_scope_text, description_text, salary_text, tags, url
           FROM public.jr_jobs WHERE id = $1`,
          [packet.job_id],
        );
        if (!riskJobRows[0]) return res.status(404).json({ error: "The source advert could not be reloaded for the final safety check." });
        const currentRisk = assessCareerRisk(riskJobRows[0], { now });
        if (currentRisk.risk_level === "high") {
          return res.status(409).json({
            error: "The current advert has high-risk indicators. Sending is blocked even if an older packet was approved.",
            risk_assessment: currentRisk,
          });
        }
        const warnings = Array.isArray(packet.warnings) ? packet.warnings : [];
        const missingRequirements = Array.isArray(packet.missing_requirements) ? packet.missing_requirements : [];
        if ((warnings.length || missingRequirements.length || currentRisk.risk_level === "medium") && !parsed.data.confirm_warnings) {
          return res.status(409).json({ error: "Review packet warnings, missing requirements, and advert-risk indicators; explicitly confirm you understand them." });
        }
        if (!parsed.data.recipient_email || !packet.resume_text.trim() || !packet.cover_letter_text.trim()) {
          return res.status(422).json({ error: "A recruiter email, tailored CV draft, and cover letter are required." });
        }

        let gmailAccess;
        try {
          gmailAccess = await getGmailSendAccessToken({ db, env: process.env, fetchImpl });
        } catch (error) {
          return res.status(409).json({ error: String(error?.message ?? "Gmail is not ready to send.") });
        }

        const { rows: settingsRows } = await db.query(
          "SELECT max_sends_per_day FROM public.jr_settings WHERE id = 1",
        );
        if (!settingsRows[0]) return sendMissingTables(res, ["jr_settings (seed row id=1)"]);
        const today = nairobiDate(now());
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`jr-application-send:${today}`]);
          const { rows: latestRows } = await client.query(
            `SELECT id, application_id, version, status
             FROM public.jr_application_packets
             WHERE id = $1
             FOR UPDATE`,
            [packet.id],
          );
          if (!latestRows[0] || latestRows[0].application_id !== packet.application_id
            || Number(latestRows[0].version) !== parsed.data.reviewed_version
            || !["draft", "ready_for_review"].includes(latestRows[0].status)) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "The packet status changed. Reload and review it before another send attempt." });
          }
          const { rows: sentCountRows } = await client.query(
            `SELECT count(*)::integer AS count FROM public.jr_application_packets
             WHERE send_attempted_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Nairobi')
               AND send_attempted_at < (($1::date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi')
               AND status IN ('sending', 'sent', 'needs_manual_attention')`,
            [today],
          );
          const sendsToday = Number(sentCountRows[0]?.count ?? 0);
          if (sendsToday >= Number(settingsRows[0].max_sends_per_day)) {
            await client.query("ROLLBACK");
            return res.status(429).json({ error: "The daily send cap has been reached. Review and send another day." });
          }
          const { rows: lastSentRows } = await client.query(
            "SELECT send_attempted_at FROM public.jr_application_packets WHERE send_attempted_at IS NOT NULL ORDER BY send_attempted_at DESC LIMIT 1",
          );
          if (lastSentRows[0]?.send_attempted_at && now().getTime() - new Date(lastSentRows[0].send_attempted_at).getTime() < 60_000) {
            await client.query("ROLLBACK");
            return res.status(429).json({ error: "Wait at least 60 seconds between application emails." });
          }
          await client.query(
            `UPDATE public.jr_application_packets
             SET status = 'sending', recipient_email = $2, send_attempted_at = $3, updated_at = $3
             WHERE id = $1`,
            [packet.id, parsed.data.recipient_email, now()],
          );
          await client.query(
            "UPDATE public.jr_applications SET state = 'approved_to_send', updated_at = $2 WHERE id = $1",
            [packet.application_id, now()],
          );
          await client.query(
            `INSERT INTO public.jr_application_events (application_id, event, detail)
             VALUES ($1, 'application.email_send_started', $2::jsonb)`,
            [packet.application_id, JSON.stringify({ packet_id: packet.id, version: packet.version })],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }

        try {
          const resumePdf = createTextPdf({ title: `${packet.title} — CV`, text: packet.resume_text, generatedAt: new Date(packet.updated_at) });
          const coverLetterPdf = createTextPdf({ title: `${packet.title} — cover letter`, text: packet.cover_letter_text, generatedAt: new Date(packet.updated_at) });
          const subject = `Application — ${String(packet.title).replace(/[\r\n]/g, " ").slice(0, 150)} — Morgan West Oketch`;
          const result = await sendGmailMessage({
            db,
            to: parsed.data.recipient_email,
            subject,
            body: packet.cover_letter_text,
            attachments: [
              { filename: "Morgan-West-Oketch-CV.pdf", contentType: "application/pdf", content: resumePdf },
              { filename: "Morgan-West-Oketch-Cover-Letter.pdf", contentType: "application/pdf", content: coverLetterPdf },
            ],
            messageId: packet.id,
            accessToken: gmailAccess.accessToken,
            senderEmail: gmailAccess.senderEmail,
            env: process.env,
            fetchImpl,
          });
          const sentAt = now();
          const client = await db.connect();
          try {
            await client.query("BEGIN");
            await client.query(
              `UPDATE public.jr_application_packets
               SET status = 'sent', gmail_message_id = $2, sent_at = $3, updated_at = $3
               WHERE id = $1 AND status = 'sending'`,
              [packet.id, result.id, sentAt],
            );
            await client.query(
              "UPDATE public.jr_applications SET state = 'sent', updated_at = $2 WHERE id = $1",
              [packet.application_id, sentAt],
            );
            await client.query(
              `INSERT INTO public.jr_application_events (application_id, event, detail)
               VALUES ($1, 'application.email_sent', $2::jsonb)`,
              [packet.application_id, JSON.stringify({ packet_id: packet.id, version: packet.version, gmail_message_id: result.id, sent_at: sentAt.toISOString() })],
            );
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
          const finalPacket = await findApplicationPacket(db, packet.id);
          return res.json(applicationPacketResponse(finalPacket));
        } catch (error) {
          const failedAt = now();
          const client = await db.connect();
          try {
            await client.query("BEGIN");
            await client.query(
              `UPDATE public.jr_application_packets
               SET status = 'needs_manual_attention', updated_at = $2
               WHERE id = $1 AND status = 'sending'`,
              [packet.id, failedAt],
            );
            await client.query(
              "UPDATE public.jr_applications SET state = 'needs_manual_attention', updated_at = $2 WHERE id = $1",
              [packet.application_id, failedAt],
            );
            await client.query(
              `INSERT INTO public.jr_application_events (application_id, event, detail)
               VALUES ($1, 'application.email_send_needs_manual_review', $2::jsonb)`,
              [packet.application_id, JSON.stringify({ packet_id: packet.id, version: packet.version, outcome: "unknown", message: "Check Gmail Sent before any retry." })],
            );
            await client.query("COMMIT");
          } catch (recordError) {
            await client.query("ROLLBACK");
            console.error(`Career email failure state could not be recorded: ${String(recordError?.message ?? "database error").slice(0, 200)}`);
          } finally {
            client.release();
          }
          return res.status(502).json({
            error: "Gmail did not provide a confirmed send result. The packet is blocked to prevent duplicate email. Check Gmail Sent before deciding the next action.",
          });
        }
      } catch (error) {
        next(error);
      }
    },
  );

  admin.get("/applications", async (req, res, next) => {
    const parsed = parseCareerInput(applicationsQuerySchema, req.query);
    if (parsed.error) return res.status(400).json({ error: "Please check the application filters.", details: parsed.error });
    try {
      const missing = await findMissingApplicationTables(db);
      if (missing.length) return sendMissingApplicationTables(res, missing);
      res.json(await applicationService.list(parsed.data.state));
    } catch (error) {
      next(error);
    }
  });

  admin.post(
    "/applications",
    createRateLimiter(30, "Too many application tracker changes."),
    requireSameOrigin,
    requireCsrfToken,
    async (req, res, next) => {
      const parsed = parseCareerInput(applicationCreateSchema, req.body);
      if (parsed.error) return res.status(400).json({ error: "Please provide a valid job ID.", details: parsed.error });
      try {
        const missing = await findMissingApplicationTables(db);
        if (missing.length) return sendMissingApplicationTables(res, missing);
        const result = await applicationService.create(parsed.data.job_id);
        if (result.notFound) return res.status(404).json({ error: "Job was not found." });
        if (result.conflict) return res.status(409).json({ error: "This job is already in the application tracker." });
        res.status(201).json(result.application);
      } catch (error) {
        if (error?.code === "23505") return res.status(409).json({ error: "This job is already in the application tracker." });
        next(error);
      }
    },
  );

  admin.get("/applications/:id/events", async (req, res, next) => {
    const parsedId = parseCareerInput(uuidSchema, req.params.id);
    if (parsedId.error) return res.status(400).json({ error: "Application ID is invalid." });
    try {
      const missing = await findMissingApplicationTables(db);
      if (missing.length) return sendMissingApplicationTables(res, missing);
      const application = await applicationService.get(parsedId.data);
      if (!application) return res.status(404).json({ error: "Application was not found." });
      res.json(await applicationService.events(parsedId.data));
    } catch (error) {
      next(error);
    }
  });

  admin.get("/applications/:id", async (req, res, next) => {
    const parsedId = parseCareerInput(uuidSchema, req.params.id);
    if (parsedId.error) return res.status(400).json({ error: "Application ID is invalid." });
    try {
      const missing = await findMissingApplicationTables(db);
      if (missing.length) return sendMissingApplicationTables(res, missing);
      const application = await applicationService.get(parsedId.data);
      if (!application) return res.status(404).json({ error: "Application was not found." });
      res.json({ application, events: await applicationService.events(parsedId.data) });
    } catch (error) {
      next(error);
    }
  });

  admin.patch(
    "/applications/:id/state",
    createRateLimiter(60, "Too many application tracker changes."),
    requireSameOrigin,
    requireCsrfToken,
    async (req, res, next) => {
      const parsedId = parseCareerInput(uuidSchema, req.params.id);
      const parsed = parseCareerInput(applicationStateSchema, req.body);
      if (parsedId.error || parsed.error) {
        return res.status(400).json({ error: "Please check the application state.", details: parsed.error ?? parsedId.error });
      }
      if (["approved_to_send", "sent"].includes(parsed.data.state)) {
        return res.status(409).json({ error: "This state is reserved for the explicitly authorized Phase 6 send workflow." });
      }
      try {
        const missing = await findMissingApplicationTables(db);
        if (missing.length) return sendMissingApplicationTables(res, missing);
        const result = await applicationService.changeState(parsedId.data, parsed.data.state, parsed.data.detail);
        if (result.notFound) return res.status(404).json({ error: "Application was not found." });
        if (result.invalidTransition) {
          return res.status(409).json({
            error: `The application cannot move from ${result.previousState} to ${parsed.data.state}.`,
          });
        }
        res.json(result.application);
      } catch (error) {
        next(error);
      }
    },
  );

  admin.patch(
    "/applications/:id",
    createRateLimiter(60, "Too many application tracker changes."),
    requireSameOrigin,
    requireCsrfToken,
    async (req, res, next) => {
      const parsedId = parseCareerInput(uuidSchema, req.params.id);
      const parsed = parseCareerInput(applicationPatchSchema, req.body);
      if (parsedId.error || parsed.error) {
        return res.status(400).json({ error: "Please check the application details.", details: parsed.error ?? parsedId.error });
      }
      try {
        const missing = await findMissingApplicationTables(db);
        if (missing.length) return sendMissingApplicationTables(res, missing);
        const application = await applicationService.updateDetails(parsedId.data, parsed.data);
        if (!application) return res.status(404).json({ error: "Application was not found." });
        res.json(application);
      } catch (error) {
        next(error);
      }
    },
  );

  admin.post(
    "/import",
    createRateLimiter(30, "Too many manual job imports."),
    requireSameOrigin,
    requireCsrfToken,
    async (req, res, next) => {
      const parsed = parseCareerInput(careerImportSchema, req.body);
      if (parsed.error) return res.status(400).json({ error: "Please check the imported advert.", details: parsed.error });
      const { rows: settingsRows } = await db.query(
        "SELECT role_tracks FROM public.jr_settings WHERE id = 1",
      );
      const roleTracks = settingsRows[0]?.role_tracks ?? [];
      if (!matchesRoleTitle(parsed.data.title, [], roleTracks)) {
        return res.status(422).json({
          error: "The advert title does not match your saved job titles. You can update Search preferences or keep the advert for manual review.",
        });
      }
      if (parsed.data.url && !normalizeHttpUrl(parsed.data.url)) {
        return res.status(400).json({ error: "URL must use HTTP or HTTPS and must not include credentials." });
      }
      try {
        const missing = await findMissingCareerTables(db);
        if (missing.length) return sendMissingIntakeTables(res, missing);
        const job = normalizeImportedJob(parsed.data);
        const saved = await saveCareerJob(db, job);
        if (saved.result === "new" || saved.result === "updated") {
          try {
            await assessmentService.assessJob(saved.id);
          } catch (error) {
            console.warn(`Career assessment for imported job ${saved.id} failed: ${String(error?.message ?? "Assessment failed.").slice(0, 300)}`);
          }
        }
        res.status(saved.result === "new" ? 201 : 200).json({ id: saved.id, status: saved.result });
      } catch (error) {
        next(error);
      }
    },
  );

  admin.post(
    "/assessments/rerun",
    createRateLimiter(4, "The assessment rerun limit has been reached.", 60 * 60 * 1000),
    requireSameOrigin,
    requireCsrfToken,
    async (_req, res, next) => {
      try {
        const missing = await findMissingCareerTables(db);
        if (missing.length) return sendMissingIntakeTables(res, missing);
        const missingAssessments = await findMissingAssessmentTable(db);
        if (missingAssessments.length) return sendMissingAssessmentTable(res);
        res.json(await assessmentService.reassessAll());
      } catch (error) {
        next(error);
      }
    },
  );

  admin.get("/watchlist", async (_req, res, next) => {
    try {
      const missing = await findMissingCareerTables(db);
      if (missing.length) return sendMissingIntakeTables(res, missing);
      const { rows } = await db.query(
        `SELECT id, provider, token, label, enabled, created_at
         FROM public.jr_ats_watchlist ORDER BY created_at, id`,
      );
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  admin.post(
    "/watchlist",
    createRateLimiter(30, "Too many ATS watchlist changes."),
    requireSameOrigin,
    requireCsrfToken,
    async (req, res, next) => {
      const parsed = parseCareerInput(atsWatchlistCreateSchema, req.body);
      if (parsed.error) return res.status(400).json({ error: "Please check the ATS watchlist entry.", details: parsed.error });
      try {
        const missing = await findMissingCareerTables(db);
        if (missing.length) return sendMissingIntakeTables(res, missing);
        const { rows } = await db.query(
          `INSERT INTO public.jr_ats_watchlist (provider, token, label)
           VALUES ($1, $2, $3)
           ON CONFLICT (provider, token) DO NOTHING
           RETURNING id, provider, token, label, enabled, created_at`,
          [parsed.data.provider, parsed.data.token, parsed.data.label],
        );
        if (!rows[0]) return res.status(409).json({ error: "This ATS board is already on the watchlist." });
        res.status(201).json(rows[0]);
      } catch (error) {
        next(error);
      }
    },
  );

  admin.delete(
    "/watchlist/:id",
    createRateLimiter(30, "Too many ATS watchlist changes."),
    requireSameOrigin,
    requireCsrfToken,
    async (req, res, next) => {
      const parsedId = parseCareerInput(uuidSchema, req.params.id);
      if (parsedId.error) return res.status(400).json({ error: "Watchlist ID is invalid." });
      try {
        const missing = await findMissingCareerTables(db);
        if (missing.length) return sendMissingIntakeTables(res, missing);
        const result = await db.query("DELETE FROM public.jr_ats_watchlist WHERE id = $1", [parsedId.data]);
        if (!result.rowCount) return res.status(404).json({ error: "ATS board was not found." });
        res.sendStatus(204);
      } catch (error) {
        next(error);
      }
    },
  );

  admin.get("/search-links", async (_req, res, next) => {
    try {
      const missing = await findMissingTables(db);
      if (missing.length) return sendMissingTables(res, missing);
      const { rows } = await db.query(
        "SELECT role_tracks, countries FROM public.jr_settings WHERE id = 1",
      );
      if (!rows[0]) return sendMissingTables(res, ["jr_settings (seed row id=1)"]);
      const keywords = rows[0].role_tracks.join(" OR ");
      const location = rows[0].countries.join(", ");
      const linkedIn = new URL("https://www.linkedin.com/jobs/search/");
      linkedIn.searchParams.set("keywords", keywords);
      linkedIn.searchParams.set("location", location);
      const google = new URL("https://www.google.com/search");
      google.searchParams.set("q", `${keywords} jobs careers ${location} employer official`);
      res.json([
        { name: "BrighterMonday Kenya", url: "https://www.brightermonday.co.ke/jobs" },
        { name: "MyJobMag Kenya", url: "https://www.myjobmag.co.ke/" },
        { name: "Fuzu", url: "https://www.fuzu.com/jobs" },
        { name: "LinkedIn Jobs", url: linkedIn.toString() },
        { name: "Kenya Public Service Commission", url: "https://www.publicservice.go.ke/" },
        { name: "Official employer career pages", url: google.toString() },
      ]);
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/admin/career", admin);

  const internal = express.Router();
  internal.post(
    "/run",
    (req, res, next) => {
      res.set("Cache-Control", "no-store");
      const configuredSecret = process.env.JOB_CRON_SECRET;
      if (!configuredSecret) return res.sendStatus(404);
      if (!hasExpectedCronSecret(req, configuredSecret)) {
        return res.status(401).json({ error: "Worker authentication failed." });
      }
      next();
    },
    createRateLimiter(4, "The worker run limit has been reached.", 24 * 60 * 60 * 1000),
    async (req, res, next) => {
      if (!requestBodyIsSmall(req)) return res.status(413).json({ error: "Worker request body is too large." });
      try {
        const result = await runService.start("cron");
        if (result.error === "missing_tables") return sendMissingIntakeTables(res, result.missing);
        res.status(202).json(result);
      } catch (error) {
        next(error);
      }
    },
  );
  app.use("/api/internal/jobs", internal);
}

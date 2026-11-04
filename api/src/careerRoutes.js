import { timingSafeEqual } from "node:crypto";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { createCareerRunService, findMissingCareerTables, findMissingJobTables } from "./careerRun.js";
import { createCareerAssessmentService } from "./careerAssessment.js";
import { createCareerApplicationService, applicationStates } from "./careerApplications.js";
import { normalizeImportedJob, saveCareerJob } from "./careerImport.js";
import { matchesRoleTitle, normalizeHttpUrl } from "./careerSources.js";
import {
  atsWatchlistCreateSchema,
  applicationCreateSchema,
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
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",
  "GEMINI_API_KEY",
  "JOOBLE_API_KEY",
  "CAREERJET_API_KEY",
  "RELIEFWEB_APPNAME",
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
      const configuration = Object.fromEntries(setupSecretNames.map((name) => [
        name,
        { configured: typeof process.env[name] === "string" && process.env[name].length > 0 },
      ]));
      const sendMode = process.env.JR_SEND_MODE === "live" ? "live" : "draft";
      res.json({
        configuration,
        JR_SEND_MODE: sendMode,
        tables: { configured: missing.length === 0, missing },
        intakeTables: { configured: missingIntake.length === 0, missing: missingIntake },
        assessmentTables: { configured: missingAssessments.length === 0, missing: missingAssessments },
      });
    } catch (error) {
      next(error);
    }
  });

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
      const [{ rows: settingsRows }, { rows: jobCounts }, { rows: applicationCounts },
        { rows: scanRows }, { rows: sourceRows }, { rows: reviewRows }, { rows: newRows }] = await Promise.all([
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
      const shortlist = qualifiedRows.slice(0, dailyCap);
      const remaining = qualifiedRows.slice(dailyCap);
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
        drafts_waiting: 0,
        review_count: Number(reviewRows[0]?.count ?? 0),
        job_counts: byStatus,
        applications_by_state: applicationsByState,
        sources: sourceRows,
        shortlist,
        qualified: remaining.filter((job) => job.eligibility === "eligible"),
        maybe: remaining.filter((job) => job.eligibility === "unknown"),
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
      const jobs = hasMore ? rows.slice(0, limit) : rows;
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

import { timingSafeEqual } from "node:crypto";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { createCareerRunService, findMissingCareerTables, findMissingJobTables } from "./careerRun.js";
import { normalizeImportedJob, saveCareerJob } from "./careerImport.js";
import { matchesRoleTitle, normalizeHttpUrl } from "./careerSources.js";
import {
  atsWatchlistCreateSchema,
  careerImportSchema,
  careerJobsQuerySchema,
  careerSettingsSchema,
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

export function registerCareerRoutes(app, db, { requireAdmin, requireSameOrigin, requireCsrfToken }, { runService = createCareerRunService({ db }) } = {}) {
  const admin = express.Router();
  admin.use(noStore, requireAdmin);

  admin.get("/setup", async (_req, res, next) => {
    try {
      const missing = await findMissingTables(db);
      const missingIntake = await findMissingJobTables(db);
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
      });
    } catch (error) {
      next(error);
    }
  });

  admin.get("/settings", async (_req, res, next) => {
    try {
      const missing = await findMissingTables(db);
      if (missing.length) return sendMissingTables(res, missing);
      const { rows } = await db.query(
        `SELECT role_tracks, countries, remote_eligibility, score_threshold,
                max_packets_per_day, max_sends_per_day, timezone,
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
      const value = parsed.data;
      const { rows } = await db.query(
        `UPDATE public.jr_settings
         SET role_tracks = $1, countries = $2, remote_eligibility = $3::jsonb,
             score_threshold = $4, max_packets_per_day = $5, max_sends_per_day = $6,
             timezone = $7, show_company_name = $8, public_publishing = $9, updated_at = now()
         WHERE id = 1
         RETURNING role_tracks, countries, remote_eligibility, score_threshold,
                   max_packets_per_day, max_sends_per_day, timezone,
                   show_company_name, public_publishing, updated_at`,
        [
          value.role_tracks, value.countries, JSON.stringify(value.remote_eligibility),
          value.score_threshold, value.max_packets_per_day, value.max_sends_per_day,
          value.timezone, value.show_company_name, value.public_publishing,
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
                j.posted_at, j.first_seen_at, j.last_seen_at, j.status, j.also_listed_on
         FROM public.jr_jobs AS j
         JOIN public.jr_sources AS s ON s.key = j.source_key
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
      const { rows } = await db.query(
        `SELECT j.id, j.source_key, s.name AS source_name, s.attribution_text,
                j.source_job_id, j.url, j.title, j.company, j.location_text,
                j.remote_scope_text, j.description_text, j.salary_text, j.tags,
                j.posted_at, j.first_seen_at, j.last_seen_at, j.content_hash,
                j.canonical_key, j.also_listed_on, j.status
         FROM public.jr_jobs AS j
         JOIN public.jr_sources AS s ON s.key = j.source_key
         WHERE j.id = $1`,
        [parsedId.data],
      );
      if (!rows[0]) return res.status(404).json({ error: "Job was not found." });
      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  });

  admin.post(
    "/import",
    createRateLimiter(30, "Too many manual job imports."),
    requireSameOrigin,
    requireCsrfToken,
    async (req, res, next) => {
      const parsed = parseCareerInput(careerImportSchema, req.body);
      if (parsed.error) return res.status(400).json({ error: "Please check the imported advert.", details: parsed.error });
      if (!matchesRoleTitle(parsed.data.title)) {
        return res.status(422).json({ error: "The advert title does not match the enabled role tracks." });
      }
      if (parsed.data.url && !normalizeHttpUrl(parsed.data.url)) {
        return res.status(400).json({ error: "URL must use HTTP or HTTPS and must not include credentials." });
      }
      try {
        const missing = await findMissingCareerTables(db);
        if (missing.length) return sendMissingIntakeTables(res, missing);
        const job = normalizeImportedJob(parsed.data);
        const saved = await saveCareerJob(db, job);
        res.status(saved.result === "new" ? 201 : 200).json({ id: saved.id, status: saved.result });
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

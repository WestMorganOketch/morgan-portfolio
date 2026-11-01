import { timingSafeEqual } from "node:crypto";
import express from "express";
import { rateLimit } from "express-rate-limit";
import {
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

function createRateLimiter(limit, message) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
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

function isRunConflict(error) {
  return error?.code === "23505" || error?.constraint === "jr_runs_single_running_idx";
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

async function completeNoAdapterRun(db, runId) {
  try {
    await db.query(
      `UPDATE public.jr_runs
       SET status = 'succeeded', finished_at = now(), summary = $2::jsonb
       WHERE id = $1 AND status = 'running'`,
      [runId, JSON.stringify({ message: "no adapters yet" })],
    );
    await db.query(
      `INSERT INTO public.jr_audit_events (actor, action, detail)
       VALUES ($1, 'run.succeeded', $2::jsonb)`,
      ["worker", JSON.stringify({ run_id: runId, message: "no adapters yet" })],
    );
  } catch (error) {
    console.error("Career run completion failed.", error?.code ?? "database error");
    try {
      await db.query(
        `UPDATE public.jr_runs
         SET status = 'failed', finished_at = now(), summary = $2::jsonb
         WHERE id = $1 AND status = 'running'`,
        [runId, JSON.stringify({ message: "run completion failed" })],
      );
    } catch (failureError) {
      console.error("Career run failure could not be recorded.", failureError?.code ?? "database error");
    }
  }
}

export function registerCareerRoutes(app, db, { requireAdmin, requireSameOrigin, requireCsrfToken }) {
  const admin = express.Router();
  admin.use(noStore, requireAdmin);

  admin.get("/setup", async (_req, res, next) => {
    try {
      const missing = await findMissingTables(db);
      const configuration = Object.fromEntries(setupSecretNames.map((name) => [
        name,
        { configured: typeof process.env[name] === "string" && process.env[name].length > 0 },
      ]));
      const sendMode = process.env.JR_SEND_MODE === "live" ? "live" : "draft";
      res.json({
        configuration,
        JR_SEND_MODE: sendMode,
        tables: { configured: missing.length === 0, missing },
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
        `SELECT key, name, terms_url, docs_url, last_reviewed_at, auth_type,
                min_interval_seconds, max_requests_per_day, attribution_text,
                private_use_allowed, public_redisplay_allowed, enabled, notes
         FROM public.jr_sources ORDER BY name`,
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

  app.use("/api/admin/career", admin);

  const internal = express.Router();
  internal.post("/run", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const configuredSecret = process.env.JOB_CRON_SECRET;
    if (!configuredSecret) return res.sendStatus(404);
    if (!hasExpectedCronSecret(req, configuredSecret)) {
      return res.status(401).json({ error: "Worker authentication failed." });
    }
    if (!requestBodyIsSmall(req)) {
      return res.status(413).json({ error: "Worker request body is too large." });
    }
    try {
      const missing = await findMissingTables(db);
      if (missing.length) return sendMissingTables(res, missing);
      let runId;
      if (typeof db.connect === "function") {
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `UPDATE public.jr_runs
             SET status = 'interrupted', finished_at = now(),
                 summary = '{"message":"stale run interrupted"}'::jsonb
             WHERE status = 'running' AND started_at < now() - interval '15 minutes'`,
          );
          const created = await client.query(
            `INSERT INTO public.jr_runs (trigger, status, summary)
             VALUES ('cron', 'running', '{"message":"no adapters yet"}'::jsonb)
             RETURNING id`,
          );
          runId = created.rows[0].id;
          await client.query(
            `INSERT INTO public.jr_audit_events (actor, action, detail)
             VALUES ('worker', 'run.started', $1::jsonb)`,
            [JSON.stringify({ run_id: runId })],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          if (isRunConflict(error)) return res.status(202).json({ status: "already_running" });
          throw error;
        } finally {
          client.release();
        }
      } else {
        await db.query(
          `UPDATE public.jr_runs
           SET status = 'interrupted', finished_at = now(),
               summary = '{"message":"stale run interrupted"}'::jsonb
           WHERE status = 'running' AND started_at < now() - interval '15 minutes'`,
        );
        const created = await db.query(
          `INSERT INTO public.jr_runs (trigger, status, summary)
           VALUES ('cron', 'running', '{"message":"no adapters yet"}'::jsonb)
           RETURNING id`,
        );
        runId = created.rows[0].id;
        await db.query(
          `INSERT INTO public.jr_audit_events (actor, action, detail)
           VALUES ('worker', 'run.started', $1::jsonb)`,
          [JSON.stringify({ run_id: runId })],
        );
      }
      res.status(202).json({ id: runId, status: "running" });
      setTimeout(() => { void completeNoAdapterRun(db, runId); }, 50);
    } catch (error) {
      if (isRunConflict(error)) return res.status(202).json({ status: "already_running" });
      next(error);
    }
  });
  app.use("/api/internal/jobs", internal);
}

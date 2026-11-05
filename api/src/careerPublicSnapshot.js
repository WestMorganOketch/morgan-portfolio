import { createHash, timingSafeEqual } from "node:crypto";
import { assessCareerRisk } from "./careerRisk.js";
import { normalizeHttpUrl, stripHtml } from "./careerSources.js";

const snapshotTable = "jr_public_snapshots";
const verificationNotice = "Listings are third-party vacancy summaries, not endorsements. Job Radar has not independently verified the employer or vacancy. Confirm every opportunity on the employer's official careers page before sharing personal information or applying.";

function text(value, limit = 300) {
  return stripHtml(String(value ?? ""), limit).replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeHttpsUrl(value) {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeDigestEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string"
      || !/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function hashContent(jobs, showCompanyName) {
  return createHash("sha256").update(JSON.stringify({
    schema_version: 1,
    show_company_name: showCompanyName === true,
    jobs,
  })).digest("hex");
}

function publicJob(row, showCompanyName, now) {
  const url = safeHttpsUrl(row.url);
  if (!url || row.public_redisplay_allowed !== true) return null;
  const risk = assessCareerRisk(row, { now });
  if (risk.risk_level !== "low") return null;
  const title = text(row.title, 200);
  const sourceName = text(row.source_name, 100);
  const attribution = text(row.attribution_text, 150);
  if (!title || !sourceName || !attribution) return null;
  const job = {
    title,
    location: text(row.location_text || row.remote_scope_text, 160) || "Location not specified",
    remote_scope: text(row.remote_scope_text, 120),
    source: sourceName,
    attribution,
    url,
    posted_at: row.posted_at ? new Date(row.posted_at).toISOString() : null,
    first_seen_at: row.first_seen_at ? new Date(row.first_seen_at).toISOString() : null,
  };
  if (showCompanyName === true && row.company) job.company = text(row.company, 160);
  return job;
}

export async function buildPublicCareerSnapshot(db, { now = () => new Date() } = {}) {
  const { rows: settingsRows } = await db.query(
    "SELECT public_publishing, show_company_name FROM public.jr_settings WHERE id = 1",
  );
  const settings = settingsRows[0];
  if (!settings) throw new Error("Career Radar preferences are not installed.");
  if (settings.public_publishing !== true) {
    throw new Error("Public snapshot publishing is disabled. Enable it in Job Radar preferences only when you are ready to publish the previewed information.");
  }

  const { rows } = await db.query(
    \`SELECT j.id, j.title, j.company, j.location_text, j.remote_scope_text,
            j.description_text, j.salary_text, j.tags, j.url, j.posted_at,
            j.first_seen_at, j.status, s.key AS source_key, s.name AS source_name,
            s.attribution_text, s.public_redisplay_allowed
     FROM public.jr_jobs AS j
     JOIN public.jr_sources AS s ON s.key = j.source_key
     WHERE s.enabled = true
       AND s.public_redisplay_allowed = true
       AND j.url IS NOT NULL
       AND j.status NOT IN ('duplicate', 'expired', 'not_a_fit', 'passed', 'closed', 'blocked_risk')
     ORDER BY COALESCE(j.posted_at, j.first_seen_at) DESC, j.id
     LIMIT 500\`,
  );
  const publicJobs = [];
  const seen = new Set();
  for (const row of rows) {
    const job = publicJob(row, settings.show_company_name === true, now);
    if (!job) continue;
    const key = job.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    publicJobs.push(job);
    if (publicJobs.length >= 100) break;
  }
  const generatedAt = now().toISOString();
  const snapshot = {
    schema_version: 1,
    generated_at: generatedAt,
    verification_notice: verificationNotice,
    jobs: publicJobs,
  };
  return {
    snapshot,
    snapshot_sha256: hashContent(publicJobs, settings.show_company_name === true),
    job_count: publicJobs.length,
  };
}

export function sanitizePublishedCareerSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schema_version !== 1 || !Array.isArray(value.jobs)) {
    return { schema_version: 1, generated_at: null, verification_notice: verificationNotice, jobs: [] };
  }
  const jobs = [];
  for (const item of value.jobs) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const url = safeHttpsUrl(item.url);
    const title = text(item.title, 200);
    const source = text(item.source, 100);
    const attribution = text(item.attribution, 150);
    if (!url || !title || !source || !attribution) continue;
    const job = {
      title,
      location: text(item.location, 160) || "Location not specified",
      remote_scope: text(item.remote_scope, 120),
      source,
      attribution,
      url,
      posted_at: typeof item.posted_at === "string" ? item.posted_at : null,
      first_seen_at: typeof item.first_seen_at === "string" ? item.first_seen_at : null,
    };
    if (typeof item.company === "string" && item.company.trim()) job.company = text(item.company, 160);
    jobs.push(job);
    if (jobs.length >= 100) break;
  }
  return {
    schema_version: 1,
    generated_at: typeof value.generated_at === "string" ? value.generated_at : null,
    verification_notice: verificationNotice,
    jobs,
  };
}

async function snapshotTablesExist(db) {
  const { rows } = await db.query(
    \`SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])\`,
    [[snapshotTable]],
  );
  return rows.some((row) => row.table_name === snapshotTable);
}

function missingSnapshotResponse(res) {
  return res.status(409).json({
    error: "The public snapshot table is not installed. Back up the intended database and apply docs/career-automation/sql/phase-7.sql or run npm run db:migrate-career.",
    missingTables: [snapshotTable],
  });
}

function publicUnavailable(res) {
  res.set("Cache-Control", "public, max-age=60");
  return res.json({ published: false, updated_at: null, snapshot_sha256: null, schema_version: 1, verification_notice: verificationNotice, jobs: [] });
}

export function registerPublicCareerSnapshotRoutes(app, admin, db, { now = () => new Date() } = {}) {
  admin.get("/public-snapshot/latest", async (_req, res, next) => {
    try {
      if (!await snapshotTablesExist(db)) return missingSnapshotResponse(res);
      const { rows } = await db.query(
        \`SELECT id, snapshot_sha256, job_count, published_by, created_at
         FROM public.jr_public_snapshots
         ORDER BY created_at DESC, id DESC LIMIT 1\`,
      );
      res.json({
        public_publishing_enabled: (await db.query("SELECT public_publishing FROM public.jr_settings WHERE id = 1")).rows[0]?.public_publishing === true,
        latest: rows[0] ?? null,
      });
    } catch (error) {
      next(error);
    }
  });

  admin.post("/public-snapshot/preview", async (_req, res, next) => {
    try {
      if (!await snapshotTablesExist(db)) return missingSnapshotResponse(res);
      const preview = await buildPublicCareerSnapshot(db, { now });
      res.json(preview);
    } catch (error) {
      const message = String(error?.message ?? "");
      if (message.includes("publishing is disabled")) return res.status(409).json({ error: message });
      if (message.includes("preferences are not installed")) return res.status(409).json({ error: message });
      next(error);
    }
  });

  admin.post("/public-snapshot/publish", async (req, res, next) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)
        || body.confirmed !== true
        || typeof body.snapshot_sha256 !== "string"
        || !/^[a-f0-9]{64}$/.test(body.snapshot_sha256)) {
      return res.status(400).json({ error: "Explicit publication confirmation and the current preview fingerprint are required." });
    }
    try {
      if (!await snapshotTablesExist(db)) return missingSnapshotResponse(res);
      const current = await buildPublicCareerSnapshot(db, { now });
      if (!safeDigestEqual(current.snapshot_sha256, body.snapshot_sha256)) {
        return res.status(409).json({ error: "The preview changed or is stale. Generate a new preview and review it before publishing." });
      }
      if (current.job_count === 0) {
        return res.status(409).json({ error: "The current preview contains no eligible listings, so nothing was published." });
      }
      const actor = String(req.adminSession?.email ?? "admin").slice(0, 254);
      const client = await db.connect();
      let resultRow;
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          \`INSERT INTO public.jr_public_snapshots
            (snapshot_json, snapshot_sha256, job_count, published_by, created_at)
           VALUES ($1::jsonb, $2, $3, $4, $5)
           RETURNING id, snapshot_sha256, job_count, published_by, created_at\`,
          [JSON.stringify(current.snapshot), current.snapshot_sha256, current.job_count, actor, now()],
        );
        resultRow = rows[0];
        await client.query(
          \`INSERT INTO public.jr_audit_events (actor, action, detail)
           VALUES ($1, 'career.public_snapshot_published', $2::jsonb)\`,
          [actor, JSON.stringify({ snapshot_id: resultRow.id, snapshot_sha256: resultRow.snapshot_sha256, job_count: resultRow.job_count })],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      res.status(201).json({ published: true, latest: resultRow });
    } catch (error) {
      const message = String(error?.message ?? "");
      if (message.includes("publishing is disabled") || message.includes("preferences are not installed")) {
        return res.status(409).json({ error: message });
      }
      next(error);
    }
  });

  app.get("/api/public/radar", async (_req, res, next) => {
    try {
      if (!await snapshotTablesExist(db)) return publicUnavailable(res);
      const { rows } = await db.query(
        \`SELECT snapshot_json, snapshot_sha256, created_at
         FROM public.jr_public_snapshots
         ORDER BY created_at DESC, id DESC LIMIT 1\`,
      );
      if (!rows[0]) return publicUnavailable(res);
      const snapshot = sanitizePublishedCareerSnapshot(rows[0].snapshot_json);
      res.set("Cache-Control", "public, max-age=60");
      res.set("ETag", '"' + String(rows[0].snapshot_sha256).replace(/[^a-f0-9]/g, "") + '"');
      return res.json({
        published: true,
        updated_at: rows[0].created_at,
        snapshot_sha256: rows[0].snapshot_sha256,
        ...snapshot,
      });
    } catch (error) {
      if (error?.code === "42P01") return publicUnavailable(res);
      next(error);
    }
  });
}

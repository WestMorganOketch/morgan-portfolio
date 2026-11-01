import { buildJobIdentity, normalizeHttpUrl, stripHtml } from "./careerSources.js";

export function normalizeImportedJob(input) {
  const title = stripHtml(input.title, 300);
  const company = stripHtml(input.company ?? "", 200) || null;
  const description = stripHtml(input.text ?? "", 6000);
  const url = input.url === undefined || input.url === "" ? null : normalizeHttpUrl(input.url);
  const job = {
    source_key: "manual_import",
    source_job_id: url ?? `${title.toLowerCase()}|${company?.toLowerCase() ?? ""}|${description}`,
    url,
    title,
    company,
    location_text: "",
    remote_scope_text: "",
    description_text: description,
    salary_text: null,
    tags: [],
    posted_at: null,
  };
  return { ...job, ...buildJobIdentity(job) };
}

function addOtherSource(existingSources, sourceKey, primarySourceKey) {
  if (sourceKey === primarySourceKey) return existingSources ?? [];
  return [...new Set([...(existingSources ?? []), sourceKey])];
}

export async function saveCareerJob(db, job) {
  const identity = buildJobIdentity(job);
  const canonicalKey = job.canonical_key ?? identity.canonical_key;
  const contentHash = job.content_hash ?? identity.content_hash;
  const bySource = await db.query(
    `SELECT id, source_key, canonical_key FROM public.jr_jobs
     WHERE source_key = $1 AND source_job_id = $2`,
    [job.source_key, job.source_job_id],
  );
  if (bySource.rows[0]) {
    const sameCanonical = bySource.rows[0].canonical_key === canonicalKey;
    const duplicate = sameCanonical
      ? null
      : await db.query(
        "SELECT id, source_key, also_listed_on FROM public.jr_jobs WHERE canonical_key = $1",
        [canonicalKey],
      );
    if (duplicate?.rows[0] && duplicate.rows[0].id !== bySource.rows[0].id) {
      const sources = addOtherSource(duplicate.rows[0].also_listed_on, job.source_key, duplicate.rows[0].source_key);
      await db.query(
        `UPDATE public.jr_jobs
         SET last_seen_at = now(), also_listed_on = $2
         WHERE id = $1`,
        [duplicate.rows[0].id, sources],
      );
      return { result: "duplicate", id: duplicate.rows[0].id };
    }
    const { rows } = await db.query(
      `UPDATE public.jr_jobs
       SET url = $1, title = $2, company = $3, location_text = $4,
           remote_scope_text = $5, description_text = $6, salary_text = $7,
           tags = $8, posted_at = $9, last_seen_at = now(),
           content_hash = $10, canonical_key = $11
       WHERE id = $12
       RETURNING id`,
      [
        job.url, job.title, job.company, job.location_text, job.remote_scope_text,
        job.description_text, job.salary_text, job.tags, job.posted_at,
        contentHash, canonicalKey, bySource.rows[0].id,
      ],
    );
    return { result: "updated", id: rows[0].id };
  }

  const duplicate = await db.query(
    "SELECT id, source_key, also_listed_on FROM public.jr_jobs WHERE canonical_key = $1",
    [canonicalKey],
  );
  if (duplicate.rows[0]) {
    const sources = addOtherSource(duplicate.rows[0].also_listed_on, job.source_key, duplicate.rows[0].source_key);
    await db.query(
      `UPDATE public.jr_jobs
       SET last_seen_at = now(), also_listed_on = $2
       WHERE id = $1`,
      [duplicate.rows[0].id, sources],
    );
    return { result: "duplicate", id: duplicate.rows[0].id };
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO public.jr_jobs (
         source_key, source_job_id, url, title, company, location_text,
         remote_scope_text, description_text, salary_text, tags, posted_at,
         content_hash, canonical_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        job.source_key, job.source_job_id, job.url, job.title, job.company,
        job.location_text, job.remote_scope_text, job.description_text,
        job.salary_text, job.tags, job.posted_at, contentHash, canonicalKey,
      ],
    );
    return { result: "new", id: rows[0].id };
  } catch (error) {
    if (error?.code !== "23505") throw error;
    const { rows } = await db.query(
      "SELECT id, source_key, also_listed_on FROM public.jr_jobs WHERE canonical_key = $1 OR (source_key = $2 AND source_job_id = $3)",
      [canonicalKey, job.source_key, job.source_job_id],
    );
    if (!rows[0]) throw error;
    const sources = addOtherSource(rows[0].also_listed_on, job.source_key, rows[0].source_key);
    await db.query(
      `UPDATE public.jr_jobs SET last_seen_at = now(), also_listed_on = $2 WHERE id = $1`,
      [rows[0].id, sources],
    );
    return { result: rows[0].source_key === job.source_key ? "updated" : "duplicate", id: rows[0].id };
  }
}

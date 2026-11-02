export const applicationStates = [
  "discovered",
  "screened",
  "match_review",
  "shortlisted",
  "preparation_in_progress",
  "ready_for_review",
  "approved_to_send",
  "sent",
  "failed_send",
  "submitted",
  "expired",
  "duplicate",
  "blocked_risk",
  "not_a_fit",
  "withdrawn",
  "needs_manual_attention",
];

const protectedStates = new Set(["approved_to_send", "sent"]);
const applicationTransitions = new Map([
  ["discovered", new Set(["screened", "match_review", "shortlisted", "not_a_fit", "duplicate", "expired", "withdrawn", "needs_manual_attention"])],
  ["screened", new Set(["match_review", "shortlisted", "not_a_fit", "duplicate", "expired", "withdrawn", "needs_manual_attention"])],
  ["match_review", new Set(["screened", "shortlisted", "not_a_fit", "duplicate", "expired", "withdrawn", "needs_manual_attention"])],
  ["shortlisted", new Set(["match_review", "preparation_in_progress", "not_a_fit", "duplicate", "expired", "withdrawn", "needs_manual_attention"])],
  ["preparation_in_progress", new Set(["shortlisted", "ready_for_review", "not_a_fit", "expired", "withdrawn", "needs_manual_attention"])],
  ["ready_for_review", new Set(["shortlisted", "preparation_in_progress", "submitted", "not_a_fit", "expired", "withdrawn", "needs_manual_attention"])],
  ["failed_send", new Set(["preparation_in_progress", "ready_for_review", "withdrawn", "needs_manual_attention"])],
  ["submitted", new Set(["withdrawn", "needs_manual_attention", "expired"])],
  ["blocked_risk", new Set(["not_a_fit", "needs_manual_attention"])],
  ["not_a_fit", new Set(["match_review", "withdrawn"])],
  ["duplicate", new Set(["withdrawn"])],
  ["expired", new Set(["match_review", "withdrawn"])],
  ["withdrawn", new Set(["match_review"])],
  ["needs_manual_attention", new Set(["match_review", "shortlisted", "not_a_fit", "withdrawn"])],
]);

export function canTransitionApplication(from, to) {
  return applicationStates.includes(to)
    && !protectedStates.has(to)
    && Boolean(applicationTransitions.get(from)?.has(to));
}

export function createCareerApplicationService({ db } = {}) {
  if (!db) throw new TypeError("Career application service requires a database.");

  async function transaction(callback) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function list(state) {
    const values = state ? [state] : [];
    const filter = state ? "WHERE a.state = $1" : "";
    const { rows } = await db.query(
      `SELECT a.id, a.job_id, a.state, a.private_notes, a.followup_at,
              a.created_at, a.updated_at, j.title, j.company, j.location_text,
              j.url, j.source_key, s.name AS source_name
       FROM public.jr_applications AS a
       JOIN public.jr_jobs AS j ON j.id = a.job_id
       JOIN public.jr_sources AS s ON s.key = j.source_key
       ${filter}
       ORDER BY a.followup_at NULLS LAST, a.updated_at DESC
       LIMIT 200`,
      values,
    );
    return rows;
  }

  async function get(id) {
    const { rows } = await db.query(
      `SELECT a.id, a.job_id, a.state, a.private_notes, a.followup_at,
              a.created_at, a.updated_at, j.title, j.company, j.location_text,
              j.url, j.source_key, s.name AS source_name
       FROM public.jr_applications AS a
       JOIN public.jr_jobs AS j ON j.id = a.job_id
       JOIN public.jr_sources AS s ON s.key = j.source_key
       WHERE a.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async function events(id) {
    const { rows } = await db.query(
      `SELECT id, application_id, at, event, detail
       FROM public.jr_application_events
       WHERE application_id = $1
       ORDER BY at DESC, id DESC
       LIMIT 100`,
      [id],
    );
    return rows;
  }

  async function create(jobId) {
    return transaction(async (client) => {
      const existing = await client.query(
        "SELECT id FROM public.jr_applications WHERE job_id = $1",
        [jobId],
      );
      if (existing.rows[0]) return { conflict: true, id: existing.rows[0].id };
      const { rows: jobRows } = await client.query(
        "SELECT id FROM public.jr_jobs WHERE id = $1",
        [jobId],
      );
      if (!jobRows[0]) return { notFound: true };
      const { rows } = await client.query(
        `INSERT INTO public.jr_applications (job_id, state)
         VALUES ($1, 'discovered')
         RETURNING id, job_id, state, private_notes, followup_at, created_at, updated_at`,
        [jobId],
      );
      const application = rows[0];
      await client.query(
        `INSERT INTO public.jr_application_events (application_id, event, detail)
         VALUES ($1, 'application.created', $2::jsonb)`,
        [application.id, JSON.stringify({ state: application.state })],
      );
      return { application };
    });
  }

  async function changeState(id, state, detail = "") {
    return transaction(async (client) => {
      const { rows } = await client.query(
        "SELECT state FROM public.jr_applications WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!rows[0]) return { notFound: true };
      const previousState = rows[0].state;
      if (!canTransitionApplication(previousState, state)) return { invalidTransition: true, previousState };
      const updated = await client.query(
        `UPDATE public.jr_applications SET state = $1, updated_at = now()
         WHERE id = $2
         RETURNING id, job_id, state, private_notes, followup_at, created_at, updated_at`,
        [state, id],
      );
      await client.query(
        `INSERT INTO public.jr_application_events (application_id, event, detail)
         VALUES ($1, 'application.state_changed', $2::jsonb)`,
        [id, JSON.stringify({ from: previousState, to: state, ...(detail ? { note: detail } : {}) })],
      );
      return { application: updated.rows[0] };
    });
  }

  async function updateDetails(id, patch) {
    return transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE public.jr_applications
         SET private_notes = COALESCE($1, private_notes),
             followup_at = CASE WHEN $2::boolean THEN $3::timestamptz ELSE followup_at END,
             updated_at = now()
         WHERE id = $4
         RETURNING id, job_id, state, private_notes, followup_at, created_at, updated_at`,
        [
          Object.hasOwn(patch, "private_notes") ? patch.private_notes : null,
          Object.hasOwn(patch, "followup_at"),
          patch.followup_at ?? null,
          id,
        ],
      );
      if (!rows[0]) return null;
      if (Object.hasOwn(patch, "private_notes")) {
        await client.query(
          `INSERT INTO public.jr_application_events (application_id, event, detail)
           VALUES ($1, 'application.notes_updated', '{"updated":true}'::jsonb)`,
          [id],
        );
      }
      if (Object.hasOwn(patch, "followup_at")) {
        await client.query(
          `INSERT INTO public.jr_application_events (application_id, event, detail)
           VALUES ($1, 'application.followup_updated', $2::jsonb)`,
          [id, JSON.stringify({ followup_at: patch.followup_at ?? null })],
        );
      }
      return rows[0];
    });
  }

  return { list, get, events, create, changeState, updateDetails };
}

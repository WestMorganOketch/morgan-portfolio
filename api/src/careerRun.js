import { fetchCareerSource } from "./careerSources.js";
import { saveCareerJob } from "./careerImport.js";

const runBudgetMs = 4 * 60 * 1000;
export const careerFoundationTableNames = [
  "jr_settings",
  "jr_resume_profiles",
  "jr_sources",
  "jr_source_state",
  "jr_runs",
  "jr_audit_events",
];
export const careerIntakeTableNames = ["jr_jobs", "jr_ats_watchlist"];

function nairobiDate(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addMilliseconds(date, milliseconds) {
  return new Date(date.getTime() + milliseconds);
}

export function sourceSkipReason(source, state, now = new Date()) {
  if (!source.enabled) return "disabled";
  if (!source.private_use_allowed) return "private use permission not verified";
  if (source.key === "manual_import") return "manual import is not a fetch adapter";
  const today = nairobiDate(now);
  const requestsToday = state?.window_date === today ? Number(state.requests_today ?? 0) : 0;
  if (requestsToday >= source.max_requests_per_day) return "daily request cap reached";
  if (state?.next_allowed_at && new Date(state.next_allowed_at) > now) return "source cooldown";
  if (state?.last_attempt_at) {
    const earliest = addMilliseconds(new Date(state.last_attempt_at), source.min_interval_seconds * 1000);
    if (earliest > now) return "minimum polling interval";
  }
  return null;
}

function emptySummary() {
  return {
    fetched: 0,
    new: 0,
    updated: 0,
    duplicates: 0,
    discarded: 0,
    skipped_reason: null,
    error: null,
  };
}

function errorText(error) {
  return String(error?.message ?? "Source failed.").slice(0, 500);
}

function isRunLockConflict(error) {
  return error?.code === "23505" || error?.constraint === "jr_runs_single_running_idx";
}

export async function findMissingJobTables(db) {
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [careerIntakeTableNames],
  );
  const found = new Set(rows.map((row) => row.table_name));
  return careerIntakeTableNames.filter((name) => !found.has(name));
}

export async function findMissingCareerTables(db) {
  const required = [...careerFoundationTableNames, ...careerIntakeTableNames];
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [required],
  );
  const found = new Set(rows.map((row) => row.table_name));
  return required.filter((name) => !found.has(name));
}

export function createCareerRunService({
  db,
  fetchImpl = fetch,
  sleep,
  now = () => new Date(),
  budgetMs = runBudgetMs,
  adapter = fetchCareerSource,
  saveJob = saveCareerJob,
} = {}) {
  if (!db) throw new TypeError("Career run service requires a database.");

  async function createRun(trigger) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE public.jr_runs
         SET status = 'interrupted', finished_at = now(),
             summary = '{"message":"stale run interrupted"}'::jsonb
         WHERE status = 'running' AND started_at < now() - interval '15 minutes'`,
      );
      const { rows } = await client.query(
        `INSERT INTO public.jr_runs (trigger, status, summary)
         VALUES ($1, 'running', '{}'::jsonb)
         RETURNING id`,
        [trigger],
      );
      const runId = rows[0].id;
      await client.query(
        `INSERT INTO public.jr_audit_events (actor, action, detail)
         VALUES ($1, 'run.started', $2::jsonb)`,
        [trigger === "cron" ? "worker" : "admin", JSON.stringify({ run_id: runId })],
      );
      await client.query("COMMIT");
      return { id: runId, status: "running" };
    } catch (error) {
      await client.query("ROLLBACK");
      if (isRunLockConflict(error)) return { status: "already_running" };
      throw error;
    } finally {
      client.release();
    }
  }

  async function updateSourceState(source, status, error = null) {
    const backoffSeconds = Math.min(3600, 60 * (2 ** Math.min(Number(source.consecutive_failures ?? 0), 6)));
    await db.query(
      `INSERT INTO public.jr_source_state (
         source_key, last_attempt_at, last_success_at, last_status,
         consecutive_failures, requests_today, window_date, next_allowed_at
       ) VALUES (
         $1, now(), CASE WHEN $2 IN ('succeeded', 'partial') THEN now() ELSE NULL END,
         $2, CASE WHEN $2 IN ('succeeded', 'partial') THEN 0 ELSE 1 END,
         0, $3::date, now() + make_interval(secs => $4)
       )
       ON CONFLICT (source_key) DO UPDATE SET
         last_attempt_at = now(),
         last_success_at = CASE WHEN $2 IN ('succeeded', 'partial') THEN now() ELSE jr_source_state.last_success_at END,
         last_status = $2,
         consecutive_failures = CASE WHEN $2 IN ('succeeded', 'partial') THEN 0 ELSE jr_source_state.consecutive_failures + 1 END,
         requests_today = CASE WHEN jr_source_state.window_date = $3::date THEN jr_source_state.requests_today ELSE 0 END,
         window_date = $3::date,
         next_allowed_at = now() + make_interval(secs => $4)`,
      [
        source.key, status, nairobiDate(now()),
        status === "succeeded" || status === "partial"
          ? Math.max(source.min_interval_seconds, source.key === "remotive" ? 30 : 0)
          : Math.max(source.min_interval_seconds, backoffSeconds),
      ],
    );
    if (error) {
      console.warn(`Career source ${source.key} failed: ${errorText(error)}`);
    }
  }

  async function recordRequest(sourceKey, today, minimumDelaySeconds) {
    const { rows } = await db.query(
      `INSERT INTO public.jr_source_state (
         source_key, last_attempt_at, requests_today, window_date, next_allowed_at
       ) VALUES ($1, now(), 1, $2::date, now() + make_interval(secs => $3))
       ON CONFLICT (source_key) DO UPDATE SET
         last_attempt_at = now(),
         requests_today = CASE WHEN jr_source_state.window_date = $2::date THEN jr_source_state.requests_today + 1 ELSE 1 END,
         window_date = $2::date,
         next_allowed_at = now() + make_interval(secs => $3)
       RETURNING requests_today`,
      [sourceKey, today, minimumDelaySeconds],
    );
    return Number(rows[0]?.requests_today ?? 0);
  }

  async function runSources(signal) {
    const startedAt = now().getTime();
    const missing = await findMissingCareerTables(db);
    if (missing.length) {
      throw new Error(`Career intake tables are missing: ${missing.join(", ")}. Run docs/career-automation/sql/phase-2.sql.`);
    }
    const { rows: sources } = await db.query(
      `SELECT s.key, s.name, s.enabled, s.private_use_allowed, s.min_interval_seconds,
              s.max_requests_per_day, st.last_attempt_at, st.last_success_at,
              st.last_status, st.consecutive_failures, st.requests_today,
              st.window_date, st.next_allowed_at
       FROM public.jr_sources AS s
       LEFT JOIN public.jr_source_state AS st ON st.source_key = s.key
       WHERE s.enabled = true
       ORDER BY s.key`,
    );
    const summary = {};
    for (const source of sources) {
      const entry = emptySummary();
      summary[source.key] = entry;
      const skipReason = sourceSkipReason(source, source, now());
      if (skipReason) {
        entry.skipped_reason = skipReason;
        continue;
      }
      if (signal.aborted) {
        entry.skipped_reason = "run budget exceeded";
        break;
      }

      const today = nairobiDate(now());
      const used = source.window_date === today ? Number(source.requests_today ?? 0) : 0;
      let remainingRequests = Math.max(0, Number(source.max_requests_per_day) - used);
      if (remainingRequests === 0) {
        entry.skipped_reason = "daily request cap reached";
        continue;
      }
      let watchlist = [];
      if (source.key === "ats_watchlist") {
        const boards = await db.query(
          "SELECT provider, token, label FROM public.jr_ats_watchlist WHERE enabled = true ORDER BY created_at, id",
        );
        watchlist = boards.rows;
        if (watchlist.length === 0) {
          entry.skipped_reason = "no enabled ATS boards";
          continue;
        }
      }

      const minimumDelaySeconds = source.key === "remotive"
        ? Math.max(source.min_interval_seconds, 30)
        : source.min_interval_seconds;
      let requestLimitHit = false;
      const onRequest = async () => {
        if (remainingRequests <= 0) {
          requestLimitHit = true;
          throw new Error("daily request cap reached");
        }
        remainingRequests--;
        await recordRequest(source.key, today, minimumDelaySeconds);
      };

      try {
        const result = await adapter(source.key, {
          fetchImpl,
          ...(sleep ? { sleep } : {}),
          signal,
          onRequest,
          maxRequests: Math.min(3, source.max_requests_per_day - used),
          watchlist,
        });
        entry.fetched = Number(result.fetched ?? 0);
        entry.discarded = Number(result.discarded ?? 0) + Number(result.malformed ?? 0);
        for (const job of result.jobs) {
          if (signal.aborted) break;
          try {
            const saved = await saveJob(db, job);
            entry[saved.result === "new" ? "new" : saved.result === "updated" ? "updated" : "duplicates"]++;
          } catch (error) {
            entry.error = errorText(error);
          }
        }
        if (result.errors?.length) entry.error = result.errors.map((error) => String(error).slice(0, 200)).join("; ").slice(0, 500);
        const status = entry.error ? "partial" : "succeeded";
        await updateSourceState(source, status, entry.error ? new Error(entry.error) : null);
      } catch (error) {
        entry.error = requestLimitHit ? "daily request cap reached" : errorText(error);
        await updateSourceState(source, signal.aborted ? "interrupted" : "failed", error);
        if (signal.aborted) break;
      }
      if (now().getTime() - startedAt >= budgetMs) break;
    }
    return summary;
  }

  async function execute(runId) {
    const startedAt = now().getTime();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Four-minute run budget exceeded.")), budgetMs);
    let summary = {};
    let finalStatus = "succeeded";
    try {
      summary = await runSources(controller.signal);
      if (controller.signal.aborted || now().getTime() - startedAt >= budgetMs) finalStatus = "interrupted";
    } catch (error) {
      finalStatus = controller.signal.aborted ? "interrupted" : "failed";
      summary._run = { error: errorText(error) };
      console.error(`Career run ${runId} failed: ${errorText(error)}`);
    } finally {
      clearTimeout(timer);
    }
    try {
      await db.query(
        `UPDATE public.jr_runs
         SET status = $2, finished_at = now(), summary = $3::jsonb
         WHERE id = $1 AND status = 'running'`,
        [runId, finalStatus, JSON.stringify(summary)],
      );
      await db.query(
        `INSERT INTO public.jr_audit_events (actor, action, detail)
         VALUES ('system', $1, $2::jsonb)`,
        [`run.${finalStatus}`, JSON.stringify({ run_id: runId, summary })],
      );
    } catch (error) {
      console.error(`Career run ${runId} final state could not be recorded: ${errorText(error)}`);
    }
  }

  return {
    async start(trigger) {
      if (!["cron", "manual"].includes(trigger)) throw new TypeError("Invalid career run trigger.");
      const missing = await findMissingCareerTables(db);
      if (missing.length) return { error: "missing_tables", missing };
      const result = await createRun(trigger);
      if (result.status === "running") {
        setTimeout(() => { void execute(result.id); }, 0);
      }
      return result;
    },
  };
}

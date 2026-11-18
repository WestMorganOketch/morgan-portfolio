# n8n integration for Career Radar

This folder provides an importable n8n workflow that schedules the existing private Career Radar scan. It does **not** replace the API's source adapters, job normalization, deduplication, role-fit assessment, or advert-risk checks.

## Workflow behavior

- Runs at 00:15, 06:15, 12:15, and 18:15 in `Africa/Nairobi`.
- Also has a manual trigger for a controlled test.
- Waits for the API health endpoint to respond, with bounded retries for a sleeping API host.
- Sends an authenticated `POST /api/internal/jobs/run`.
- Validates the trigger response and records a useful execution result in n8n.
- Never sends an application email, uploads documents, submits applications, or publishes the public snapshot.

## Before importing

The workflow cannot go live until the existing Career Radar release prerequisites are satisfied:

1. Rotate/revoke the historical database credential documented in [the release checklist](../RELEASE_CHECKLIST.md), update the verified API environment, and confirm a usable backup.
2. Apply and verify migrations `004`–`010` against the confirmed production database in the documented dependency order.
3. Deploy the intended API code and confirm `GET /api/health` succeeds.
4. Set a strong random `JOB_CRON_SECRET` on the API host. Do not put it in this repository, a workflow export, a URL, or a query string.

## Import and configure

1. In n8n, import `career-radar-scheduled-scan.json`.
2. In **both** HTTP Request nodes, replace `https://REPLACE-WITH-YOUR-API-ORIGIN` with the actual deployed **API origin** (HTTPS origin only, no path or trailing slash). Do not assume the public Vercel frontend URL is also the API host.
3. Create a **Header Auth** credential. Set the header name to `X-Cron-Secret` and its value to the exact same secret configured as `JOB_CRON_SECRET` on the API host. Save it in n8n's credential store, then select it on **Trigger private Career Radar scan**. Do not hard-code the secret in a node expression.
4. Save the workflow and use **Manual test** first. The health request must return successfully; the scan request should return a response with a status and run ID, or `already_running`.
5. Check the private admin Career Radar run history and source status, rather than treating an accepted trigger as proof that every source finished successfully.
6. After a successful manual test, **publish/activate** the workflow so the schedule can run.

## Scheduler handover

Use one automatic scheduler at a time. The repository currently also contains `.github/workflows/career-radar-scheduled-scan.yml`. Once n8n is tested and activated, remove the GitHub Actions `schedule` trigger or disable that workflow to prevent duplicate scheduled attempts. Keep `workflow_dispatch` only if you want GitHub Actions as a manual fallback. The API has locking/idempotency safeguards, but two schedulers are unnecessary.

## Security and operation notes

- Keep the Header Auth credential private in n8n. Limit who can edit the workflow or view credentials/executions.
- The health check is unauthenticated; the actual scan trigger is protected by `X-Cron-Secret`.
- Failed health checks and unexpected API responses fail visibly in the n8n execution history. Add a failure notification only after choosing and configuring a notification channel.
- The scan endpoint only starts the existing private pipeline. Review jobs, application packets, and any public snapshot in the portfolio admin panel. Sending and publishing remain separate, owner-controlled actions.
- API logs and the private admin scan ledger are authoritative for final source-level outcomes.

See [the implementation plan](../IMPLEMENTATION_PLAN.md) and [release checklist](../RELEASE_CHECKLIST.md) for the existing API, data, privacy, and deployment gates.

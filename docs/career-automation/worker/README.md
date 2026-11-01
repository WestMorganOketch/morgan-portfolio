# Private career scan trigger

Copy `run-scan.yml` into `.github/workflows/` in a **private worker repository**, then set its only repository secrets:

- `API_BASE_URL` — the base URL of the career API, without a trailing slash.
- `JOB_CRON_SECRET` — the same server-side value configured in the API environment.

The workflow only wakes the API with `GET /api/health` and sends a small authenticated `POST /api/internal/jobs/run`. It does not retrieve jobs, send email, release documents, submit applications, or publish a public snapshot. GitHub scheduled runs are best-effort and can be delayed; check the API's recorded results rather than assuming a trigger succeeded.

## External scheduler alternative

If using a separate scheduler, configure a `GET {API_BASE_URL}/api/health` request and a second action **two minutes later** that sends `POST {API_BASE_URL}/api/internal/jobs/run` with `X-Cron-Secret` set from that scheduler's secret store. Do not put the secret in a URL, query string, or log.

## Manual PowerShell trigger

Set `API_BASE_URL` and `JOB_CRON_SECRET` in the current PowerShell process through your local secret manager, then run:

```powershell
$base = $env:API_BASE_URL.TrimEnd('/'); Invoke-WebRequest -Uri "$base/api/health" -Method Get | Out-Null; Invoke-RestMethod -Uri "$base/api/internal/jobs/run" -Method Post -Headers @{ 'X-Cron-Secret' = $env:JOB_CRON_SECRET } -ContentType 'application/json' -Body '{}'
```

The one-liner reads the secret from the environment and does not print it. Avoid shell history or transcripts that record environment assignments.

## Review results

While signed into the admin site, open:

- `/api/admin/career/runs` for recent run and per-source summaries.
- `/api/admin/career/jobs` for the private job review list.

These are API paths; the API host is configured by the existing portfolio deployment. Both endpoints require an authenticated admin session and return `Cache-Control: no-store`.

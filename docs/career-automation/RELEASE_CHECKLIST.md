# Career Radar release checklist

**Status (26 November 2026):** Career Radar code and `.github/workflows/career-radar-scheduled-scan.yml` are on `main`. The workflow defines four daily scan triggers (00:15, 06:15, 12:15, and 18:15 in `Africa/Nairobi`) plus manual dispatch. This confirms that the scheduler exists in source; it does **not** prove that production scans are active. Activation still requires confirming the previously exposed database credential was rotated/revoked, verifying the intended database and usable backup, applying and verifying migrations `004`–`010`, confirming the deployed API, and configuring the matching API/repository secrets. The live database, API environment, GitHub Actions secrets, and scheduled execution have not been verified in this session.

## Before touching the database

1. Rotate/revoke the historical Supabase database credential outside this repository. Check access logs and review other credential-like historical values. Do not paste secrets into chat, issues, or source control.
2. Confirm the database target by checking the Supabase project name/ID in the Dashboard and confirming that the API environment's `DATABASE_URL` points to that same project. Never guess the target from a connection string alone.
3. Take a backup or export using the provider's supported procedure and confirm that it is usable. Keep the backup private and record when it was taken.
4. Confirm the latest `main` commit intended for release has passing API lint/tests, client lint/type-check/production build, and CodeQL checks. A green CI run validates code checks only; it does not validate production configuration or data.
5. Do not enable live Gmail sending while testing schema changes. Keep `JR_SEND_MODE=draft`.

## Migration order

Use the numbered API migration files in this exact dependency order:

| Migration file | SQL Editor copy | Purpose |
|---|---|---|
| `api/migrations/004_career_foundation.sql` | `docs/career-automation/sql/phase-1.sql` | Private preferences, source registry, profiles, scan ledger |
| `api/migrations/005_career_intake.sql` | `docs/career-automation/sql/phase-2.sql` | Normalized job intake and ATS watchlist |
| `api/migrations/006_career_assessments.sql` | `docs/career-automation/sql/phase-3a.sql` | Eligibility and fit assessments |
| `api/migrations/007_career_applications.sql` | `docs/career-automation/sql/phase-4.sql` | Private tracker and append-only events |
| `api/migrations/008_career_preparation.sql` | `docs/career-automation/sql/phase-6.sql` | Application packets and Gmail OAuth state/credentials |
| `api/migrations/009_career_documents.sql` | `docs/career-automation/sql/phase-5.sql` | Encrypted private document vault and per-file email-consent ledger |
| `api/migrations/010_career_public_snapshots.sql` | `docs/career-automation/sql/phase-7.sql` | Immutable owner-published public snapshots |

The migration numbers reflect actual dependency history, **not** the phase numbers shown in the documentation. In particular, run Phase 6 SQL (migration `008`) before Phase 5 SQL (migration `009`).

## Option A — run the guarded migration command

Use a trusted local checkout of the intended feature commit. Configure the rotated `DATABASE_URL` in your local ignored API environment file or approved secret manager; never commit it.

From the repository root:

```powershell
cd api
npm ci
npm run db:migrate-career
```

The command explicitly applies migrations `004`–`010` in order. It never runs automatically when the API starts. It logs the migration file it applies; if it stops part-way, earlier files may already have committed. Review the error and confirm the target database before retrying. The scripts are designed to be repeatable, but a failure is not an automatic rollback.

## Option B — use Supabase SQL Editor

Use the SQL Editor in the **verified target project**. Review and run each complete SQL file in the table above, one file at a time and in order. Do not paste secrets or service-role keys into SQL. Do not run the rollback files as part of deployment.

If an earlier migration is already installed, first verify its tables and privileges rather than assuming its state. The SQL is additive and repeatable; do not delete or reset existing portfolio, admin, session, resume-profile, or application data.

 
## Activate the scheduled scan

Only do these steps after the credential, backup, migration, and API-deployment gates above are verified.

1. Open the repository's **Actions** tab, choose **Career Radar scheduled scan**, and click **Run workflow**. The workflow validates both required secrets before calling the protected worker endpoint.
2. Confirm the workflow run succeeds, then sign in to the portfolio admin and open **Job Radar** (`/admin/career`). Check **Dashboard → Recent scan activity** and **Source health**. An accepted trigger is not proof every source completed; the private run ledger is the source of truth.
3. The GitHub schedule runs four times daily: **06:15, 12:15, 18:15, and 00:15 East Africa Time**. Manual scans use the authenticated **Scan now** button and are limited by the API.
4. Use one scheduler only. If you later activate the n8n workflow template, disable the GitHub workflow's `schedule` trigger first; the worker endpoint permits only four triggers per rolling 24 hours.
5. Application preparation additionally needs migrations `008` and `009`, a valid `DOC_ENCRYPTION_KEY`, and the private career document bucket. Keep `JR_SEND_MODE=draft`; Gmail OAuth, sending, and public publishing are separate opt-in steps.

## Verify the results

Run these checks in the same target database after the migrations finish:

- `docs/career-automation/sql/phase-1.verify.sql`
- `docs/career-automation/sql/phase-2.verify.sql`
- `docs/career-automation/sql/phase-3a.verify.sql`
- `docs/career-automation/sql/phase-4.verify.sql`
- `docs/career-automation/sql/phase-5.verify.sql`
- `docs/career-automation/sql/phase-7.verify.sql`

For each returned career table, confirm RLS is enabled and `anon_can_select` / `authenticated_can_select` are both `false`. If any table is missing, a privilege result is true, or a migration reports an error, stop and share the non-secret error/output before proceeding.

You can also verify the new private objects exist with:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'jr_application_packets',
    'jr_gmail_oauth_states',
    'jr_gmail_credentials',
    'jr_career_documents',
    'jr_career_document_consents',
    'jr_public_snapshots'
  )
ORDER BY table_name;
```

Expected output is six rows. This query does not expose secret values.

## After the migrations

1. Configure and verify the API's server-side `DOC_ENCRYPTION_KEY` (32 bytes encoded as 64 hexadecimal characters or canonical base64) and `CAREER_DOCUMENT_BUCKET=career-private-documents`, plus the existing Supabase URL/service-role configuration. Keep the career bucket private; the API must refuse a public bucket.
2. Confirm that the hosting provider has deployed the intended API code and that `GET /api/health` succeeds on the actual API host. A green Vercel check for the frontend does not prove the API or database is ready.
3. Set a new strong `JOB_CRON_SECRET` on the API service. In the GitHub repository, add Actions secrets `CAREER_API_BASE_URL` (the deployed API's public HTTPS origin only—not the Vercel frontend URL unless it truly is the API) and `JOB_CRON_SECRET` with the exact same value as the API environment. Do not commit or paste either secret into source files or chat.
4. Keep Gmail in draft mode until OAuth settings are configured server-side, the intended account is connected, generated CV/cover-letter PDFs are reviewed, and a send is deliberately authorized. No test email should be sent during the migration step.
5. Leave public publishing off unless you explicitly choose to enable it. Review the generated snapshot and original employer links before using the separate publish confirmation.

**Stop condition:** Do not treat the release as live merely because the PR merged, CI passed, or SQL succeeded. Confirm credential rotation, verified migrations and RLS, deployed client/API versions, a successful authenticated scheduled scan visible in the private ledger, and each optional integration separately.
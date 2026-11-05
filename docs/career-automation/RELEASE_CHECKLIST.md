# Career Radar release checklist

**Status:** production steps are not complete. This feature branch is not the live site. Do not apply migrations until the historical database credential identified in the implementation plan has been rotated/revoked, the replacement credential is configured in the intended API environment, and a verified backup exists.

## Before touching the database

1. Rotate/revoke the historical Supabase database credential outside this repository. Check access logs and review other credential-like historical values. Do not paste secrets into chat, issues, or source control.
2. Confirm the database target by checking the Supabase project name/ID in the Dashboard and confirming that the API environment's `DATABASE_URL` points to that same project. Never guess the target from a connection string alone.
3. Take a backup or export using the provider's supported procedure and confirm that it is usable. Keep the backup private and record when it was taken.
4. Make sure the feature branch's API lint/tests, client lint/type-check/production build, and CodeQL checks are green for the exact commit intended for release.
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
2. Merge and deploy only after the owner reviews the completed PR and passes the explicit security-release gate. Until merge/deployment, the production admin site remains unchanged.
3. Configure GitHub Actions secrets `CAREER_API_BASE_URL` (HTTPS API origin) and `JOB_CRON_SECRET` (same random value as the API service) only after the API deploy is confirmed; then run the workflow manually and inspect the private scan ledger.
4. Keep Gmail in draft mode until OAuth settings are configured server-side, the intended account is connected, generated CV/cover-letter PDFs are reviewed, and a test send is deliberately authorized. No test email should be sent during the migration step.
5. Leave public publishing off unless you explicitly choose to enable it. Review the generated snapshot and original employer links before using the separate publish confirmation.

**Stop condition:** Do not merge or treat the release as live merely because the SQL succeeds. Confirm the rotated credential, verified migrations and RLS, deployed API/client version, scheduled trigger, and any optional integrations separately.
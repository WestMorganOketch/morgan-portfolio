# Career Automation Centre Implementation Plan

## Phase 0 findings (1 November 2026)

- The original Phase 0 findings were recorded on `feat/career-automation`; the current implementation review is on `feat/career-radar-real-workflow` in draft PR [#16](https://github.com/WestMorganOketch/morgan-portfolio/pull/16). Pre-existing untracked `.vscode/` content was preserved.
- The API claim route inserts the fixed account row with `ON CONFLICT (id) DO NOTHING`; a claimed account cannot be overwritten. Isolated Node tests verify repeat claims return 409 and concurrent first claims create one account. No production database or account/session data was accessed.
- If the account row is accidentally deleted, `/api/admin/claim` becomes available to the first visitor again. The repository README also documents deleting the account and sessions to reset it. Do not execute that SQL. Close this recovery gap only through an owner-approved, non-destructive recovery design that preserves the current account and sessions.
- Gitleaks scanned 25 commits and the worktree. Historical `api/env` content includes a credential-bearing database connection string and other credential-like values; values are intentionally omitted. Treat the database credential as exposed and rotate/revoke it immediately, then review provider access and session-secret use. The current `api/env` file is empty; removing a value from the current revision does not remove it from Git history.
- `.vite/deps/` is tracked generated dependency-optimizer metadata, not application source. `morgan-protfolio/` is a tracked, separate default Next.js starter, while the active portfolio is `client/`. Neither was modified or deleted; decide on a separately reviewed cleanup after confirming no external workflow depends on them.
- API baseline: lint and tests pass (25/25); `npm audit` reports 5 moderate findings in `minimatch`-related dependencies.
- Client baseline: lint, typecheck, and production build pass; `npm audit` reports 16 moderate findings in `minimatch`-related dependencies. No baseline code changes were made.

## Scope and implementation order

Implement one phase per explicit owner instruction. Keep the existing portfolio and admin account intact. All database work is additive, all career tables use the `jr_` prefix, and migrations are applied only by an explicitly operated migration command—not at API startup or against production by the agent.

| Phase | Current status and verified scope |
|---|---|
| 1 — Database/API foundation | **Implemented on the feature branch.** Additive migration `004_career_foundation.sql`; protected Career API routes, validation, owner-preserving auth safeguards, and tests. |
| 2 — Intake and scheduling | **Implemented on the feature branch.** Migration `005_career_intake.sql`; fixed-host Jobicy, Remote OK, Remotive, Arbeitnow and configured ATS-watchlist adapters; normalized import/deduplication; request accounting; bounded locked scans; fixture tests. A trigger-only scheduled workflow exists at `.github/workflows/career-radar-scheduled-scan.yml` on this feature branch; GitHub schedules it only after the workflow is on the default branch, and it still requires owner-configured `CAREER_API_BASE_URL` and matching `JOB_CRON_SECRET` secrets. The alternative private-worker template is at `docs/career-automation/worker/run-scan.yml`. |
| 3 — Fit and risk | **Implemented on the feature branch.** `api/src/careerAssessment.js` and `api/src/careerRisk.js` provide explainable eligibility/fit and static advert-risk triage. Tests cover role fit, eligibility evidence, scam indicators, unsafe URLs, and negation/contrast cases. Listing URLs are not fetched; low risk does not certify a real employer. |
| 4 — Private review centre and tracker | **Implemented on the feature branch.** `client/src/components/CareerCentre.tsx`, `client/src/components/Admin.tsx`, protected routes, migration `007_career_applications.sql`, review queues, source setup, resume profiles/preferences, and application tracking. |
| 5 — Encrypted document vault | **Not implemented.** Proposed work: `api/migrations/009_career_documents.sql`, `api/src/careerDocuments.js`, focused tests, private encrypted storage, owner-approved per-file release consent, and Career Centre UI. Do not claim the current master-profile text field is an encrypted file vault. |
| 6 — Preparation and controlled send | **Implemented on the feature branch.** Migration `008_career_preparation.sql`; deterministic CV/cover-letter drafts from profile facts, versioned packets/PDFs, Gmail OAuth using narrow send scope and encrypted refresh tokens, review-version checks, send limits, explicit final confirmation, and manual-attention status for ambiguous provider outcomes. Although this is conceptual Phase 6, migration `008` reflects the actual implementation/dependency history; the future vault migration would be `009`. |
| 7 — Approved public snapshot | **Not implemented and not required for private search.** No public radar endpoint or public publishing flow is claimed to exist. If pursued later, use a dedicated additive migration after owner review and a strict field allowlist. |
| 8 — Hardening and handoff | **Partially complete on the feature branch.** API/client lint, tests, type-check/build and current CodeQL workflows have passed for commit `5d553e3d88a5b49ab596cce3dc69872702286938`. An explicit ordered migration runner and status notes exist. Production credential rotation, database migration, scheduler secrets/configuration, Gmail OAuth, live-send verification, deployment/rollback and dependency-audit remediation remain outstanding. |

Implementation filenames may be adjusted only when inspection of the current code shows a direct existing pattern that is safer and simpler; keep this plan synchronized when that occurs.

## Route map

| Route | Access and behavior |
|---|---|
| `POST /api/internal/jobs/run` | Worker-only; require `JOB_CRON_SECRET`, constant-time comparison after byte-length validation, bounded JSON body, POST only, durable idempotency/lock, and bounded asynchronous scan. Return 404 when not configured. Never send, share documents, submit applications, or publish. |
| `/api/admin/career/*` | Existing admin session required on every route; existing same-origin and CSRF checks on mutations; private responses use `Cache-Control: no-store`. Covers overview, scan-now, import, jobs/queue, settings, profiles, documents, application drafts/tracker, Gmail connection, and snapshot preview/publish. |
| `GET /api/public/radar` | Public, read-only; fetch only the latest approved `jr_public_snapshot` row. Explicit field allowlist, no employer identity or private application/document data. |

There is no public scan trigger, arbitrary-URL proxy, or public access to career records.

## Source registry, permissions, and polling gates

Every source entry must retain its terms/documentation URL, review date, authentication, polling limit, attribution rule, private-admin permission, and independent public-redisplay permission. Unknown permission disables that use. Recheck current official terms and record approval before enabling any adapter; the limits below are the requirements supplied in the project brief, not a substitute for that review.

| Source | Phase 2 status | Last reviewed | Polling/request limits | Attribution |
|---|---|---|---|---|
| Jobicy | Enabled; one title-tag query per scan; current API endpoint only | 2026-11-02; `tag` documented in [official API docs](https://jobicy.com/jobs-rss-feed) | Minimum 3,600 seconds between scans; 24 requests/day ceiling; rotate at most four existing role keywords across scans | “Jobicy” and preserve original listing URL |
| Remote OK | Enabled; public JSON feed; generic feed retained | 2026-11-02; no search/tag parameter found in [official API feed and terms](https://remoteok.com/api) | Minimum 21,600 seconds between scans; 4 requests/day ceiling | “Remote OK” and preserve original listing URL |
| Remotive | Enabled for private admin only; public redisplay off; one documented `search` query per scan | 2026-11-02; `search` documented in the [official API README](https://github.com/remotive-com/remote-jobs-api) | Minimum 21,600 seconds between scans; maximum 4 requests/day and at least 30 seconds between request attempts; rotate at most four existing role terms/day; listings are delayed 24 hours | Retain Remotive attribution fields and original listing link |
| Arbeitnow | Enabled; no Kenya eligibility is inferred | 2026-11-01 (implementation plan reviewed; official terms not independently rechecked) | Minimum 21,600 seconds between scans; 4 requests/day ceiling | Preserve source and listing link |
| Greenhouse / Lever | Permission allowed; polling disabled until a board is added and the registry source is explicitly enabled | 2026-11-01 (implementation plan reviewed; official terms not independently rechecked) | Minimum 21,600 seconds between scans; 4 requests/day ceiling across watchlist | Preserve official board link and employer label |
| Manual import | Enabled; URL/text is admin supplied and the URL is never fetched | 2026-11-01 | No network requests | “Manually imported by admin” |
| MyJobMag Kenya RSS | Disabled; no adapter | 2026-11-01 (official feed directory fetch did not expose a feed URL; private polling terms not confirmed) | None until exact feed and private-use permission are verified | Keep MyJobMag attribution; public redisplay off |
| ReliefWeb, Careerjet, Jooble, Himalayas, Online Jobs, Adzuna | Disabled; no adapter | Not re-reviewed | None | Do not enable until specific access and use permissions are verified |
| BrighterMonday, MyJobMag, Fuzu, LinkedIn, PSC, employer pages | Saved-search links and user-initiated URL/text import only | 2026-11-01 (implementation plan reviewed; site query formats not independently reviewed) | No scraping, browser automation, or inbox reading | Show source and original listing link; treat imported text as untrusted |

All adapters isolate failures, validate response shapes, deduplicate across sources, preserve original URLs/attribution, apply bounded connection/read timeouts and limited retry/backoff honoring `Retry-After`, and use fixture-only tests without live network calls.

## Required tests and validation by phase

- Phase 1: existing-account and concurrent-claim regression fixtures; admin/CSRF/same-origin rejection; migration idempotence; RLS enabled and grants revoked on every `jr_` table; no public policies; input bounds; no automatic migration on startup.
- Phase 2: per-provider fixture parsing, attribution preservation, provider quota/poll accounting, cross-source dedupe, 429/outage isolation, idempotent internal trigger, missing/wrong secret rejection, and no outbound email/document/publication side effects.
- Phase 3: role-family boundaries, Kenya/Tanzania/Uganda and Kenya-eligible remote evidence, unknown eligibility, exact 100-point weights, missing facts, scam indicators, and SSRF/private-IP/redirect/body/time limits.
- Phase 4: protected admin view/mutations, five new eligible lower-risk packet maximum, compact qualified shortlist, `Maybe` for unknown eligibility, and preserved existing admin features.
- Phase 5: AES-GCM round-trip/tamper rejection, missing/invalid key fails closed, file signature/MIME/size and total-cap checks, private storage paths, and explicit per-file consent/audit.
- Phase 6: deterministic drafts with no model key, verified-claim traceability, draft-only default, narrow send-only OAuth, callback state/PKCE, send/day and 60-second gap enforcement, duplicate-employer confirmation, duplicate-send protection, and final-click-only provider invocation.
- Phase 7: only the latest approved snapshot read; preview/publish confirmation; explicit public-field allowlist; forbidden company, salary, contact, rejection, application, resume, note, and signed-link fields rejected; chart/text values match the snapshot.
- Phase 8: rerun API lint/test/audit and client lint/typecheck/build/audit; document which checks pass, baseline findings, owner approvals, backup/restore and rollback; never deploy or publish as part of tests.

## Blockers and owner decisions

1. Rotate/revoke the historical database credential, and review the other credential-like historical values. Do not paste secrets into chat or source control. Consider history rewriting only as a separate owner-approved operation after rotation; rotation is required regardless.
2. No live admin account, database, session, storage bucket, OAuth, source API key, or deployment was accessed. The isolated test demonstrates conflict safety; it cannot attest to live account state.
3. Before Phase 1 auth/recovery changes, agree on a safe recovery path that cannot expose first-claim takeover after accidental account loss, while preserving the already-claimed account and every existing session.
4. Before enabling additional sources or deploying, verify official current source docs/terms and exact feed URLs; obtain approved ReliefWeb appname or Careerjet key only if Morgan chooses those sources; define the initial Greenhouse/Lever employer watchlist.
5. Before Phase 5/6/7, Morgan configures encryption/OAuth/cron secrets server-side, explicitly opts in to any external drafting data processing, and approves any source-specific public redisplay. No secret values belong in this document.
6. API/client audits have moderate `minimatch` dependency findings at baseline; do not run `npm audit fix --force` because its proposed ESLint downgrade is breaking. Address dependency findings in a separate reviewed dependency change.

Phase 0 findings are retained as a historical record. The table above reflects actual branch status; the sections below record implementation details and current owner-controlled release gates.

## Phase 1 status

- Implemented the additive `jr_` schema, private admin foundation routes, protected worker stub, and opt-in first-claim guard; tests use only isolated in-memory fakes.
- The SQL is available for Supabase SQL Editor and as migration `004`; `npm run db:migrate` applies numbered SQL files explicitly in its existing runner.
- No production database, account, session, or deployment was accessed; Phase 2 proceeded only after explicit owner authorization.

## Phase 2 status

- Added fixture-tested fixed-host adapters, intake normalization/deduplication, source request accounting, and shared locked manual/worker scan processing; MyJobMag remains disabled.
- Added private job/import/watchlist/search-link APIs, additive Phase 2 SQL, and a private-worker workflow template; no SQL was executed.
- API lint passed and the complete test suite passed (61/61); adapter tests used injected fixtures rather than provider network calls.
- MyJobMag's official directory did not confirm a feed URL or private-polling permission; that source remains disabled.

## Phase 3A status

- Added deterministic, fixture-tested Kenya eligibility evidence and weighted fit assessments; the latest active profile for a matching track is treated as its selected master profile.
- Added private assessment APIs, filters, profile-change reassessment, ingestion screening, configurable hard filters, and the paste-ready Phase 3A SQL; no SQL was executed.
- Corrected Remotive to use its documented `search` parameter with daily rotation within the existing request ledger and provider caps.

## Phase 4 status

- Added the private admin Career Centre, including overview, review queues, import, profile and preference management, source setup, and the application tracker.
- Added the additive application/event SQL, protected tracker and review-status operations, and a Nairobi-day shortlist capped by the saved daily limit.
- Advert risk screening is now integrated into the private job list and overview; high-risk adverts are excluded from the automatic shortlist and blocked during packet preparation and the final send check. The screen remains explicitly rule-based and does not verify employer legitimacy or fetch listing URLs.
- No SQL was applied and no production database, source, application submission, or external service was accessed.

## Advert-risk integration status (5 November 2026)

- Added `api/src/careerRisk.js` for bounded, deterministic screening of already-ingested job data. It identifies explicit candidate-payment requests, requests for passwords/one-time codes, unrealistic offers, chat-only recruitment channels, unidentified employers, shortened links, missing URLs, non-HTTPS links, and unsafe URL syntax/private IP literals.
- The result includes evidence, severity, confidence, timestamp, and unresolved verification questions. Anti-scam disclaimers are checked so their warnings are not automatically mistaken for demands; later, separately stated demands must still be detected.
- Only adverts assessed as both location/work-authorization eligible and low-risk enter the daily shortlist. Unknown eligibility and medium-risk adverts remain in a review queue. High-risk adverts cannot have application packets prepared or sent through the protected workflow, including when a prior packet exists.
- The URL check is intentionally static and makes no network request. `dns_ok`, HTTP status, redirect count, and domain age remain unset/false; a low-risk result means only that these rules found no obvious flag, not that the vacancy or employer is verified. Review the employer's own careers page before applying.

## Phase 6 status — preparation and controlled send

- The feature branch includes additive migration `api/migrations/008_career_preparation.sql`, draft generation from the selected master CV and recorded profile facts, versioned application packets, PDF generation, Gmail OAuth connection handling, and a final-click send endpoint.
- The Gmail integration requests only OpenID/email and Gmail send scope, encrypts refresh tokens with the configured `DOC_ENCRYPTION_KEY`, and is disabled for live sending unless `JR_SEND_MODE=live`. The final send path requires the reviewed packet version and applicable eligibility/warning confirmations, enforces limits, and records send outcomes. Ambiguous outcomes are not automatically retried.
- This is implementation-branch status, not a production deployment claim. The migration has not been applied, Gmail has not been connected, no credential was configured by the agent, and no email has been sent. Keep sending in draft mode until the owner has configured secrets, tested OAuth, and reviewed the generated documents.

## Remaining owner-controlled release gates

1. Rotate/revoke the historical database credential already identified in Phase 0, then check provider access and any related secrets. Do not paste values into chat or commit history.
2. Review the feature PR and its final quality checks before merging; the feature branch has not been merged to `main`.
3. Apply only the additive career SQL through the explicitly operated migration procedure after confirming a backup and the target environment. Do not execute migration SQL automatically at server startup.
4. Configure `JOB_CRON_SECRET` and `CAREER_API_BASE_URL` for the scheduled workflow, and verify the API URL is your intended HTTPS API origin. Configure Gmail OAuth redirect/client values and `DOC_ENCRYPTION_KEY` server-side if you choose to enable application preparation/send.
5. The encrypted document vault, approved public snapshot/publishing flow, full deployment/rollback handoff, and live end-to-end verification remain separate work. Do not treat this risk-screening PR as completion of those phases.


## Latest verified code-quality status (5 November 2026)

- Fixed the contrast-clause payment-risk regression in `api/src/careerRisk.js`; a later payment demand is still flagged even when preceded by an anti-scam disclaimer.
- Refactored the Gmail OAuth test to inject deterministic random bytes **only in the test** and assert the known SHA-256 state digest and PKCE challenge. Production calls retain Node's `crypto.randomBytes` default; the test no longer asks CodeQL to interpret a live random OAuth nonce as a password.
- For commit `5d553e3d88a5b49ab596cce3dc69872702286938`, GitHub CI passed API lint and tests, client lint/type-check/production build, both CodeQL analysis jobs, and the CodeQL check reported **no new alerts**. The Vercel PR preview check reported no unresolved feedback. These are repository/preview checks, not live production end-to-end verification.
- Added `npm run db:migrate-career`, which explicitly runs Career Radar migrations `004`–`008` in order. A regression test confirms the runner is not invoked from API startup. This command has **not** been run against a database; confirm a backup and target environment before the owner runs it.
- PR [#16](https://github.com/WestMorganOketch/morgan-portfolio/pull/16) remains draft and unmerged. The production site continues to use the default branch until the owner reviews and merges the changes, so the preview is not proof that the live admin panel has these updates.
- No production database, account, session, storage bucket, Gmail OAuth, schedule secret, live email send, or production deployment was accessed or changed. The historical database credential identified in Phase 0 still needs owner-led rotation/revocation before release. The encrypted document vault (Phase 5) and public snapshot/publishing flow (Phase 7) are not implemented.

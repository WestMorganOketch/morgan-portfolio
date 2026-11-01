# Career Automation Centre Implementation Plan

## Phase 0 findings (1 November 2026)

- Work is on `feat/career-automation`; pre-existing untracked `.vscode/` content is preserved.
- The API claim route inserts the fixed account row with `ON CONFLICT (id) DO NOTHING`; a claimed account cannot be overwritten. Isolated Node tests verify repeat claims return 409 and concurrent first claims create one account. No production database or account/session data was accessed.
- If the account row is accidentally deleted, `/api/admin/claim` becomes available to the first visitor again. The repository README also documents deleting the account and sessions to reset it. Do not execute that SQL. Close this recovery gap only through an owner-approved, non-destructive recovery design that preserves the current account and sessions.
- Gitleaks scanned 25 commits and the worktree. Historical `api/env` content includes a credential-bearing database connection string and other credential-like values; values are intentionally omitted. Treat the database credential as exposed and rotate/revoke it immediately, then review provider access and session-secret use. The current `api/env` file is empty; removing a value from the current revision does not remove it from Git history.
- `.vite/deps/` is tracked generated dependency-optimizer metadata, not application source. `morgan-protfolio/` is a tracked, separate default Next.js starter, while the active portfolio is `client/`. Neither was modified or deleted; decide on a separately reviewed cleanup after confirming no external workflow depends on them.
- API baseline: lint and tests pass (25/25); `npm audit` reports 5 moderate findings in `minimatch`-related dependencies.
- Client baseline: lint, typecheck, and production build pass; `npm audit` reports 16 moderate findings in `minimatch`-related dependencies. No baseline code changes were made.

## Scope and implementation order

Implement one phase per explicit owner instruction. Keep the existing portfolio and admin account intact. All database work is additive, all career tables use the `jr_` prefix, and migrations are applied only by an explicitly operated migration command—not at API startup or against production by the agent.

| Phase | Planned files and work |
|---|---|
| 1 — Database/API foundation | Add `api/migrations/004_career_foundation.sql` for private preferences, profiles, source registry, run ledger/lock, normalized jobs, and append-only events. Add `api/src/careerRoutes.js` and `api/src/careerValidation.js`; mount the router in `api/src/app.js` using existing admin, same-origin, and CSRF middleware. Add `api/test/career-auth.test.js`, `api/test/career-migration.test.js`, and `api/test/career-validation.test.js`. Update `api/.env.example` for names only. Update `README.md` to remove destructive claim-reset instructions and document safe owner recovery. |
| 2 — Intake and scheduling | Add `api/src/careerSources.js`, `api/src/careerImport.js`, `api/test/career-sources.test.js`, and `api/test/career-import.test.js`; add fixtures under `api/test/fixtures/career/`. Extend `api/src/careerRoutes.js` with protected import/run operations. Add `docs/career-automation/SOURCES.md` and `docs/career-automation/WORKER.md` for source permissions, provider budgets, and the private trigger-only GitHub Actions worker. The private worker repository itself is owner-created; no source fetch or application action runs in it. |
| 3 — Fit and risk | Add `api/src/careerScoring.js`, `api/src/careerRisk.js`, `api/src/careerUrlSafety.js` and corresponding `api/test/career-scoring.test.js`, `api/test/career-risk.test.js`, and `api/test/career-url-safety.test.js`. Keep matching deterministic and evidence-backed; no arbitrary-URL fetch from public routes. |
| 4 — Private review centre | Add `client/src/components/CareerCentre.tsx`; integrate it into `client/src/components/Admin.tsx` and existing admin navigation/state as appropriate. Extend the protected overview, queue, preference, profile, and tracker operations in `api/src/careerRoutes.js`. Add `api/test/career-queue.test.js` and targeted client tests if a test runner is already available; otherwise validate with existing lint/typecheck/build. |
| 5 — Encrypted document vault | Add `api/migrations/005_career_documents.sql`, `api/src/careerDocuments.js`, and `api/test/career-documents.test.js`; add `api/.env.example` variable name `DOC_ENCRYPTION_KEY`. Extend admin document routes and `client/src/components/CareerCentre.tsx`. Keep career objects in a private bucket, AES-256-GCM encrypted before upload, with metadata only in Postgres and per-file release consent. |
| 6 — Preparation and send review | Add `api/migrations/006_career_applications.sql`, `api/src/careerApplications.js`, `api/src/careerGmail.js`, and `api/test/career-applications.test.js` / `api/test/career-gmail.test.js`. Extend the career admin UI for drafts and explicit final send confirmation. Add `JR_SEND_MODE` (default `draft`), OAuth variable names, configured daily cap, Nairobi-day server enforcement, duplicate protection, and send audit events. |
| 7 — Approved public snapshot | Add `api/migrations/007_career_public_snapshot.sql`, `api/src/careerPublicSnapshot.js`, and `api/test/career-public-snapshot.test.js`. Add only `GET /api/public/radar`, reading the latest owner-published snapshot; add an explicit preview/approve/publish flow to the private career admin UI. |
| 8 — Hardening and handoff | Add `docs/career-automation/ARCHITECTURE.md` and `docs/career-automation/DEPLOYMENT_CHECKLIST.md`; update `README.md`, `client/README.md`, and `api/.env.example` only for confirmed setup, backup/restore, safe recovery, and deployment guidance. Run focused and full checks, review source permissions, document rollback, and leave production deployment/send/publish to explicit owner action. |

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
| Jobicy | Enabled; current API first, legacy endpoint fallback | 2026-11-01 (implementation plan reviewed; official terms not independently rechecked) | Minimum 3,600 seconds between scans; 24 requests/day ceiling | “Jobicy” and preserve original listing URL |
| Remote OK | Enabled; public JSON feed | 2026-11-01 (implementation plan reviewed; official terms not independently rechecked) | Minimum 21,600 seconds between scans; 4 requests/day ceiling | “Remote OK” and preserve original listing URL |
| Remotive | Enabled for private admin only; public redisplay off | 2026-11-01 (implementation plan reviewed; official terms not independently rechecked) | Minimum 21,600 seconds between scans; maximum 4 requests/day and at least 30 seconds between request attempts; listings are delayed 24 hours | Retain Remotive attribution fields and original listing link |
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

Phase 0 findings are retained as a record. Phase 1 and Phase 2 are recorded below; do not begin the next phase until Morgan explicitly authorizes it.

## Phase 1 status

- Implemented the additive `jr_` schema, private admin foundation routes, protected worker stub, and opt-in first-claim guard; tests use only isolated in-memory fakes.
- The SQL is available for Supabase SQL Editor and as migration `004`; `npm run db:migrate` applies numbered SQL files explicitly in its existing runner.
- No production database, account, session, or deployment was accessed; Phase 2 proceeded only after explicit owner authorization.

## Phase 2 status

- Added fixture-tested fixed-host adapters, intake normalization/deduplication, source request accounting, and shared locked manual/worker scan processing; MyJobMag remains disabled.
- Added private job/import/watchlist/search-link APIs, additive Phase 2 SQL, and a private-worker workflow template; no SQL was executed.
- API lint passed and the complete test suite passed (61/61); adapter tests used injected fixtures rather than provider network calls.
- MyJobMag's official directory did not confirm a feed URL or private-polling permission; Phase 3 remains unauthorized.

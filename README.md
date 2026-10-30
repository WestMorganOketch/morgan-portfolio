# Morgan West Oketch — Cybersecurity Portfolio

A polished, responsive professional portfolio for Morgan West Oketch. The public website presents cybersecurity, IT support, data, and systems experience; its companion API powers private administration and interactive features.

## Tech stack

- Website: Next.js App Router, React, TypeScript, Tailwind CSS, and Framer Motion.
- API: Node.js and Express.
- Database and document storage: Supabase Postgres and private Supabase Storage.
- Quality and validation: ESLint, TypeScript, Zod, and Node's built-in test runner.
- Hosting targets: Vercel for the website and Render for the API.

## Repository layout

- `client/` — Next.js App Router website and admin interface.
- `api/` — Express API, database migrations, and automated tests.
- `client/README.md` — local setup, content management, and step-by-step Render, Vercel, and Supabase deployment guidance.

## Features

- Responsive, accessible portfolio pages with light/dark themes, reduced-motion support, search, and SEO metadata.
- Email-and-password protected admin tools for portfolio entries, contact messages, scores, and documents.
- Contact submissions require consent, remain private to the admin, and expire after 90 days.
- A server-scored alert-triage game keeps answers private until a round is submitted.
- A public leaderboard contains only chosen nicknames, scores, and dates.
- A document vault only exposes published files using short-lived links from private storage.
- Health checks, security headers, CORS allow-listing, and request throttling.

## Run locally

Use Node.js 22.13+ or 20.19+. Create a Supabase project, then configure the variables listed below in local `api/.env` and `client/.env.local` files using the example files as guides. Do not commit those local files.

In the first PowerShell terminal:

```powershell
cd api
npm install
Copy-Item .env.example .env
npm run db:migrate
npm run dev
```

In a second terminal:

```powershell
cd client
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open the local Next.js address shown by the client dev server. See [`client/README.md`](./client/README.md) for variable setup, content editing, and detailed deployment steps.

## Admin sign-in

The first visitor to `/admin` creates the single admin account with an email and password. The account is stored in Supabase; passwords use Node.js scrypt and sessions use random, database-backed tokens. No admin credentials, password hashes, or session secrets need to be configured as environment variables. Once claimed, setup stays closed unless the account is reset.

To reset the admin account, run these statements in the Supabase SQL Editor:

```sql
DELETE FROM public.admin_sessions;
DELETE FROM public.admin_account;
```

The next visitor can claim the account again. The API creates and secures the admin tables at startup.

## Environment variable names

The API uses `NODE_ENV`, `PORT`, `DATABASE_URL`, `DB_SSL`, `DB_SSL_CA_PATH`, `DB_SSL_CA`, `WEB_ORIGINS`, `TRUST_PROXY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_DOCUMENT_BUCKET`. Admin credentials are stored in the database, not environment variables.

The website uses `VITE_API_URL`, `PORTFOLIO_API_ORIGIN`, and `NEXT_PUBLIC_SITE_URL`.

## Security

- Helmet security headers, strict environment-configured CORS origins, and global plus route-specific rate limits.
- Zod input validation, parameterized SQL, request-size limits, and generic production errors.
- Scrypt-hashed admin credentials, secure HTTP-only same-site session cookies with hashed database tokens, CSRF and same-origin checks, and server-side authorization for admin routes.
- Row-level security is enabled on every API table without anonymous or authenticated policies; those Supabase roles have no table or sequence privileges. The API connects through the trusted Postgres role, which owns these tables and therefore bypasses RLS unless row security is forced.
- Private document storage, content-signature checks, randomized object names, short-lived signed links, and publish-only access.
- Contact retention is limited to 90 days; game answers and identifying visitor data are not exposed in the public leaderboard.

For every future database table, add an additive migration that enables RLS immediately after creation and revokes privileges from `PUBLIC`, `anon`, and `authenticated`; do not add public policies. Keep the API on its trusted Postgres connection, not a Supabase browser key. Never commit `.env` files, database credentials, admin secrets, service-role keys, private keys, or the legacy résumé PDF.

## Checks

Run these from their respective directories:

```powershell
# api/
npm run lint
npm test
npm audit

# client/
npm run lint
npm run typecheck
npm run build
npm audit
```

# Morgan Oketch — cybersecurity portfolio

A Next.js App Router, React, and TypeScript portfolio with individual routes, a responsive light/dark theme, and a protected Node.js/Express + PostgreSQL content manager. Portfolio copy and profile details live in structured TypeScript data; additional records can be published from `/admin`.

## Before you start

- Install Node.js 22.13+ (or Node.js 20.19+). The current development machine runs Node 22.5.1; upgrade it before installing to avoid dependency engine warnings.
- Create a Supabase project for managed PostgreSQL. The free tier is suitable for learning and testing, but Supabase may pause a free project after a week without activity. Never put a database URL, password, session key, or administrator password in frontend code or chat.
- The previous résumé PDF in `public/documents/` is intentionally Git-ignored and is not part of a deployment. Upload a sanitized replacement through `/admin` and publish it from the document vault when ready.

## Local setup

### 1. Configure the API and database

From a VS Code PowerShell terminal:

```powershell
cd 'C:\Users\KONZA-VDI\Desktop\morgan portfolio\api'
npm install
Copy-Item .env.example .env
```

Edit `api/.env` locally:

- `DATABASE_URL`: the Supabase **Session pooler** connection string from the project's **Connect → Session pooler** dialog. Use session mode (port `5432`) for the persistent Node API, and replace its password placeholder locally with the database password you set when creating the project. Do not use the Supabase project URL or publishable/secret API keys here. If your password has reserved URL characters, percent-encode them in the connection string.
- `DB_SSL=true`: keep enabled for Supabase.
- For a local certificate-chain error, set `DB_SSL_CA_PATH` to the path of the Supabase CA certificate. On the Render host, set `DB_SSL_CA` to the certificate text from Supabase **Database Settings → SSL Configuration**. Certificate verification remains enabled; do not disable it to work around TLS errors. See [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: used only by the API to create/manage the private document bucket and issue short-lived links for published files. Keep the service-role key in the API's `.env` and Render secret settings only; never put it in the client or Vercel.
- `SUPABASE_DOCUMENT_BUCKET=portfolio-documents` is optional. On first file use, the API creates this bucket as private with PDF/PNG/JPG and 10 MB limits.
- `ADMIN_EMAIL`: your admin sign-in email.
- `WEB_ORIGINS`: keep both local values for `localhost:3000` and `127.0.0.1:3000`.

Generate the administrator session secret:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Set the output as `SESSION_SECRET`, then generate an admin password hash without putting the password in source control:

```powershell
npm run admin:hash
```

Copy the generated hash to `ADMIN_PASSWORD_HASH` in `.env`. Create or update the database tables:

```powershell
npm run db:migrate
```

The migration creates the portfolio schema, private contact inbox with 90-day expiry, server-side alert-triage game tables and its 20 anonymized alerts, and three unpublished document drafts. It does not create leaderboard players or publish documents. It is safe to rerun: schema changes are additive, and seeded rows are inserted only when missing. `WEB_ORIGINS` is a required comma-separated exact-origin allow-list; set it to the local website origins during development and the exact Vercel HTTPS origin in production.

### 2. Start the API

Keep this terminal open:

```powershell
npm run dev
```

The API listens on port `3001` by default.

### 3. Start the website

Open another VS Code terminal:

```powershell
cd 'C:\Users\KONZA-VDI\Desktop\morgan portfolio\client'
npm install
npm run dev
```

Open `http://localhost:3000` (or `http://127.0.0.1:3000`). The Next.js rewrite proxies `/api/*` requests to the API on port 3001. The private dashboard is at `/admin`.

## Edit and publish content

- `src/data/profile.ts`: confirmed public profile, experience, projects, education, certifications, and services.
- `src/data/site.ts`: page descriptions, skills, navigation, and timeline entries.
- `src/components/PortfolioPage.tsx` and `src/components/HomeHero.tsx`: reusable page and landing-page UI.
- `src/app/globals.css`: responsive design, light/dark themes, and reduced-motion styling.
- `/admin`: add, edit, publish, unpublish, or delete projects and plain-text entries for experience, education, certifications, achievements, blog, gallery, services, write-ups, experiments, cheatsheets, CTF notes, assignments, and skills. Manage private contact messages, remove any leaderboard entry, and upload/edit/publish/delete documents. Published entries appear on the corresponding page; drafts remain private.
- `/documents`: public search and category filters for published documents. Only PDF, PNG, and JPG files up to 10 MB are accepted; the API inspects file contents, assigns random names, and keeps the Storage bucket private.
- `/triage` and `/leaderboard`: the server chooses five true-positive and five false-positive alerts, keeps answers out of the round-start response, and accepts a single-use token for up to ten minutes. Scores are calculated on the server and only nickname, score, and date are public.

Never enter secrets or sensitive personal details in a public content entry. Content is rendered as text, not HTML. The admin API validates inputs, restricts links to HTTPS where appropriate, requires a PostgreSQL session, same-origin checks, and a CSRF token.

The projects page also requests public repositories from the supplied GitHub profile without an API token. If GitHub or the database is unavailable, the confirmed featured project summaries remain visible.

## Quality checks

In `api`:

```powershell
npm test
```

In `client`:

```powershell
npm run lint
npm run build
npm audit --omit=dev
```

The production build is served with `npm start`. Use `npm run dev` for local development.

## Production deployment

Deploy the website and API as separate HTTPS services. The target setup is GitHub, Render, Vercel, and Supabase:

### 1. Create the GitHub repository

Create a new repository under your GitHub account. The project is split into `client/` and `api/`; when connecting a host, use the appropriate root directory. Keep it free of `.env` files and the old résumé PDF. The repository-level `.gitignore` excludes environment files and build output.

### 2. Create the Render API service

1. In Render, choose **New → Web Service**, connect the portfolio repository, and select the `api` root directory.
2. Select the Node runtime. Set **Build Command** to `npm install` and **Start Command** to `npm start`. The API listens on Render's assigned `PORT`.
3. In **Environment**, add the following variables. Enter secret values directly in Render; never send them in chat or commit them:

   - `NODE_ENV` = `production`
   - `DATABASE_URL` = the Supabase Session Pooler connection string
   - `DB_SSL` = `true`
   - `DB_SSL_CA` = the Supabase CA certificate text if the host requires it; leave `DB_SSL_CA_PATH` for local Windows development only
   - `TRUST_PROXY` = `true`
   - `ADMIN_EMAIL` = your admin email
   - `ADMIN_PASSWORD_HASH` = the bcrypt hash generated by `npm run admin:hash`
   - `SESSION_SECRET` = a new random value of at least 32 characters
   - `WEB_ORIGINS` = an exact origin such as `https://your-site.vercel.app` (no path or trailing slash). It can temporarily be `http://localhost:3000` until the Vercel URL is known.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` = server-only Supabase project settings needed for document storage. Do not add the service-role key to Vercel.
   - `SUPABASE_DOCUMENT_BUCKET` = `portfolio-documents` (optional; this is the default)

4. Deploy the service and copy its HTTPS URL. Check `https://<render-service>.onrender.com/health`. Free instances may sleep when idle; the first request can take longer while the API wakes.

### 3. Deploy the Next.js website to Vercel

1. In Vercel, choose **Add New → Project**, import the repository, and set **Root Directory** to `client`.
2. Leave the framework as **Next.js**. Use **Build Command** `npm run build`; leave the output directory at its Next.js default. Do not set `dist` or add a Vite-style SPA rewrite.
3. Add these Production environment variables:

   - `VITE_API_URL` = the Render HTTPS service origin, with no trailing slash
   - `NEXT_PUBLIC_SITE_URL` = the canonical Vercel HTTPS origin, with no trailing slash

4. Deploy and copy the exact Vercel HTTPS origin.

### 4. Finish the API origin allow-list

In Render, edit `WEB_ORIGINS` to the exact Vercel origin (for example, `https://your-site.vercel.app`), save, and redeploy/restart the API. If you add a custom domain later, add its exact HTTPS origin too. This allow-list is strict; do not use `*`.

### 5. Confirm the database and verify the site

The Supabase migrations were applied successfully during local setup. If setting up a different Supabase project, run `npm run db:migrate` from `api/` with that project's database connection configured. The migration is safe to rerun.

Check `/health`, the contact form and private admin inbox, `/triage` and its leaderboard, and `/documents`. Upload a sanitized document in `/admin`, then publish it only after confirming its contents. Draft documents remain private. Test admin login, logout, mobile layout, and page refreshes on the deployed site. The API's health endpoint is `/health` (not `/api/health`).

Keep `.env` files out of Git. Do not expose the Supabase database password, service-role key, administrator password hash, or session secret. Rotate credentials if they are ever exposed.

## Content accuracy and privacy

Skill levels are qualitative rather than fabricated percentages or years. In-progress networking training is not presented as a completed certification. Personal photography, coursework details, and certificate verification URLs have not been supplied, so their pages clearly leave space for those details instead of inventing them. The site records aggregate event counts without storing visitor identities or IP addresses. Contact messages are stored only after the visitor consents, are visible only in the authenticated admin inbox, and expire after 90 days. The SOC game stores only a chosen nickname, score, and timestamp; do not enter a real name or contact details as a nickname.

# Security Policy

## Scope

This policy covers the portfolio website at `https://morgan-portfolio-delta.vercel.app` and its
administration panel at `https://morgan-portfolio-delta.vercel.app/admin`.

**In scope:**

- The public site and all pages served from it
- The admin panel, its authentication and session handling
- The document and image upload pipeline
- Any API endpoints backing the site or the admin panel

**Out of scope:**

- Third-party services we do not control (hosting, CDN, DNS, email)
- Denial-of-service, volumetric, or resource-exhaustion testing
- Social engineering of the maintainer or any contributor
- Reports produced solely by an automated scanner with no working proof
  of concept and no demonstrated impact
- Missing security headers or cookie flags with no demonstrated exploit path

## Reporting a Vulnerability

**Do not open a public issue, pull request, or discussion for a security
vulnerability.**

Report privately, using either:

1. **GitHub Private Vulnerability Reporting** — the "Report a vulnerability"
   button under the repository's *Security* tab. This is preferred.
2. **Email** — `WESTMORGAN777@GMAIL.COM`. If you want an encrypted channel, ask and
   I will provide a PGP key.

Please include:

- A description of the issue and the component affected
- Reproduction steps, or a minimal proof of concept
- The impact you believe it has
- Your assessment of severity, if you have one
- How you would like to be credited, or if you prefer to remain anonymous

Do not include real user data, credentials, or destructive payloads. Use a
test account or your own data.

## What to Expect

| Stage | Target |
| --- | --- |
| Acknowledgement of your report | 3 business days |
| Initial assessment and severity triage | 10 business days |
| Status update while a fix is in progress | Every 14 days |
| Public disclosure | By mutual agreement, after a fix ships |

If a report is accepted, I will confirm the severity, ship a fix, and credit
you in the release notes unless you ask otherwise. If a report is declined
as out of scope or not reproducible, I will explain why. You are welcome to
disagree and provide further evidence.

This is a solo-maintained project, so these are best-effort targets rather
than contractual commitments.

## Safe Harbor

I will not pursue legal action or report you to law enforcement for security
research conducted in good faith under this policy, provided you:

- Do not access, modify, or exfiltrate data belonging to anyone but yourself
- Do not degrade service availability for other users
- Do not use a vulnerability for personal gain
- Report promptly and give reasonable time to remediate before disclosure

If you are unsure whether an action falls within this policy, ask first.

## Credentials and Repository Hygiene

- Secrets — API keys, database URLs, session secrets, admin passwords — are
  never committed to this repository. They live in environment variables or
  the platform's secret store.
- `.env` and equivalent files are gitignored. A committed `.env.example`
  documents required variables with placeholder values only.
- If you find a secret committed to this repository, report it privately
  using the process above. Do not open an issue quoting the value.
- Production credentials are rotated if exposure is suspected, whether or
  not the commit was public.

## Automated Agents and Admin Access

This project is maintained with the assistance of automated agents that may
hold admin-panel credentials for content management. The following rules
apply to that access:

- Agents authenticate interactively. Credentials are never written to logs,
  transcripts, commit messages, or status files.
- Every agent-driven change to the live site is preceded by a reviewable
  plan and is logged with the item affected and its resulting identifier.
- Uploads are validated before storage: file type checked by content, not
  only by extension; size limits enforced; filenames sanitized; SVG and
  other active content types rejected or sanitized.
- Uploaded documents are served from a path that does not execute as
  application code, and are not served with a content type that the browser
  will interpret as active.
- Agent access is scoped to content management. It does not extend to user
  data, billing, or account administration.
- Any finding that an agent's credentials, session, or upload path can be
  abused should be reported as a vulnerability under this policy.

## Supported Versions

The site is deployed continuously from the `main` branch. Only the currently
deployed revision is supported. There are no maintained release branches; if
you are running a fork or an older deployment, you are responsible for
applying fixes.

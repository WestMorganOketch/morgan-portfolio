# DESIGN READ — Public Portfolio

1. **What the design is trying to be:** An editorial, technically minded cybersecurity portfolio, using oversized typography, a restrained green accent, a command-style hero visual, and concise metadata.
2. **What it currently communicates:** A competent and polished custom build with a clear technical identity; the homepage still feels more like a neatly arranged portfolio template than a deliberately paced editorial experience because its supporting cards and section treatments are visually similar.
3. **Single biggest hierarchy problem:** The hero name and visual are distinctive, but the role label, summary, three CTAs, social links, and scene metadata compete for attention; below it, the snapshot, three feature cards, and closing CTA do not establish sufficiently different levels of emphasis.
4. **Single biggest motion problem:** The hero already contains a useful three-scene interaction with functional pagination and reduced-motion-aware scene transitions, but the surrounding global hover rules translate links and buttons and scale pressed controls; the signature should be the scene transition, not repeated movement on every control.
5. **Single biggest spacing problem:** The home page uses relatively compact, consistent vertical rhythm (hero padding of roughly 72–105px, snapshot padding of 55–85px, and feature-section padding of 83px at desktop); the main editorial section needs a much more generous “vast” treatment while factual snapshot content should remain intentionally tight.

## Code and component scope reviewed

- **App shell and global styles:** `client/src/app/layout.tsx`, `client/src/app/globals.css`, `client/src/index.css`.
- **Home page and hero:** `client/src/app/page.tsx`, `client/src/components/HomeHero.tsx`.
- **Navigation and Explore drawer:** `client/src/components/SiteShell.tsx`, `client/src/data/site.ts`.
- **Motion tokens:** `client/src/lib/motion.ts`.
- **Shared portfolio sections:** `client/src/components/PortfolioPage.tsx`.
- Existing stack includes Next.js App Router, React, Tailwind CSS, Framer Motion and Lucide icons. No new framework or animation library is indicated.
- Existing light/dark theme architecture, skip link, accessible command-palette dialog, drawer focus handling and reduced-motion rules should be retained.
- Existing hero pagination is functional because it changes between three labelled scenes; it should be kept and choreographed, not removed.
- The Explore drawer maps 17 entries from `publicPages.slice(5)` plus Privacy into one flat list; group these links without hiding them and keep search as the primary discovery path.

## Phase 0 baseline performance

- **Local Lighthouse run:** Not available from this environment. The repository could not be cloned into the local environment because outbound DNS/network access to GitHub is blocked.
- **LCP / INP / CLS / total transferred bytes:** Pending a reproducible browser audit; no values are fabricated.
- Next step for a reliable baseline: run Lighthouse against the exact pre-redesign build on desktop and throttled mobile before design implementation, save reports as `lighthouse-before.html`, and reuse the same conditions for `lighthouse-after.html`.

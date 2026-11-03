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

Measured by GitHub Actions on a clean runner against the **unchanged** `main` build, served locally with the production Next.js server. Mobile was simulated at 390 × 844 CSS pixels with Lighthouse's simulated throttling.

| Metric | Desktop | Mobile |
|---|---:|---:|
| Largest Contentful Paint (LCP) | 668 ms | 3,332 ms |
| Interaction to Next Paint (INP) | Not reported by Lighthouse lab | Not reported by Lighthouse lab |
| Cumulative Layout Shift (CLS) | 0.000 | 0.000 |
| Total transferred bytes | 308,080 bytes | 333,252 bytes |
| Lighthouse performance score | 100 | 92 |

- These are simulated **lab** baselines, not field Core Web Vitals. A Lighthouse lab trace does not reliably measure INP; a separate interaction test or field-data source is needed to assess that metric.
- Lighthouse results varied between two unchanged simulated runs: mobile LCP was 2,877 ms in the first run and 3,332 ms in the latest run (desktop LCP was 755 ms and 668 ms, respectively). Treat this as a measured baseline range rather than an exact guaranteed value.
- Across those runs, mobile LCP was 377–832 ms above the brief's 2.5-second target. Phase 1/2 must avoid adding render-blocking work and should recheck LCP after each major change.
- Latest GitHub Actions run and HTML/JSON artifact: [Public-site Lighthouse baseline](https://github.com/WestMorganOketch/morgan-portfolio/actions/runs/41601436026).
- The workflow copies reports to the exact filenames requested by the brief: `lighthouse-before.html` and `lighthouse-before-desktop.html`, plus their JSON companions. The same process can be reused for `lighthouse-after.html` after implementation.

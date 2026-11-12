# Majestic homepage upgrade notes

## Phase U1 — Hero card choreography and motion controller

Implemented on `feat/ui-majestic-home`.

- The hero card has three scenes: Overview, Services, and Skills.
- The Overview scene preserves the existing threat-monitoring content.
- Services uses the three existing entries in `client/src/data/profile.ts`; it does not add unconfirmed service claims.
- Skills uses the first nine skills in the existing ordered `skillGroups` data in `client/src/data/site.ts`.
- The card uses a fixed 430 px 3D stage, front/back faces, a 1,500 ms 360-degree spin, a glint, a restrained outer pointer tilt, and a 400 ms total crossfade path when 3D motion is unavailable or reduced motion is preferred.
- One Pause/Play control is backed by `useMotionPreference`; the preference is read and written to `localStorage` only in effects/callbacks and guarded for restricted storage.
- The card pauses its automatic cycle on hover, focus, when the document is hidden, and when the visitor chooses Pause. The tabs support arrow keys, Home, and End.
- The selected face is the only face exposed to assistive technology; the opposite face is inert and hidden from the accessibility tree.

### Constants to tune

- `HERO_TIMING` in `client/src/components/HomeHero.tsx`: first spin, overview dwell, service-line interval/buffer, skills dwell, swirl duration, crossfade duration, skill stagger, and chip float duration.
- `--skills-accent` / `--skills-accent-soft` rules in `client/src/app/globals.css`: the second accent for light and dark themes.
- `--chip-float-ms` on the floating-chip rule in `client/src/app/globals.css`: chip float cycle.

### Manual QA checklist

- [ ] Test Overview → Services → Skills → Overview on desktop and mobile.
- [ ] Confirm text is never mirrored during the 3D turn.
- [ ] Confirm manual tabs work with mouse, Tab, arrow keys, Home, and End.
- [ ] Confirm Pause/Play persists across refresh and remains usable if localStorage is blocked.
- [ ] Confirm reduced-motion mode disables auto-advance and 3D rotation but allows manual crossfades.
- [ ] Confirm theme toggle keeps skill-panel text legible in both themes.
- [ ] Confirm hidden-tab and hover/focus states stop the next automatic transition.
- [ ] Run `npm run lint`, `npm run typecheck`, and `npm run build` in `client/`.

## Phase U2 — Falling snow layer

Implemented on the same feature branch.

- Added `client/src/components/SnowLayer.tsx`, a hero-only canvas with one requestAnimationFrame loop, a capped delta time, three pre-rendered sprite canvases, ResizeObserver, IntersectionObserver, document-visibility handling, and full cleanup.
- The layer is mounted after the initial paint using a lazy client import; it does not delay hero copy or CTA rendering.
- Density is derived from hero area, capped at 70 desktop flakes, reduced on mobile and lower-core devices, and disabled for Save-Data.
- Theme changes rebuild the three sprites from `--snow-color`; `--snow-opacity` controls intensity. During card spins, the canvas uses a subtle speed/wind gust.
- The shared Pause/Play preference stops the loop and draws a static frame. Reduced motion draws a sparse static set and never starts the loop.
- The canvas is decorative, masked to dissolve near the hero's bottom, and never receives pointer events.

### U2 constants to tune

- `SNOW_CONFIG` in `client/src/components/SnowLayer.tsx`: density, mobile/core reductions, DPR, flake size/speed/opacity/drift, spin gust, and reduced-motion count.
- `--snow-color` and `--snow-opacity` in `client/src/app/globals.css`: per-theme color and intensity.
- `SNOW_SCOPE` is fixed to `"hero"`; do not reuse this layer across the rest of the site.

### U2 manual QA

- [ ] Confirm snow appears only inside the hero and dissolves before the next section.
- [ ] Confirm the Pause/Play button stops and resumes the canvas without restarting its positions.
- [ ] Confirm the canvas stops when scrolled offscreen or the tab is hidden and resumes with one loop.
- [ ] Toggle light/dark themes and verify flakes remain quiet but visible.
- [ ] Emulate Save-Data, a narrow viewport, and a low-core device.
- [ ] Enable reduced motion and confirm a sparse static scene only.
- [ ] Navigate away and back; confirm observers and animation frames are cleaned up.

## Remaining phases

- U2: replace the previous CSS-only snow treatment with a lazy client canvas layer controlled by the same motion preference.
- U3: add permanent Services and Skills sections below the hero. The specification's six-card service copy is explicitly a draft requiring owner approval; do not publish that draft without confirmation.
- U4: responsive/theme/accessibility/performance QA, contrast measurements, and final notes.

## Landing-page badges

- Edit the specialization and framework drafts in `client/src/data/badges.ts`; each draft is marked `OWNER TO CONFIRM`. Keep each `meaning` at 110 characters or fewer.
- Use `studying` unless there is a real, published project, write-up, or document on this site that demonstrates the claim. `applied` entries must include both an `evidenceHref` and an `evidenceLabel`; do not add an endorsement, certification, or compliance claim.
- Credentials are loaded from published documents in the `Certificates` category. Do not add credential placeholders or manually duplicate certificates in the draft list. The issued date and Verify link are taken from the published document; Verify is omitted when no verification URL exists.
- The owner must confirm the wording and status of all six specializations: Security Monitoring and Alert Triage; Network and VPN Security; Secure Web Development; IT Support and Infrastructure; Data Analytics and Reporting; Security Documentation and Awareness.
- The owner must confirm the wording and studying status of all six framework topics: MITRE ATT&CK; NIST Cybersecurity Framework; OWASP Top 10; CIS Critical Security Controls; Cyber Kill Chain; ISO/IEC 27001 (awareness).
- The owner must verify that the two applied project links support their respective claims before launch. The framework disclaimer is required and must remain visible.

 
## U5 — Live CLI terminal in the hero card

The live CLI chapter replaces the former Overview / Services / Skills card content; the fixed 3D stage, front/back faces, traffic-dot header, “THREAT MONITORING” label, ACTIVE status, floating chips, Pause/Play control, and snow layer stay in place. The 3D swirl is only used when changing the four chapters: Identity → Pentesting → Web → Skills → Identity. Individual service panels advance inside a chapter without a swirl.

### Editing the service catalogue

- Single source of truth: `client/src/content/terminal.ts`. The public Services cards in `client/src/data/profile.ts` are mapped from `PORTFOLIO_SERVICES` in that file. Keep the existing card order and copy aligned there.
- Each `TERMINAL_SERVICES` entry must keep `id`, `area`, `command`, 2–4 illustrative output lines, `title`, `summary` (90 characters max), and optional `proof`. Each entry is marked `// OWNER TO CONFIRM`; review and approve wording before treating it as an offer.
- Commands and outputs are display-only strings. They are never executed, evaluated, or sent over the network. Keep any targets inside `lab.example.test`, `*.example.test`, `example.com`, the documentation ranges `192.0.2.x`, `198.51.100.x`, `203.0.113.x`, or `127.0.0.1`. Do not include credentials, flags, hashes, exploit payloads or real targets. Keep the `# authorised targets only` footer comment in the content/engine source.
- Proof links must be real, obvious public-repository matches and use HTTPS. Do not add a GitHub link merely because a project name resembles a service; an absent proof link is preferable to an unsupported claim.
- Review candidate mappings in `docs/ui-upgrade/TERMINAL_SERVICES_REVIEW.md` before adding further proof links.

### Editing timing and presentation

- Edit the top-level `TERMINAL_TIMING` object in `client/src/lib/terminalEngine.ts`: `typingMsPerCharacter` = 32, `typingJitter` = 0.4 (±40%), `outputLineMs` = 220, `spinnerMs` = 900, `servicePanelMs` = 3000, `commandPauseMs` = 450, `chapterOutroMs` = 1200, `identityDwellMs` = 4500, and `scanlineMs` = 8000. There is one requestAnimationFrame scheduler; do not introduce independent per-row intervals.
- The development-only speed multiplier is `?tspeed=8`; it is ignored when `NODE_ENV === "production"`.
- Chapter colors are scoped to `.live-terminal[data-chapter]` in `client/src/app/globals.css`: green for identity/pentesting, teal for web, amber for skills. The display uses the site's existing `--mono`, `--body-text`, `--muted`, `--surface-raised`, and `--border` theme tokens.
- Run `npm run build` and then `npm run verify:terminal` from `client/`. The verification script requires the production-build marker, checks content length/target/proof constraints, and checks the engine and cleanup/interaction safeguards. CI runs it after the production build.

### Terminal text contrast

WCAG contrast ratios below were calculated from solid foreground/background token colors; gradients and the decorative scanline are not counted as text backgrounds. All shown text/accent pairs exceed 4.5:1.

| Theme | Text token | Background | Contrast |
|---|---|---|---:|
| Dark | Body `#eef1e8` | Raised surface `#121b18` | 15.37:1 |
| Dark | Muted `#a1afa5` | Raised surface `#121b18` | 7.69:1 |
| Dark | Green `#a7f36c` | Raised surface `#121b18` | 13.11:1 |
| Dark | Web teal `#60d6c4` | Raised surface `#121b18` | 9.96:1 |
| Dark | Skills amber `#f7c36c` | Raised surface `#121b18` | 10.85:1 |
| Dark | Success `#8be0ae` | Raised surface `#121b18` | 10.63:1 |
| Light | Body `#19251c` | Raised surface `#fffef9` | 15.72:1 |
| Light | Muted `#58665b` | Raised surface `#fffef9` | 6.00:1 |
| Light | Green `#31772c` | Raised surface `#fffef9` | 5.46:1 |
| Light | Web teal `#176c64` | Raised surface `#fffef9` | 6.18:1 |
| Light | Skills amber `#8a5a00` | Raised surface `#fffef9` | 5.87:1 |
| Light | Success `#176c64` | Raised surface `#fffef9` | 6.18:1 |

### Verification record

- The repository includes `client/scripts/verify-terminal.mjs`; it is wired into the CI quality job directly after `npm run build`.
- Lint, typecheck, the production build, `verify:terminal`, API tests, CodeQL, interaction replay, DOM-row counts during a live session, screenshot comparison, and viewport/theme checks must be recorded from actual CI/browser output before this checklist can be marked complete.
- Browser-only visual checks at 360, 390, 768, and 1280 px in light/dark themes, proof-link tapping, reduced-motion mode, hidden-tab/off-screen pause, and no-console/hydration checks remain manual/automated-preview gates; do not describe them as passed until observed.
- Local shell actions `git status`, `git branch --show-current`, and `git pull --rebase --autostash origin feat/hero-terminal-live` could not run in the remote editing environment because no local checkout was mounted and shell DNS did not resolve GitHub. Edits were made directly to the existing `feat/hero-terminal-live` branch through the connected GitHub repository API; no main-branch edits, force-pushes, new dependencies, runtime GitHub calls, or token use were introduced by the hero card.
- The required one-shot unauthenticated developer-machine request to `https://api.github.com/users/WestMorganOketch/repos?per_page=100&sort=updated` could not execute here for the same local-shell restriction. The review table was assembled through the connected read-only repository listing and public per-repository metadata instead; this is a documented deviation, not a claim that the requested direct request ran.

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

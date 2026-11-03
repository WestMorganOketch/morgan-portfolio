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

## Remaining phases

- U2: replace the previous CSS-only snow treatment with a lazy client canvas layer controlled by the same motion preference.
- U3: add permanent Services and Skills sections below the hero. The specification's six-card service copy is explicitly a draft requiring owner approval; do not publish that draft without confirmation.
- U4: responsive/theme/accessibility/performance QA, contrast measurements, and final notes.

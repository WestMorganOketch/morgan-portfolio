# HOME_UPGRADE_SPEC.md - Majestic, interactive landing page (public site only)

## 0. RULES FOR EVERY PHASE
- Branch feat/ui-majestic-home (create from main if missing); never commit to main. Run git status first; preserve .vscode/, the nested morgan-protfolio/ and uncommitted work. Read AGENTS.md and the installed Next.js docs for whatever you use (client components, dynamic imports) before coding.
- SCOPE: the public landing page only (hero, hero card, background snow, new Services and Skills sections, shared motion and polish tokens). DO NOT TOUCH: /admin, the Career review centre, api/, authentication, analytics logic, database, environment variables, deployment settings.
- Keep the existing design language (monospace eyebrow labels, large tight headings, brand green, light/dark theme toggle, nav, CTAs, social links). This is an elevation, not a redesign. Keep every existing CTA, link and piece of content.
- DEPENDENCIES: reuse framer-motion and the existing icon library. No new animation or particle libraries (no tsparticles, gsap, three, lottie). Add none unless unavoidable, with a one-line justification.
- CONTENT: never invent skills, services, claims, ratings or numbers. Use existing site data first (services/skills data or CMS entries). The default service copy in section 3 is a draft the owner must confirm. If no skills data exists, STOP and ask.
- PERFORMANCE: animate only transform and opacity; no layout-shifting animation; no cumulative layout shift (reserve fixed space for every scene); the hero text and CTAs must render immediately (do not delay LCP); load the snow after first paint via a lazy client component; added JavaScript at most about 20 KB gzip excluding framer-motion.
- ACCESSIBILITY: WCAG 2.2 AA. One visible Pause/Play control governs ALL auto-moving elements (card cycle, snow, floating chips). Decorative layers are aria-hidden with pointer-events none. Respect prefers-reduced-motion. Keyboard access and visible focus for every control. Text contrast at least 4.5:1 in light AND dark themes. Information must never exist only inside an animation: the Services and Skills sections are the accessible source of truth.
- CONFIG: all timings, counts and colors live in clearly named constants at the top of their files (HERO_TIMING, SNOW_CONFIG, theme tokens) so the owner can tune them.
- DELIVERY per phase: run lint, typecheck and build once; fix only what you broke; commit "feat(ui): <phase name>"; push the feature branch only; update docs/ui-upgrade/NOTES.md (what changed, constants to tune). REPORT max 8 lines: files changed, what to look at in the Vercel preview, results of lint/typecheck/build ACTUALLY run, unverified items.
- TOKEN THRIFT: inspect only the files you must touch; no repo-wide rereads; reuse existing components and tokens.

## 1. PHASE U1 - Hero card choreography and motion controller
FIRST INSPECT (read-only): the hero component and the terminal-style card on the right (header "THREAT MONITORING" with an ACTIVE status, heading "Signals into context.", a terminal block with a prompt line and two lines, three meta rows ALERT REVIEW / APPROACH / FOCUS, the floating chips "Systems-minded" and "Curious by nature", and the three pager dashes below it). Note whether a slider already exists and reuse or replace it cleanly. Find how the theme (light/dark) is applied and how the existing skills and services data is loaded.

SCENES (all inside one fixed-size card; the card height is the tallest scene so nothing shifts):
- S0 IDENTITY: exactly today's content.
- S1 SERVICES (brand green accent): eyebrow "SERVICES", heading "What I can help with.", a terminal-style list of up to 5 service names (from section 3). One line is active at a time (caret, brighter text, soft glow) and advances every SERVICE_LINE_MS = 1800.
- S2 SKILLS (second accent, see tokens): eyebrow "SKILLS", heading "What I work with.", up to 9 skill chips from the real skills data (the top ones as ordered in the data) revealed in a stagger of 80 ms, then a calm held state. Use a distinct accent so it reads as different from the green scenes (a warm amber is suggested; verify contrast in both themes).
ORDER AND TIMING (HERO_TIMING, ms): first spin at 6000 after load; S0 dwell 4000 on later loops; SWIRL_MS = 1500; S1 dwell = lines x SERVICE_LINE_MS + 600; S2 dwell 7000. Loop S0 -> S1 -> S2 -> S0. The cycle never starts a spin while the card is hovered, focused or the tab is hidden, and it resumes from the same scene.

THE SWIRL (true 360 degrees, text never mirrored):
- Structure: outer wrapper (pointer tilt only) > perspective container (perspective 1200px; NO overflow hidden, contain, filter or will-change on any ancestor of the 3D element) > spinner with transform-style: preserve-3d > two faces, FRONT (0 degrees) and BACK (pre-rotated 180 degrees), both absolutely positioned with backface-visibility hidden (include the -webkit- prefix for iOS Safari). Clip rounded corners and shadows on the faces, not on ancestors.
- Animation (framer-motion, imperative controls or keyframes), over SWIRL_MS with cubic-bezier(0.65, 0, 0.35, 1): rotateY 0 -> 360; with it a gentle rotateX 0 -> -5 -> 0, scale 1 -> 0.965 -> 1, rotateZ 0 -> 1.2 -> 0 (peak at mid-turn), plus a soft light glint (gradient overlay) sweeping across the face at mid-turn and a subtle shadow lift. Elegant and restrained; no bounce.
- Content logic (important): before a spin set BACK = next scene. While BACK is the visible face (between about 90 and 270 degrees) set FRONT = next scene, so after the full turn FRONT shows the next scene. When the spin ends set BACK = the scene after next. The viewer therefore sees: current scene, then the new scene during the whole second half of the turn, ending with it facing front. Never swap a visible face.
- Pointer tilt (outer wrapper only): at most 4 degrees following the pointer on devices with a fine pointer; disabled during a spin and for reduced motion.
- Floating chips: slow transform-only float (about 4 px, 6 s loops), paused by the global control.
- If 3D transforms are unsupported, fall back to a 400 ms crossfade between scenes.

CONTROLS (single mechanism for everything that moves):
- Turn the three pager dashes into a real tablist (Overview, Services, Skills) with accessible names, aria-selected and arrow-key support. The active dash fills (scaleX) over that scene's dwell time. Selecting a tab goes to that scene using the swirl when motion is on, or a crossfade otherwise.
- Add a small visible Pause/Play button beside the dashes (first focusable element of the widget, accessible name "Pause animations" / "Play animations") that pauses the card cycle, the snow and the floating chips together. Store the choice in localStorage ("motion": "auto" | "paused") inside try/catch; never read storage during server rendering (avoids hydration mismatch). Expose it through one tiny shared context/store (useMotionPreference) that Phase U2 also uses.
- Pause automatically on hover and focus-within of the card; resume on leave.
- Accessibility: the card region has an accessible label; aria-live="off" while auto-advancing and "polite" after a manual tab choice; the non-visible face is aria-hidden.
- prefers-reduced-motion: no spin, no auto-advance; scenes change by 400 ms crossfade only when the user picks a tab.

## 2. PHASE U2 - Falling snow layer
Create a client-only SnowLayer used in the hero section only (a constant SNOW_SCOPE = "hero"), loaded lazily after first paint.
- A single absolutely positioned canvas (inset 0, pointer-events none, aria-hidden, z-index below all content) with a CSS mask that fades the flakes out near the bottom of the hero so they dissolve before the next section.
- ONE requestAnimationFrame loop; delta time clamped to 50 ms; ResizeObserver; device pixel ratio capped at 2; IntersectionObserver (threshold 0.05) starts and stops the loop; stop on document.hidden and resume from the same state without a second loop; remove everything in the cleanup function; no per-frame allocations.
- Flakes: count = clamp(area / 22000, 24, 70) on desktop, halved at widths up to 768 px; halved again when navigator.hardwareConcurrency <= 4; disabled when the Save-Data hint is on. Three depth layers: size 1 to 3 px, fall speed 14 to 42 px/s (deeper layers smaller, slower, fainter), opacity 0.12 to 0.38 (never above 0.4), horizontal sine drift amplitude 8 to 22 px with random phase. Pre-render 3 soft sprites to offscreen canvases and use drawImage (no gradients or shadows per frame). Recycle a flake at the top once it leaves the bottom.
- Randomness only inside useEffect (never in the render path), so there is no hydration mismatch.
- Theme: tokens --snow-color and --snow-opacity per theme (light theme: a soft sage-teal flake that is visible but quiet on the pale background; dark theme: near-white ice). Re-read the tokens when the theme toggles. Verify visibility and contrast against both hero backgrounds.
- Gust: when the card spins (shared store flag), ease the fall speed up to 1.35 times and add a slight sideways wind for the spin duration, then ease back. Subtle.
- Motion preference: when paused, draw one static frame and stop; for reduced motion draw a sparse static scatter (about 18 flakes at low opacity) once with no animation.
- Never intercept pointer events; never affect text readability or the Lighthouse LCP element.

## 3. PHASE U3 - Services and Skills on the landing page
Place two new sections directly below the hero, before the existing "Learning by doing" section. Add anchors #services and #skills (scroll-margin-top for the sticky nav) and small "Services" and "Skills" quick links in the hero near the CTAs, styled like the existing link row.
SERVICES section: eyebrow "SERVICES", heading "What I can help with.", one-line intro. A responsive grid (3 columns desktop, 2 tablet, 1 mobile) of 6 cards: icon in a 40 px tinted square, title, 1 to 2 lines (110 characters max). Where a real project exists, add a small evidence link ("See: Secure VPN Deployment") to that project. Hover: lift 2 px, border brightens, soft shadow; visible focus ring; scroll reveal fade-up 12 px staggered once. Use the same service names and wording as the hero card scene S1.
Data: if the site already stores published "services" entries or a services data file, use it; otherwise create one typed constant file (for example content/landing.ts) with this DRAFT (mark each with // OWNER TO CONFIRM):
  1. Security monitoring and alert triage - Reviewing alerts, separating signal from noise and writing up what I find.
  2. Secure network and VPN deployment - Designing and setting up secure remote access. (evidence: the Secure VPN Deployment project)
  3. Secure web application development - Authentication flows, JWT handling and REST API security hardening with React and Node.js. (evidence: the Secure Web Application Development project)
  4. IT support and troubleshooting - Diagnosing, fixing and documenting problems so people and systems stay up.
  5. Data analysis and reporting - Turning raw data into clear dashboards and insights.
  6. Security documentation and awareness - Clear incident notes, guides and checklists that non-experts can follow.
SKILLS section: eyebrow "SKILLS", heading "Skills at a glance.", filter tabs generated from the categories already in the skills data (plus "All"), chips with a small category dot in the section's second accent, a "currently learning" marker only where the data already says so, and a "See all skills" link to the existing Skills page. NO percentage bars, star ratings or proficiency numbers. Stagger reveal on filter change; keyboard-operable tabs with aria-selected; respects reduced motion.

## 4. PHASE U4 - Polish, performance and QA
- Consistent section rhythm and spacing; a refined sticky nav (blur and border on scroll, no layout shift); button micro-interactions (1 to 2 px arrow nudge, press feedback); a skip-to-content link; smooth anchor scrolling guarded by reduced motion; a faint cursor-following spotlight in the hero (low-opacity radial gradient, throttled, off for coarse pointers and reduced motion); a thin scroll-progress line under the nav. Keep everything restrained.
- Verify at 360, 390, 768, 1024 and 1440 px, in light and dark themes: no horizontal scroll, the card scales down cleanly under the text on mobile, 3D works on iOS Safari (webkit prefixes, no overflow hidden ancestors), no text mirroring at any angle, long words never overflow.
- Check: CLS below 0.1, no console errors, no hydration warnings, canvas and animations fully cleaned up on route change, the snow stops off-screen and in background tabs, Pause/Play works for card, snow and chips together, the tab order is logical, and contrast is at least 4.5:1 for both accents in both themes (put the computed ratios in NOTES.md).
- Write docs/ui-upgrade/NOTES.md: how to change timings, snow density, colors and service copy; a manual QA checklist for the owner.
- Do not touch /admin or any API code. Do not claim Lighthouse scores you did not measure.

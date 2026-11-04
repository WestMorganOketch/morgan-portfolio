# Job Radar UI readability notes

## Root cause and changes

The legacy `.admin-panel` rule in `client/src/index.css` applied a fixed translucent dark fill, while the Career centre mixed that fill with light-theme page and text tokens. Several admin buttons and messages also used dark-only colors. The Career workspace now has its own explicit light and dark role tokens in `client/src/app/globals.css`; the private dashboard and other admin views are unchanged.

The Career tabs now read Today, Review, Add a job, Pipeline, My resume, Preferences, and Sources & setup in workflow order. The page has a single Job Radar heading and purpose statement, accessible count wording, clearer status language, useful empty-state actions, consistent controls, and responsive tab scrolling. Internal tab keys and existing actions are unchanged.

## Computed contrast ratios

Ratios were calculated from the sRGB token hex values using WCAG relative luminance. Text pairs are measured against their listed surfaces; border/focus pairs are measured against adjacent surfaces. Required minima are 4.5:1 for text and 3:1 for UI boundaries and focus indicators.

| Theme | Text / page | Text / raised | Muted / page (minimum across surfaces) | Accent / raised (minimum) | Primary text / button | Border / surface (minimum) | Focus / surface (minimum) | Status text / status background (minimum) | Status border / raised (minimum) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Dark | 16.68:1 | 13.39:1 | 7.90:1 | 11.42:1 | 13.52:1 | 3.69:1 | 9.41:1 | 8.76:1 | 4.14:1 |
| Light | 14.48:1 | 15.88:1 | 5.86:1 | 6.75:1 | 7.93:1 | 4.05:1 | 6.12:1 | 6.53:1 | 3.97:1 |

The minimum status-border contrast against its own status background is 4.33:1 in dark mode and 3.52:1 in light mode. All measured text, borders, and focus colors exceed their respective minimums.

## Scope and verification

The UI changes are limited to the client-side Career page and its scoped styles. No API, authentication, database, assessment, sending, approval, or other career behavior was changed. A Vercel visual check remains unverified because admin login does not work on preview addresses; verify both themes and the 360, 768, 1024, and 1440 px layouts after merge.

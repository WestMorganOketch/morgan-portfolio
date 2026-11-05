# Public résumé page

## Editing résumé content

Edit [`client/src/data/resume.ts`](../../client/src/data/resume.ts). Keep the submitted wording and dates accurate, leave `showPhone` set to `false`, and update `updatedAt` manually when the résumé changes. Contact information and profile links are sourced from `client/src/data/profile.ts`; do not copy private phone or address data into the résumé.

The public page and ATS PDF both render this same typed content file. The PDF is generated during the Next.js build and served as a statically generated `/resume.pdf` route. `pdf-lib` is the only new runtime dependency: it creates a selectable-text PDF using built-in Helvetica fonts without a browser or external PDF service. `pdfjs-dist` is a development-only dependency used by the production acceptance verifier to extract PDF text.

To change the downloaded PDF filename, update both the `download` attribute in `client/src/app/resume/ResumeToolbar.tsx` and the `Content-Disposition` header in `client/src/app/resume.pdf/route.ts`, then update `client/scripts/verify-resume.mjs`.

Run `npm run build`, then `npm run verify:resume` from `client/` to verify the production routes, PDF metadata, page count, text order, normalization, and—when Edge is installed—the print stylesheet.

## Manual QA checklist

- [ ] Visit `/resume` in light and dark themes; confirm the paper remains white, text is readable, and the page has no horizontal scroll at 390 px and desktop widths.
- [ ] Tab through controls and content; confirm visible focus and order Back, Download PDF, Print, then résumé content.
- [ ] Test Back with a same-site referrer and from a direct/new-tab visit.
- [ ] Download the PDF with JavaScript disabled and confirm its filename.
- [ ] Print to PDF and confirm only the paper content appears, at most two A4 pages, with no stranded section headings.
- [ ] Confirm email, LinkedIn, GitHub, and project links resolve to the configured addresses.
- [ ] Re-run `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run verify:resume` after content or layout changes.

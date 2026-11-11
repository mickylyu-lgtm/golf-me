# Handicap presentation verification

## Scope

This is presentation-only polish on top of main 32b39ce. The stored handicap, band boundaries, reputation, matching and verification are unchanged. Lower handicaps receive more decoration without making higher handicaps less legible. Shared labels display negative stored values with standard plus notation.

## Checks

- Full npm run check: TypeScript, lint (26 existing warnings, no errors), 1,378 tests, Vite build and prerender passed.
- 39 presentation regressions cover boundaries, precision, plus notation, null/non-finite input, both appearances, contrast and shared call sites.
- Three existing Compare regressions still enforce all eight remaining rows and no Credibility row. Its AST reader now accepts exactly t("profile.handicap") for the localized heading.
- Independent review found no actionable app issue and independently passed all 42 focused tests.
- Built-app synthetic browser script scripts/check-handicap-presentation.mjs passed 1,284 assertions across 320, 390 and 1440px, in both light and dark appearances.
- Browser coverage: own profile, seven public-profile fixtures, all six card tones, Compare both sides, plus and decimal formatting, unknown handicap, computed ink/frame/fill, no fading or animation, close with Escape, no horizontal label/page overflow, no runtime errors and no modification of the stored handicap through rendering.
- Representative own-profile, Compare and card screenshots were visually inspected.

## Reproduce

Run npm run check, then node scripts/check-handicap-presentation.mjs against the built app. The script uses a localhost Vite preview and fresh synthetic demo browser contexts, aborting all external requests. Set CHROMIUM_PATH for a different installed browser, QA_OUTPUT_DIR for a different output directory, and LD_LIBRARY_PATH if the browser installation requires it. MGPC uses its installed Playwright headless shell and local compatibility libraries.

QA results and screenshots default to /tmp/golfme-handicap-qa-20261111. These are synthetic demo golfers, not customer records. The browser script never signs in to a real account and performs no backend writes.

## Limits and release

Physical iPhone, native app and real-account checks were not performed. This patch does not change native or backend code. Review and current-main verification must remain green before the authorized push; verify the exact SHA in CI and the production alias afterward.

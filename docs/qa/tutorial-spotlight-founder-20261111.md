# Tutorial spotlight and founder-only replay

## Scope and behavior

Based on main `72e3d3c9de2b31c4c2391fdc09fe99c8f166c666`. The existing Settings replay button and its start callback were available to every real/demo account. Manual replay now uses the established founder ID from the authenticated user, with a guard in both the UI and replay action. It does not use a mutable email, displayed profile, metadata or a broad admin role. This is a client-side owner UI tool, not a new backend privilege. No new access is granted.

The automatic first-time walkthrough remains available to every new real account. Manual replay is separate from the automatic start. Account changes hide/reset active and completed state; callbacks from the previous account are rejected. Browser tests caught and fixed a late Home auto-start racing Skip, and an initial StrictMode reset cancelling automatic onboarding. Completion is marked synchronously; identity resets do not run again on initial effect replay.

The overlay keeps one cutout node and interpolates its transform/size between targets with a 350 ms ease-out. Target movement is measured at frame cadence during route/layout settling, instead of jumping at 80/320 ms. Lazy DOM insertion, target resizing, window resizing and scrolling remeasure without repeated scrolling. Initial offscreen acquisition scrolls once with explicit instant behavior, preventing global CSS smooth-scroll races. Missing targets use the full scrim; cleanup cancels frame callbacks, listeners and observers. Reduced motion disables cutout, scrim and card transitions.

No database migration, backend/Edge Function, native shell, credentials, stored tutorial reset, tutorial wording, or ordinary user setting change.

## Verification

- Full `npm run check`: TypeScript, lint (28 baseline warnings / 0 errors), all 1,441 tests with no failures/skips, production build and prerender passed on final source.
- `tests/tutorialAccess.test.ts`: founder vs ordinary/admin-like/demo/unauthenticated IDs, target geometry noise, UI/action guard wiring and reduced-motion/cleanup contracts. Included in `test:onboarding` and the full suite.
- `scripts/check-tutorial-spotlight-ui.mjs`: 77 Chromium assertions passed at 320x568, 390x844 and 1440x900. Covers real production tutorial provider/overlay/Settings with synthetic authenticated subjects and demo-backed surroundings: denied direct calls, founder replay, every target, intermediate movement rather than snaps, stable cutout identity, asynchronous target resizing, rapid Back/Next/Skip, finish, account switching, reduced motion, automatic Home onboarding, late target arrival after 1.75 seconds and cleanup. Zero page errors. External requests blocked.
- `scripts/check-follow-approval-tutorial-ui.mjs`: all six locales at five viewport/text-scale cases, including 320px, landscape and 150%/200% type, with contained scrolling and no settings mutation. Uses the same local-only synthetic founder plugin because normal demo accounts intentionally no longer have replay access.
- Test-only auth plugin is imported only by local browser scripts, not `vite.config` or application code. Production assets contain no `__tutorialTest` hooks.
- Source review found no actionable blocker; screenshots at 320/390/1440 were inspected. At 200% type the existing background page can be wider than the viewport, while the tutorial explanation and its controls remain contained; no new background-layout change is included.

## Local reproduction

Set `CHROMIUM_EXECUTABLE` to an installed Chromium headless shell; optionally set `CHROMIUM_LIB_DIR` for its private shared-library directory. From this checkout run:

1. `npm run check`
2. `node scripts/check-tutorial-spotlight-ui.mjs`
3. `node scripts/check-follow-approval-tutorial-ui.mjs`

The scripts run localhost Vite fixtures, use synthetic auth only for the tutorial module, and abort external browser requests. No real account, customer media, production database write, or paid provider call is used. Generated screenshots remain in ignored `artifacts.local/`.

## Release / limits

User authorized pushing when fixes are ready. Remote main and live production alias were checked at the base above before publishing. After push, verify exact-commit GitHub CI and `golfme.app` deployment/served assets.

Physical iPhone/WebKit motion and real-account authentication/profile persistence are not validated by these synthetic Chromium checks. Existing keyboard focus trapping/history behavior of the tutorial is unchanged.

# Round-completion haptic reliability

## Scope

The round-complete card already requested the shared native success haptic. Feedback now belongs to the confirmed, once-per-round event rather than mounting the card. The existing notification pattern, web no-op, OS behavior, localized visual status and reduced-motion treatment are unchanged. No native plugin, database, auth, scoring or schema changes.

- A host completion updates only an open/full round belonging to that host and requires the matching returned completed row. A no-row update is not success. Failed requests propagate to the existing warning.
- Explicit completion and fetched completed status share one gate, scoped by account and round. StrictMode, realtime echoes, repeat calls, dismiss/reopen and blocked storage do not replay feedback. A bounded session fallback supplements local storage.
- Callbacks for a departed route/account or unmounted page cannot request feedback. The completion button also has a synchronous in-flight lock.
- Group members retain the existing once-per-recent-round celebration behavior, including first opening a newly completed round. Old historical rounds and nonmembers stay silent. Demo simulation uses the same feedback gate.
- Feedback is supplemental: the existing localized polite status remains and reduced motion still removes the animation. Nothing vibrates in ordinary browsers.

## Verification

- Five new tests exercise the real installed Supabase SDK with a fake fetch: exact PATCH/host/status filters and returned-row selection, zero rows, malformed/unrelated rows, errors and delayed response. No network or database writes.
- Existing haptic driver tests cover native success mapping, browser no-op, throttling and plugin rejection. Existing round-celebration policy/physics tests pass.
- Full npm run check on base ca96e208: TypeScript, 1,474 tests (zero failed/skipped), production build and prerender pass. Final lint: 28 existing warnings, zero errors.
- scripts/check-round-haptic-ui.mjs runs the real hook and real celebration card under React StrictMode using a local Vite fixture. Chromium and WebKit each pass 62 assertions across regular/reduced motion and available/blocked celebration storage. Includes same-tick duplication, realtime echo, remount, account/route switching, stale callbacks, unmount, nonmember, cancellation, historical completion and polite visual status. All external browser requests are blocked.
- Independent read-only source review found no actionable issues; git diff --check passes.

## Reproduce

Run npm run check, then node scripts/check-round-haptic-ui.mjs with installed Playwright Chromium. Set HAPTIC_TEST_ENGINE=webkit and optionally WEBKIT_EXECUTABLE for WebKit. Local fixtures are not imported by the production app.

## Limits

These are synthetic tests, not physical iPhone/Capacitor verification. Actual vibration feel, device haptic settings and production authenticated completion were not exercised. No real rounds were completed during QA. The existing Supabase migrations allow authenticated reads of host completion rows; live policy writes/changes were not needed.

## Release

Integrated onto verified auto-match main 23d60434. Only DEVELOPMENT_STATUS.md conflicted; both entries were retained and the reviewed implementation/test patch is unchanged. Final integrated npm run check passed TypeScript, all 1,483 tests (zero failed/skipped), lint (28 baseline warnings, zero errors), build and prerender. Both browser engines again passed all 62 assertions. Next: normal fast-forward push and exact-commit CI/production verification.

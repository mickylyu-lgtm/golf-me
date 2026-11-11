# Admin registered-user search and collapse

Local-only change on feat/admin-user-search-20261111, based on f5d3329.

## Behavior

- Registered Users starts folded to keep later dashboard sections nearby.
- Toggle is a native button with aria-expanded / aria-controls; Enter and Space work.
- Search stays visible alongside the heading on desktop and wraps beneath it on phones.
- Search accepts case-insensitive name, username (with or without @), and registered-email substrings. Whitespace-separated terms must all match, including across different fields. Punctuation is literal, not a regular expression.
- Typing opens results; folding keeps the search, while Clear empties it and returns input focus.
- Search checks all loaded rows before displaying the first 100 matches. Show more exposes later matches.
- Emails wrap instead of being truncated, with text selection enabled. Existing role/onboarding badges remain.
- Loading, no accounts, no matching accounts, and failed RPC states remain distinct. Failed RPC hides stale rows; the error and existing Retry action stay visible even while folded.
- Incoming roster refreshes recalculate matches without resetting the query.
- Search and expansion are not persisted across reloads.

## Access and privacy

The component is rendered only after the existing AdminDashboard demo/role guards. admin_list_users is unchanged, including its private.has_role admin check, revoked public/anon execution, authenticated grant, and 1,000-row limit. No new API, database query, migration, data transmission, storage, or query-string persistence was added.

The existing RPC only returns the latest 1,000 accounts. This local change does not implement server pagination, so a note explicitly states the limit whenever 1,000 rows are loaded. A production Auth/PostgREST integration test was not run.

## Verification

- node --test tests/adminUsers.test.ts: 7 passed.
- npm run check: TypeScript, lint (26 existing warnings, no errors), all 1,307 tests, Vite production build, and prerender passed.
- node scripts/test-admin-users.mjs: 128 assertions passed in headless Chromium at 320, 390, and 1440 px.
- Screenshots inspected: collapsed desktop and narrow-phone searched results. Search hint fits; long emails wrap; later dashboard content remains nearby when folded.
- Synthetic fixture only, with every non-local browser request blocked. No external requests attempted, no browser JavaScript or HTTP errors, no production account or database access.
- No physical-device or VoiceOver test. Existing build chunk-size warnings remain.

The browser harness accepts PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH for an existing Chromium/headless-shell binary and ADMIN_USERS_QA_OUTPUT for local screenshots. On MGPC it used the already available headless-shell executable and extracted Chromium libraries through LD_LIBRARY_PATH; nothing was installed.

The first diagnostic browser launch lacked shared runtime libraries; rerunning with the existing local library directory resolved it. The first font pass used fallback fonts because dependency symlinks pointed outside the fixture directory; the harness now allows only its workspace and the resolved bundled Inter font directory, verifies font load, and fails on HTTP errors. The final run passed with real bundled fonts.

No push or deployment. Publication requires explicit approval.

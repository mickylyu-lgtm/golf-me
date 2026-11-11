# Public social lists: native synthetic verification

Date: 2026-11-11. Tested app source: d84360a3d4b4208723e24f62524aee42351fd4b9, including current-main integration and zero-mutual suppression. No production SQL, push or deployment occurred during this validation.

## Result

- Real iOS 27 Simulator WKWebView: 51 of 51 automated assertions passed at both 320 px and 390 px.
- Separate simulated keyboard/body-resize fixture in that native engine: 27 of 27 assertions passed at both widths, including sheet/Close reachability, search, Load more, mount while open, nested removal cancellation, background lock and scroll restoration.
- Real iOS Simulator Safari visual checks confirmed zero mutuals hidden, pending requests prominent and accepted follows compact.
- Normal assertions included public followers/following lists, literal search, 30/60/65-row pagination, profile navigation and 2-to-1-to-0 mutual changes.
- Earlier fallback-font runs also passed: 43 normal assertions and 25 simulated-keyboard assertions at each width.

The one-line production fix opts only FollowersSheet into the existing keyboardAware modal. Independent review confirmed synthetic hooks are limited to test harnesses and absent from the normal build. Aggregate local checks passed 1,421 tests, TypeScript, lint and production build. The database migration remains byte-identical to the independently reviewed SQL and its earlier isolated PostgreSQL authorization/concurrency evidence.

## Runtime and artifact integrity

The user approved a separate official Python runtime for this test. Python 3.14.10 from python.org was checked as Python Software Foundation signed and Apple-notarized, then extracted into a private test folder. It ran with process-local settings. No installer scripts, default Python, PATH, security or network settings were changed.

The unchanged supported file-transfer helper materialized the final compiled synthetic archive. SHA-256: c028a7abab17ed66fe61bd8844ece1437a2d09e23741d121d8f9536ac75c3f01. Size: 8,451,645 bytes. All 1,071 inventoried file hashes were verified (1,072 ZIP entries including the inventory). The snapshot contains fictional data, a local-only network policy, the normal preview, and a clearly separate synthetic keyboard preview. Existing GolfMe app/session state was not modified. The temporary test app and preview servers were stopped after verification.

## Font distinction

The first QA package lacked referenced Inter font files. The final QA-only package includes them; both builds have zero missing local resource references, and native checks verified intended Inter fonts loaded. This does not establish typography parity with the existing live deployment.

A separate read-only live asset check found that the deployed CSS requested /assets/files/inter-latin-400-normal.woff2, but its response was 200 text/html rather than a valid font. Normal local dist also omitted referenced font files. This inherited asset/build issue was not changed by this feature. Both fallback and intended-font layouts were exercised; no global production font/build fix was introduced.

## Limits and release gates

Automated DOM interactions in a real WebKit engine and simulated keyboard events do not prove physical typing/touch, actual Capacitor Keyboard IPC, native API-error injection, hardware/browser Back dismissal, or a shipping-app end-to-end flow. No claim is made for a physical phone or other iOS versions. The authorized live test session was unavailable, so new authenticated Auth/PostgREST checks remain pending. No refresh/sign-in or real follow/request mutation was performed.

Production release still requires explicit approval for the reviewed public-list database change, outcome/API verification, and then the matching frontend. The dependent frontend must not ship alone. Do not run broad db push or repair unrelated migration history. Separate account-classification and inherited privilege findings remain outside this native QA result.

Native worker evidence: /private/tmp/golfme-public-social-webkit.sApzdO/fonts/NATIVE-QA-REPORT.txt and accompanying JSON results/screenshots on the Mac.

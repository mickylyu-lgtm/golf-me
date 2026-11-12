# Auto-Match golf animation

## Requested two-second minimum revision

Micky explicitly requested a minimum two-second radar display after selecting the radar. This supersedes the immediate-cached-results policy in the historical sections below. The selected artwork, 4-second sweep cycle and pulses are unchanged; two seconds is the minimum display window, not a network timeout or an additional wait after loading finishes.

A route-scoped AutoMatchEntry sits outside Suspense and supplies its monotonic start time. The lazy-module radar counts toward the same window rather than triggering another two seconds when the page mounts. The page-local presentation hook holds cached/demo, round, golfer and empty outcomes until the window expires, while data fetching/ranking continue unchanged. Longer actual waits remain pending and release as soon as ready. Errors and location prompts retain their existing precedence and do not wait for the artificial minimum; initial rounds loading can still precede a location prompt, as before.

New entries/search/account identities and new actual waits (including Retry) start a fresh deadline. Ready data preserves the existing deadline. Ordinary rerenders, result-card changes and preference-sheet dismissal do not restart it. Cleanup clears the timeout; an active flag and exact state identity reject stale callbacks after interruption, a newer search or unmount. No percentages, fake data, delayed requests, animation-end dependency or JavaScript frame loop. Reduced-motion users get the same static scene and no animated reveal. Back and the app navigation remain available.

Base: 4bca64105e06eaefd43d0d5519dc1c07ff032555. Full npm run check passes TypeScript, all 1,493 tests (zero skipped/failing), lint (28 baseline warnings/zero errors), build and prerender. All 19 focused tests pass independently. Chromium and WebKit each pass 199 synthetic assertions with zero runtime errors, all external requests blocked. New checks cover cached-real/demo/golfer/empty minimums, a lazy-route wait longer than two seconds without an extra hold, slow data resolving immediately after the minimum, early errors and location interruption, fast retry, cancellation during lazy loading, rapid Back/re-entry, replacement search deadlines and static reduced-motion entry. Existing four viewport, six-locale/200% text, dark mode, live motion-preference, gradient identity and responsive control checks still pass. Timing assertions use monotonic performance.now; virtual-machine wall-clock adjustments must not influence duration tests. No production data, database/backend or native-shell change.


## Selected radar revision

Micky selected Fairway radar and authorized this revision after viewing two animated local concepts. The radar replaces the initial gathering artwork described below. Its green/flag geometry, ball positions, staggered delays, 4-second rotating sweep and 4-second point pulses match the approved preview. The header is static, as previewed. Production omits the temporary option/preview labels.

The revision adds unique useId gradients for simultaneous header/loading SVGs, dusk colors and an explicit static reduced-motion fallback which resets only animated inner groups. Existing loading-state gates, immediate cached results, result reveal, controls, error/retry and all six translations remain unchanged.

Integrated base: 808836228856e88caa158737914a5de7dd35220d, preserving the round-completion haptic.
Final npm run check passes TypeScript, all 1,484 tests (zero skipped/failing), lint with 28 baseline warnings/zero errors, build and prerender. Ten focused motion tests pass. Chromium and WebKit each pass 171 assertions, adding distinct gradient IDs, a static header and the radar sweep to the original full state/navigation/accessibility coverage. Independent review confirms parity with the approved preview and finds no blocker; final light/dark screenshots inspected. No backend, database or native-shell changes. Physical-device and real-account limits below still apply.

## Initial gathering release (superseded by selected radar)


## Change and boundaries

Auto-Match has its own small green, gold pin and three golf balls gathering together. The header entrance finishes in under a second and rests as a static mode mark. A larger version repeats only while the existing route/data loading condition is true. Results receive a 280ms reveal without remounting cards or blocking input. Cached results remain immediate: there are no timers, progress percentages, fake matches, minimum waits or animation-completion gates.

The ordinary app/cart loader is unchanged. The route-specific fallback applies only to /auto-match inside the authenticated shell. Existing matching, widening, account/demo behavior, errors, Retry, location and preference flows are unchanged. No backend, production data, migration or native-shell work.

CSS motion uses only transform and opacity, with three small SVG groups and no JavaScript frame loop. Reduced motion is fully static, including a setting change during a running animation. The decorative SVG is hidden from assistive technology; real loading has a polite localized status in all six languages. Dark mode uses the same scene in dusk greens. The title wraps long localized words; subtitle copy remains full-width on narrow/enlarged layouts.

## Verification

- Base: ca96e208e932a5701b863dc596d425b9f144127e.
- Final npm run check passed TypeScript, all 1,478 tests (zero skipped/failing), lint with 28 existing warnings / zero errors, production build and landing prerender. Existing large-chunk build warnings remain.
- Nine dedicated regression tests cover route/data wiring, cached/demo timing, error/location precedence, accessibility/localization, finite entrance versus loading loop, reduced motion, transform/opacity-only motion, responsive header, and unchanged result controls. Included in test:play and the full test suite.
- scripts/check-auto-match-motion-ui.mjs passed 147 assertions each in Chromium and WebKit at 320x844, 390x844, 844x390 landscape and 1440x900.
- Browser coverage: delayed lazy-module fallback; immediate cached results; repeated next-match taps; preferences open/close with selection retained; rounds/golfers pending; error/Retry; missing location; empty and golfer-only results; Back during search and Forward after completion; header animation settling; actual motion; live reduced-motion changes; dark mode; and six locales with 200% root text.
- Independent source review found an enlarged-title/copy-layout issue in the first draft. Fixed by keeping subtitle full-width and wrapping long title words; re-review found no remaining blocker.
- Actual rendered search/results/dark screenshots were inspected. They show synthetic demo data, not real customers or a live production session.

## Reproduction

Run npm run check and node scripts/check-auto-match-motion-ui.mjs. AUTO_MATCH_ENGINE=webkit chooses WebKit. Optional CHROMIUM_EXECUTABLE / WEBKIT_EXECUTABLE can point to an existing browser. This machine uses pre-existing cached browser libraries through LD_LIBRARY_PATH; the headless WebKit MiniBrowser additionally needs WEBKIT_EXEC_PATH, WEBKIT_INJECTED_BUNDLE_PATH and WEBKIT_INSPECTOR_RESOURCES_PATH from its installed bundle. No browser/system package was installed for this change.

The test-only state module is injected by the local Vite QA script, never by production config. All external browser requests are blocked and Vite uses a dummy backend. Browser result JSON/screenshots are under artifacts.local/automatch and are not committed. At 200% root text, existing app TopBar/other legacy content can overflow independently; regression bounds target the changed header and loader.

## Limitations and release

Synthetic WebKit is not a physical iPhone/Capacitor or VoiceOver check. Real-account fetches and real joining were not exercised. No production writes are needed.

Prepared on an isolated worktree; publish only within the parent's coordinated, user-authorized release. Verify remote main, exact-commit CI and the production asset before calling it live.

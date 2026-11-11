# Followers/Following search keyboard layout

## Cause and scope

The former content-sized bottom sheet changed padding and max-height immediately on native keyboard WillShow. Its search moved again when loading/filtering changed content height. Only ProfileFollowers opts into the new SearchModal: stable viewport geometry, fixed search header, separately scrolling results. Native target heights transition; web visualViewport samples apply directly. The page is never scrolled by this implementation. Other modals, chat, Capacitor listeners, social-data policies and the backend remain unchanged.

The Android pre-focus baseline survives blur until the viewport recovers. In cramped landscape the toolbar scrolls independently while Close remains visible. Measured title/input size controls the results reserve; enlarged search/Close take priority when no result row can fit. Keyboard reopening retargets current motion; reduced motion disables it.

## Verification

- Integrated base: 8b562ec75508931def245880645f9961d4ddb3a4.
- npm run check passed TypeScript, all 1,459 tests with none skipped, lint with 28 baseline warnings/zero errors, production build and prerender.
- Six new geometry/wiring regressions cover portrait/desktop anchoring, constrained space, retargeting and bounds. Existing publicConnectionPages test recognizes the new opt-in surface.
- scripts/check-follow-search-motion-ui.mjs passed 178 assertions each in Chromium and WebKit: 320/390/1440 and 844x390 landscape; native intermediate motion, no page pan, list retention, both tabs, empty/filter results, pagination, close/reopen/mount-open, nested confirmation, cleanup, reduced motion, synthetic web viewport and Android blur-before-recovery.
- Six supported locales (en, zh-CN, zh-TW, es, ko, ja) passed 200% root-text clipping assertions in landscape with a 216px keyboard. Screenshots were inspected under artifacts.local/follow-search, not committed.
- Existing check-profile-keyboard-ui.mjs passed search, pagination, nested confirmation, mount-open, closing/reopening, row navigation/Back and page locking.
- Independent review findings for constrained-height input clipping and Android blur timing were fixed and re-reviewed without blockers.

## Reproduction and limitations

Run npm run check and node scripts/check-follow-search-motion-ui.mjs. Default uses installed Playwright Chromium; CHROMIUM_EXECUTABLE may supply a binary. SEARCH_TEST_ENGINE=webkit selects WebKit; WEBKIT_EXECUTABLE and runtime library environment variables may be required. SEARCH_TEST_WIDTH limits a debugging run. The legacy script uses CHROMIUM_EXECUTABLE and optional CHROMIUM_LIB_DIR.

Tests use a dummy backend, synthetic demo relationships and local-only Vite transforms, with external browser requests blocked. Test hooks are not in production configuration. This verifies real browser rendering with synthetic keyboard/viewport events, not physical iPhone/Capacitor or real-account behavior. Native curve/timing, Safari focus/pan, safe areas and screen readers still need on-device checks. CJK glyph fonts are absent in this Linux screenshot runtime; translations were not changed. No production data writes, migrations, server functions or native-shell changes.

Physical check: open Followers and Following, tap search, type a match/miss, scroll, dismiss/reopen the keyboard and rotate. Portrait search should stay anchored; Close/input remain usable in landscape; dismissal preserves the underlying profile position.

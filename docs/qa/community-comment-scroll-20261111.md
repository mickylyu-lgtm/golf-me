# Community comments: preserve the feed on exit

Date: 2026-11-11  
Base: `7d74d08ae5edd395214f7916886bce035813329f`

## Cause and fix

`PostDetail` restored its pre-keyboard scroll offset from the docking effect's cleanup. Cleanup also runs when leaving the page. That queued animation frame ran after `ScrollToTop` had restored the feed, so the old post overwrote the destination's scroll.

Restoration now runs only when a mounted composer undocks. Its animation frame is cancelled on unmount, redocking or post-ID change. The callback checks that the same composer is connected and another text field has not taken focus. Post-ID cleanup forgets saved coordinates. Scroll-lock release remains unconditional. No shared router, chat, native plugin, database or backend change.

## Verification

- Six focused regressions failed against the original production effect; normal keyboard dismissal passed.
- All eight final effect tests pass, including direct Back, hide-then-Back, focus transfer, redocking, detached elements and reused post IDs.
- The real-component Chromium baseline reproduces the reported jump: returning to a feed saved at 1800 px instead ends at 701 px with the old source.
- Fixed browser suite: 136 assertions each in Chromium and WebKit 26.5, at 320×844, 390×844, 844×390 and 1440×844. Mobile contexts use touch; WebKit phone/landscape contexts use mobile mode.
- Covers read-only comments, actual in-app Back handler, repeated docked exits, ordinary dismissal, hide/Back race, unsent draft preservation, Forward, post-ID reuse and navigation to another destination. Feed position remains within 2 px immediately and after 350 ms. Every lock is released and no runtime errors occurred.
- Full `npm run check`: TypeScript, lint, all 1,453 tests, production build and landing-page prerender pass. Lint retains 28 pre-existing warnings and no errors.
- Source review found no blocker. Feed screenshots inspected.

## Reproduction

The fixture aliases contexts to synthetic records and replaces the native keyboard source only in this local Vite configuration. All external browser requests are blocked. No real accounts, API writes, customer media or production data are used. The fixture is not imported by the production app.

```sh
node --test tests/communityCommentScroll.test.ts
CHROMIUM_EXECUTABLE=/path/to/chrome-headless-shell \
CHROMIUM_LIB_DIR=/path/to/optional/libs \
node scripts/check-community-scroll-ui.mjs

BROWSER=webkit WEBKIT_EXECUTABLE=/path/to/MiniBrowser \
node scripts/check-community-scroll-ui.mjs

# For a custom WPE WebKit binary, also supply its normal
# WEBKIT_EXEC_PATH, WEBKIT_INJECTED_BUNDLE_PATH,
# WEBKIT_INSPECTOR_RESOURCES_PATH and LD_LIBRARY_PATH.
# Omit WEBKIT_EXECUTABLE for an ordinary supported Playwright installation.

# Reproduce the old production behavior without editing the working tree:
QA_BASELINE=1 CHROMIUM_EXECUTABLE=/path/to/chrome-headless-shell \
node scripts/check-community-scroll-ui.mjs
```

Screenshots are local artifacts named `artifacts.local/community-scroll-{chromium,webkit}-{width}.png`.

## Limits

WebKit is Linux Playwright WebKit, not a physical iPhone or native Capacitor integration. Keyboard events/body resizing are synthetic. Physical iPhone keyboard timing, gestures and safe-area behavior remain unverified.

When navigating directly between two post IDs while the same input stays focused, WebKit can independently reveal that input after the keyboard closes. Instrumentation confirms this does not issue an old-post application scroll. The suite does not claim that this unusual focused-route-reuse case is motionless; focus-management behavior is unchanged.

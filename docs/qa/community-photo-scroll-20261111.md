# Community photo scrolling: local regression results

Date: 2026-11-11
Branch: `fix/community-photo-scroll-20261111`
Base: `294e06c` (`fix/round-chat-switch-20261110`)
Scope: local-only frontend fix; no push, deployment, database migration or production-account access.

## Confirmed cause

The carousel had CSS `scroll-behavior: smooth`, while both its opening and return effects assigned `scrollLeft` assuming that this was instantaneous. Browsers animate those assignments too. Opening photo 2 therefore started on photo 1 and animated toward photo 2. An immediate backward swipe competed with that animation.

With the original component in a 390 × 844 touch-enabled Chromium fixture:

- Opening photo 2 and immediately swiping back to photo 1 snapped back to photo 2 in all three attempts.
- Opening photo 3 and immediately closing incorrectly reported photo 1.
- The opening position for photo 3 was 0 px immediately, 27 px after 50 ms, and 780 px after settling, instead of starting at 780 px.

## Change

- Opening and return positioning now run before paint, without CSS smooth scrolling.
- Native touch momentum and scroll snapping remain enabled.
- Every viewer close sends a fresh return request, so returning to the same photo twice still works after manually moving the feed card.
- Scroll-derived indices are bounded to the album, including elastic overscroll.

No changes to pinch/pan handlers, vertical-dismiss behavior, video playback, backend, native shell, or chat code.

## Verification

- `npm run check`: passed TypeScript, lint, all **1,253 tests**, production build and prerender using a dummy backend. Existing bundle-size warnings remain.
- Focused new regression tests: **7 passed**. With existing zoom tests: **19 passed**.
- Real MediaCarousel and FullscreenMediaViewer components, synthetic SVG photos only, isolated headless Chromium:
  - Immediate opening on the requested photo and immediate photo 2 → 1 swipe: three repeated cycles.
  - Forward swipe, small vertical finger jitter, rapid open/close on photo 3.
  - Close returns the card to the last viewed photo; repeated close to the same index after manually moving the card.
  - Double-tap zoom, zoomed pan without switching photos, zoom back to fit.
  - Downward dismissal, cancelled dismissal, subsequent swipe, Escape, page-scroll unlock.
  - Reduced motion and desktop horizontal wheel navigation.
  - **27 checks passed**, no browser runtime errors.

## Screenshots

The accompanying screenshots are local synthetic fixtures, not production posts:

1. Fullscreen gallery remains on photo 1 after an immediate backward swipe from photo 2.
2. The feed card remains on photo 2 after closing the viewer.

## Remaining validation

Physical iPhone Safari/WKWebView, pinch gestures on real hardware, real account data, and production deployment were not tested. Review the local commit, then obtain approval before any push or deployment.

# Community desktop layout QA - 2026-11-11

## Scope

The screenshot shows Home's embedded Community feed. This patch covers that feed and the standalone Community, My Posts, and Saved Posts lists. The deliverable is based on clean preview `c5bb6c0`; no followers feature is included. No remote branch, deployment, production data, backend, migration, or native shell was changed.

## Reproduction and changes

- Equal-height grid rows left a large hole below a short post beside a taller post. The synthetic baseline had a 606px same-column gap. Sparse one-pixel row spans now give 16-17px spacing, including fractional card heights, while keeping chronological DOM and top-to-bottom visual order. ResizeObserver updates spans after image/text/width changes; layout-effect measurement prevents first-paint overlap. No CSS columns or dense auto-placement is used.
- Desktop photos were contained inside a fixed 576px/70vh box, creating gray bands above and below landscape images. The desktop/tablet card now takes the selected image's natural aspect ratio. Landscape, portrait, square and panorama edges remain visible. Source-tagged measurements avoid applying a previous album image's dimensions. Existing phone feed crop limits and video/fullscreen behavior are retained.
- Home retains its one-column rule at 1280-1399px. Its load-more sentinel and final Community link sit outside the compact grid and below every card.

## Automated checks

- `npm run check`: TypeScript, lint, all 1,262 tests, production build and landing prerender passed using the script's dummy backend. Lint reports the same 26 pre-existing warnings, zero errors. Existing build chunk-size warnings remain.
- Added eight regressions in `tests/postFeedLayout.test.ts`, included in `npm run test:trust` and the full suite.
- React review: stable child keys retained by Children.map; hooks use stable source dependencies and clean up observers; no reordering/tabIndex changes, new dependency or additional backend requests.

## Local browser checks

44/44 passed in Chromium using the real page/PostCard/MediaCarousel components and synthetic data. Non-localhost network requests were blocked. Baseline page components were verified unchanged from clean preview `c5bb6c0`.

- Baseline whitespace and letterboxing reproduced; changed layouts eliminate both.
- Responsive columns, no horizontal overflow, chronological visual order, and natural image ratios at 390, 768, 1024, 1280, 1440, and 1920px. Phone aspect limits remain unchanged.
- Tab traversal stays chronological. Search/filter/clear and Following/Nearby/For You tabs repack correctly.
- Changed text height and landscape-to-portrait album changes repack following cards. Fullscreen opens the selected photo and closing keeps it selected.
- Home compact spacing, full photo proportions, load-more to eight posts, footer below the tallest column, and 1280px single-column layout passed.
- A 168-card synthetic feed remains compact and ordered through a 37,558px page, with no grid-track clamping or runtime errors.

## Screenshots and reproduction files

Captured at 1512x982, synthetic posts only:

- `03-home-before.png` and `04-home-after.png`: exact Home feed before/after, scrolled to its Community section. Preferred review pair.
- `01-community-before.png` and `02-community-after.png`: standalone Community page before/after.

Local fixture source: `/tmp/golfme-desktop-layout-qa-20261111` (WSL). Browser driver, screenshots, and `layout-results.json`: `C:\Users\micky\AppData\Local\Temp\golfme-desktop-layout-qa-20261111` (MGPC). Local server was port 5193 and is stopped after capture. No screenshots from private production content are included.

## Remaining checks

Review the isolated commit, then coordinate any preview push separately. Safari, physical iPhone, and real-account checks were not run. No deployment is implied by these local results.

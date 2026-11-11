# Public social lists: local UI verification

## Root cause and change
The previous UI, RealSocialContext and server deliberately required an accepted viewer-to-owner follow. The old search fetched all offset pages. This change removes client accepted-follow gates alongside the server policy revision and uses a bounded, literal name/username search RPC with opaque cursor pagination. It does not redefine pending requests as accepted follows.

## Client behavior
- First-page reads debounce 250 ms. Viewer, owner, tab, normalized search and social mutation changes hide old rows synchronously; late results cannot repopulate them.
- Explicit Load more fetches 30 rows. Duplicate identities or nonadvancing cursors fail closed. Any page failure clears rows and Retry restarts at a null cursor.
- Provider-local in-flight-only summary/state dedup avoids concurrent duplicate reads without caching settled results. Follow-state network requests are limited to four concurrent operations across scopes; stale queued work never starts. Immediate caller-scope checks protect synchronous cache writes after async helper continuations.
- Existing shared mutation generation refreshes counts, mutual summary, list and FollowControl reads after follow, unfollow, removal, request and block changes.
- Row navigation and Follow/Following/Requested controls are separate targets, at least 44 px high. Removal is owner-only. Self-follow controls are absent.
- Public photo, display name, username and area are shown through the existing public-field mapping. No email/phone/auth/private fields are mapped or rendered.
- Follow approval/request/cancel/accept/reject/removal semantics remain. All six locale approval descriptions now state lists remain public.

## Verification
- npm run check: TypeScript, oxlint, 1,310 tests and production build passed. Build retains existing >500 kB chunk warnings.
- Local synthetic Chromium script blocks all nonlocal requests. Covers 320/390/1440 layout, preserved stats grid, near-top mutuals, public nonfollower access, pending requests, cancellation, acceptance/rejection, own removal, row follow/unfollow mutual changes, blocked profiles, account changes, search and Escape.
- Large graph sheet regression verifies 30/60/65 loaded rows, no eager full graph collection, literal name/username search and profile navigation.
- Synthetic delayed-read fixtures cover stale search/scope responses, duplicate load-more clicks, failed page clearing, null-cursor retry, duplicate-page rejection, revoked access, error without fabricated zero and account-scope changes.
- Screenshots in artifacts.local: connections-320/390/1440.png, public-nonfollower-connections-390.png, profile-mutual-top-390.png and follow-request-pending-mobile.png. These are local synthetic data only.
- Native iOS Safari/WKWebView has not been verified by this worker. Chromium does not establish native parity.

No source was committed or pushed by this worker. No production database, deployment or real accounts were changed.

## Integrated source verification

The reviewed feature was preserved as local commit c6305782103e1fd6b5f5071123bdc6a81907e4fd after a conflict-free rebase onto remote main ea54fac6b2c0b7a4f1b50ffb3d31a0e7b851a898. The integrated npm run check passed 1,317 tests, TypeScript, lint and production build. The seven additional tests came from the already-released dashboard work. No new production SQL, push or deployment occurred.

Independent final review verified the immediate cache-scope check, scope-specific in-flight deduplication, maximum four concurrent follow-state reads across scopes, and rejection of stale queued work. It separately reran ten coordinator/page tests successfully. Total requests still grow with loaded rows; concurrency limiting is not constant total request cost.

Native iOS Safari and WKWebView testing was attempted but could not start: Mouse's Mac was reported offline and attachment returned unavailable/offline. No existing simulator/app/session was changed. The approved break60 simulator session was therefore unavailable for new real Auth/PostgREST checks. Do not treat synthetic Chromium or isolated SQL results as those missing integration checks.

The integrated synthetic Chromium rerun also passed 320/390/1440 layouts, 30/60/65-row paging, literal search, independent profile navigation, delayed/error/stale reads, double load-more, cursor retry, removal and private-request flows. It blocked 52 external requests and shut down its temporary browser/server. Logs: /tmp/golfme-public-social-integrated-check.log and /tmp/golfme-public-social-integrated-ui.log on MGPC/WSL.

## Current-main preflight, 2026-11-11

The local candidate was rebased without conflict onto remote main 9fa5f18862f6994593f9f3c845431bfeab6b624f, producing feature commit 28672ce and verification commit 361c5b2. All six overlapping locale files merged cleanly. Fresh npm run check passed 1,346 tests, TypeScript, lint (27 existing warnings, zero errors) and production build. The complete synthetic Chromium regression passed again, including 320/390/1440 layouts, search, 30/60/65-row pagination, private requests, mutations, cache scope, errors and interrupted reads. It blocked 52 nonlocal requests and closed its temporary browser/server. Logs: /tmp/golfme-public-social-current-main-{check,ui}.log on MGPC/WSL.

Read-only live preflight found no prerequisite drift: all 18 relevant function bodies, ownership/search_path/execution modes/ACLs, table policies and constraints, request-table protections, existing indexes and block trigger still matched the previously verified release. The new page RPC and indexes remain absent; the new migration remains unapplied. CI still has no automatic migration/db push. Migration SHA-256 remains c985e9fbbbdd51aa7360ef374c0e1e850b0d63fbd479d6d0efd518d55f06d3c1. No real records or secrets were read.

This preflight is not release approval. Production SQL requires explicit scoped confirmation. The dependent frontend must not be published alone. Mac remains reported offline, so native Safari/WKWebView and the approved simulator-session Auth/PostgREST check remain unavailable. No production SQL, push or deployment was performed.


## Mutual-summary presentation follow-up
The eligible nonfollower/pending state now uses a prominent near-top card with the existing count and explanation. An accepted follow switches the same summary to a smaller text row; its explanation remains available to screen readers. Own, blocked, loading and failed states still do not fabricate a summary. The profile grid, data contract and connections sheet are unchanged.

Validation: full npm run check passes 1,347 tests plus TypeScript, lint and production build. Synthetic browser regression checks accepted versus nonfollow/pending presentation, own/blocked omission, visible mutation transition, compact long names, and prominent 320/390 layouts without overflow. Same-profile/same-count screenshots are artifacts.local/mutual-before-follow-390.png and artifacts.local/mutual-after-follow-390.png. Chromium only; no new native Safari/WKWebView evidence.

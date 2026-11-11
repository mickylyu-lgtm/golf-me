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

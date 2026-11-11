# Official Community posts

Status: implemented locally on main base 72e3d3c. Production migration NOT applied. No posts were created, no roles changed, and no live account session was used for testing.

## Product behavior

- Real admins get an opt-in **Post as GolfMe** checkbox in the existing composer once the versioned server capability is available. Ordinary posting is the default.
- Published announcements retain their real author and show **GolfMe announcement** on the shared PostCard (feed/detail and other surfaces that reuse it). Existing categories, feed order, privacy/block/moderation behavior and notification fanout stay unchanged. No pinning or broadcast.
- Official mode is not saved in the shared draft. New composers and account changes start with it off. A selected mode whose permission becomes unavailable remains visible but cannot publish until access is restored or the user explicitly turns it off.
- The database is authoritative; the UI capability is only a hint. Submission rechecks capability and current account, then the database rechecks actual authorization.
- Failed publication preserves the text/media draft. If an official attachment write fails after the post exists, only a verified deletion permits a retry. Failed, missing or thrown rollback results instead take the user to check the possible publication, avoiding silent partial success and duplicate retry.
- Existing/legacy rows render as ordinary. Ordinary inserts omit the new column, so the frontend remains compatible before migration or after a frontend rollback.

## Verification

- Focused runtime and source regression suite: 10/10 passing.
- Synthetic Chromium: 134 assertions passing using the actual composer, capability hook, option, badge and PostCard with local API/auth/data stubs. Covers default off, submission mode, repeated click, rejected publication, uncertain rollback UI, role loss/restore, demo, missing backend, late prior-account response, account switch, Back/reopen, draft preservation, legacy/official cards, all six locales, 320/390/1440px and light/dark. All non-local requests blocked, zero attempted; no runtime errors. See official-community-posts-ui-results.json.
- Light/dark composer and feed screenshots inspected after transitions settle. Screenshots are synthetic and kept under artifacts.local/official-posts.
- Isolated PostgreSQL security fixture: 58/58 assertions passing; see official-community-posts-backend.md and official-community-posts-db-results.json. Read-only production catalog compatibility verified.
- Independent security/source review: no remaining actionable findings. One false-positive stale-response test was corrected before final rerun.
- Final npm run check passed: TypeScript, lint (28 existing warnings, zero errors), all 1,447 tests without skips, production build and prerender. Existing bundle-size warnings remain.

## Release gates and limitations

The migration is supabase/migrations/20261111210916_official_community_posts.sql. Frontend-first publication is safe but keeps the option hidden until the separately authorized migration is installed. For authorized application, run the migration in one transaction with 5s lock_timeout and 30s statement_timeout; the additive constant-default column needs a brief exclusive table lock. Recheck exact main and coordinate other releases before pushing.

No live Auth/PostgREST write test, actual production announcement, physical iPhone/WebKit/VoiceOver test, full-schema Supabase staging test, or Storage policy change. The local database fixture covers the relevant RLS, roles, suspension and media cap, but not all application triggers. Existing mutable Storage-object permissions remain unchanged. Once official posts exist, prefer a frontend rollback rather than dropping their designation/guards.

## Frontend release integration — 2026-11-12

Rebased onto verified production main 29ced668410aec66870590c93f4c904c99e5fe19. Only the status document required manual conflict resolution; both features' status sections were retained. The application, tests, scripts and migration have the same stable patch ID (4f381c26ae498cd4e02477a0889e7197dd7c4bbe) as reviewed commit 9343a51. The SQL SHA-256 remains 96317ef6367b140e0784dfaf66f8abdd9bd61deef976ef10ddf50ae1a7808fdd.

Final integrated npm run check passed TypeScript, lint with 28 existing warnings/zero errors, all 1,469 tests with zero failures/skips, production build and prerender. The 134-assertion Chromium suite passed again using the existing browser runtime libraries; narrow light composer and dark feed screenshots were inspected. Test external requests remained blocked and none were attempted. No source changes followed these checks.

The owner authorized pushing when ready. This release publishes only the compatible frontend and tracked unapplied migration file. A read-only production check found no is_official column, capability RPC, eligibility guard or official-post triggers. No database mutation, post, role or Edge Function deployment was performed. Post as GolfMe remains hidden pending the owner's separate migration approval. Physical iPhone/WebKit/VoiceOver and live Auth/PostgREST write tests remain unverified.

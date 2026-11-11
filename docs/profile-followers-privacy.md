# Profile followers: local privacy hardening

Status: local implementation and source review only. Migration NOT applied. Do not release the earlier broad-read prototype.

## Visible rows and counts

The new `golfer_profile_followers` endpoint uses the signed-in identity, never a caller-supplied viewer id. It returns public profile fields, a follower total and a mutual total from one materialized permitted set, before pagination. There is no raw relationship total. Counts can differ between viewers, and the sheet says they include only profiles visible to that viewer.

A target and each follower must have a completed, named profile, must not hold an active test/app_reviewer/bot/seeded role, and must not have an active suspension. Expired suspensions do not hide someone. Those checks apply even to direct contacts.

Discoverable profiles are eligible. A non-discoverable profile is eligible only for itself or a viewer with an existing follow in either direction. Therefore your own non-discoverable followers remain visible to you. Someone merely following a third-party profile is not a direct contact with you. DM-only and shared-round-only contacts do not receive a new listing exception. This does not change their existing profile/chat/round visibility elsewhere.

Any block in either direction between viewer and target, viewer and follower, or target and follower excludes that target/edge. This also handles old follow rows retained after a block. Missing, inaccessible, suspended, excluded and blocked targets produce the same unavailable error. No role, suspension or block reason is returned.

Mutuals are eligible followers the viewer also follows. On your own profile, these are people you follow back.

## Access boundary

The private eligibility helper is SECURITY INVOKER and has no application-role execute grants. The public read endpoint is SECURITY DEFINER only to evaluate private moderation/role checks and read authorized public fields after profile RLS becomes own-row-only. It uses explicit auth/target checks, empty search_path, no dynamic SQL, revoked PUBLIC/anon execution, and authenticated-only execute.

The endpoint reuses the existing narrow public-profile projection inside the same SQL statement, only for already-authorized page ids. It never returns profile coordinates, roles or suspension rows. Maximum page size is 100, below the projection's 200-id bound. Count-only calls use limit=0. Invalid/negative/too-large offsets raise an error rather than repeating a clamped page.

The client uses only this versioned endpoint. Missing function, permission, transport, malformed response, inconsistent multi-page counts, duplicate identities or truncated pages fail closed. No raw follows/table/public-profile fallback is allowed. Account/target/block/follow changes invalidate late results; reopening or refocusing the sheet rechecks permission. Offset pages are independently authorized snapshots; same-count membership swaps between pages are not detected. This is not a realtime moderation subscription or a whole-system cache revocation mechanism.

Existing broad authenticated SELECT on follows and supplied-id golfer_public_profiles remain separate legacy surfaces. This change prevents new UI exposure; it does not claim to close those pre-existing API paths.

## Validation and rollout gates

- Full local `npm run check`: 1,251 tests, 1,248 passed, 3 existing skips, 0 failures. Typecheck, build and prerender pass. 26 existing lint warnings, no errors/new warnings.
- Synthetic browser checks: own/other counts, mutuals, search/no-results, profile navigation, two-way block omission including counts, Escape and 320/390/1440px layouts. External requests blocked.
- Independent source review found no required SQL changes. This is not runtime authorization verification.
- `scripts/staging/profile-followers-authz.sql` is a rollback-only synthetic suite. It refuses any database except an EMPTY disposable database named exactly `golfme_followers_test`. It creates fake schemas, roles and identities, applies the local function definitions inside the transaction, tests authenticated/anon behavior, then rolls everything back.
- SQL suite NOT EXECUTED: this selected environment has no psql/Postgres/Docker runtime. It must pass on an isolated local test database before deployment approval. Its projection fixture mirrors the existing auth/block contract but cannot validate the deployed environment's schema/ownership/configuration.
- After isolated SQL tests pass, validate on a separately authorized staging backend with its full migrations, then run real authenticated client and physical-iOS tests. Obtain explicit backend rollout/publication approval before applying any migration, pushing a deploy branch, or deploying. Never run the fixture script against a linked/production project.

Migration: `supabase/migrations/20261111010730_profile_followers_visibility.sql` (CLI-generated, unapplied). Rollback commands are in its header.

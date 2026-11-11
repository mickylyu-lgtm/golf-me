# Private social controls: backend review and rollout

Status: production backend applied and verified on 2026-11-11; matching frontend release pending. Based on commit 29f36dd18a72970c6d52b2e30246ca7d76a6ff17. Originally reviewed as 20261111051406_private_social_controls.sql; the production tool recorded 20261111082608_private_social_controls.sql. The local migration was renamed without changing SQL bytes. Server stored-statement SHA-256 is 69399931ce6f77e9ebbb829fc14729abd1f992a5bcf64c4237042f8b55ca657d, identical to reviewed source. All 18 function bodies, ACLs, policies and schema were verified. The earlier manually installed migration-history gap remains unrepaired. Do not reapply this SQL. Historical test paths and tested commits in the evidence manifest remain unchanged.

## Product boundary

The user explicitly confirmed that posts and profile details stay public. `profiles.is_private` means approval is required for **new follows**, independent of Discoverable. All existing accepted follows survive either setting change. A pending request stays pending when approval is disabled; the owner can still accept/reject it, or its requester can cancel and then follow the now-public account. Removing a follower is not blocking them: they can follow a public account again, or request a private account again subject to cooldown.

Both Followers and Following lists, their counts, and the mutual summary require either:
- The viewer is the profile owner.
- An accepted `viewer -> owner` row exists in `follows`.

The owner's following the viewer, discoverability, public content, a pending request, a DM, or a shared round never grants graph access.

Mutuals retain the existing definition: eligible people the viewer follows who also follow the viewed owner. This is computed from eligible incoming followers on both tabs, not common outgoing follows. `is_mutual` on a returned row means the viewer follows that identity; the new UI need not show row badges.

## Authorization

Target permission and candidate eligibility are separate helpers. Both are checked server-side.

- The viewer and target must have complete, named, active profiles. Active suspension, auth ban/deletion, or either-direction block denies access. Generic errors do not disclose why.
- An active **test-only** target is allowed only for self or an accepted viewer-to-target follow. No account roles are changed.
- An active test-only listed candidate is allowed only for self or an accepted viewer-to-candidate follow.
- Active bot, seeded, and app_reviewer roles stay excluded even when combined with test, and even with a direct follow.
- Inactive roles do not exclude someone. An absent suspension row or null auth ban does not mean suspended.
- Normal non-discoverable candidates keep the prior direct-contact exception in either direction with the viewer. They are not exposed merely because the owner follows them.
- Every candidate is checked against both viewer-candidate and owner-candidate blocks. Hidden candidates are absent from rows and every count.

`follows` remains accepted-only. Its broad authenticated SELECT policy is replaced by participant-only SELECT, plus a restrictive guard against future permissive policies. This preserves current self-related edge reads. All authorized third-party graphs use the RPC. Client INSERT and UPDATE privileges are revoked and the direct INSERT policy is removed. There is no direct-write fallback.

Current own-edge DELETE remains for older clients. It never creates a request or relationship. It gets no extra trigger/profile lock, avoiding follows-row/profile-row lock inversion. Old acceptance requests cannot recreate a removed edge because only a still-pending matching request generation is actionable.

## Request lifecycle and races

`private.follow_requests` has one latest generation per directed pair. It has RLS, no client/service-role table grants, an unguessable request ID, server timestamps, and pending/accepted/rejected/cancelled states. Terminal rows are a small latest-request cooldown ledger, not accepted relationship authority. User deletion cascades them.

- Public target: create an accepted edge.
- Private target: create a pending request, with no accepted edge or graph permission.
- Repeated follow while pending returns the same request ID.
- Only its stored target can accept/reject. Null decisions are denied, not interpreted as rejection.
- Only its stored requester can cancel.
- A replacement request gets a fresh ID. Delayed actions on a cancelled/earlier generation cannot approve its replacement.
- Recreating a request within one minute of its previous creation is denied. There is no first-request cooldown.
- All new follow/respond/cancel/remove/unfollow transitions lock both profile rows in UUID order. Privacy UPDATE locks the same owner row. Authority is rechecked after locking.
- Block INSERT obtains the same pair locks and cancels pending requests in both directions. Unblocking does not revive them. Existing accepted edges retain prior block behavior, becoming inaccessible while blocked rather than being silently deleted.
- Acceptance after a concurrent cancellation/remove has to recheck current request status. Concurrent cancellation after acceptance returns unchanged; the client must refresh and can then offer Unfollow.

The normal PostgreSQL 17.11 two-session harness now passed all ten lock-contention scenarios twice, including these orderings. The earlier single-user run was only a superseded diagnostic, not concurrency or RLS evidence. Full Supabase/API integration remains separate.

## API contract

All public APIs use the authenticated caller as actor. Private helpers are not callable by PUBLIC, anon, authenticated, or service_role. Public API default EXECUTE grants are cleared and then restored only to authenticated.

- `golfer_profile_connections(p_profile_id, p_kind='followers', p_limit=100, p_offset=0)` returns version, kind, filtered total, mutual_total, and profiles containing the existing narrow public-profile fields plus is_mutual. Kind accepts followers/following; limit 0 is count-only.
- `golfer_profile_followers(p_profile_id,p_limit=100,p_offset=0)` keeps its old response shape via the same secured implementation.
- `golfer_follow_state(p_profile_id)` returns version, state (none/pending/following), request_id or null, is_private, can_view_connections. Self is supported for settings.
- `follow_golfer(p_profile_id)` returns the same state.
- `set_account_private(p_is_private)` returns version and saved is_private.
- `my_follow_requests(p_limit=100,p_offset=0)` returns version, filtered total and requests with request_id, created_at, and narrow profile.
- `respond_to_follow_request(p_request_id,p_accept)` returns version and accepted/rejected.
- `cancel_follow_request(p_request_id)`, `unfollow_golfer(p_profile_id)`, `remove_follower(p_follower_id)` return version and changed.

## Notifications

Pending requests use new_follow_request and link to the owner's /profile request inbox. Acceptance uses follow_request_accepted and links to the approving owner. The existing actual-follow INSERT trigger still runs only when the accepted edge is created, not for pending requests. Rejection, cancellation, and follower removal do not notify.

Each new request/acceptance notification type is capped to one per actor-recipient pair per 24 hours, independent of request generations. The pending inbox is authoritative even when a repeat alert is suppressed. Existing mute, block, suspension, ban, push-enabled, and device rules are reused. Push delivery is best effort and does not roll back the relationship if its helper throws. Notification bell insertion remains transactional.

The migration preserves every existing allowed notification type. Notification payload copy covers the six existing app languages.

## Existing surfaces reviewed

- RealSocialContext reads only follows involving self, so participant SELECT preserves that read shape. The old direct follow insert becomes a deliberate fail-closed error.
- Existing suggested-golfer exclusion, circle-post fanout, analytics, and follow notifications continue to consume **accepted-only** follows. Pending requests are not mixed into those behaviors.
- The old supplied-ID golfer_public_profiles endpoint still returns its existing public field projection. It does not authorize graph access.
- Existing raw profiles SELECT USING(true) remains a separate legacy privacy issue, including coordinate exposure through direct API access. This change does not broaden it, apply the deferred profile-policy migration, or claim to resolve it.
- Existing known-profile caches can hold prior public profile data; public content is intentionally not made private. In-flight connection data still requires client invalidation/refetch after auth, block, follow, removal and privacy changes.
- No role, real user, or Discoverable value is edited.

## Validation and rollout

Synthetic file: `scripts/staging/private-social-controls-authz.sql`. It requires a dedicated disposable cluster marker and refuses unexpected cluster databases/roles, any nondefault user objects, or a database not named exactly golfme_private_social_test. It includes the actual previous follow-notification and followers SQL, the new migration, synthetic profile/relationship fixtures, and a local push sink with an empty fake vault. Everything rolls back. This is not a live Supabase/Auth/Realtime/APNs test.

The fixture covers graph gates/counts/paging/legacy wrapper, role combinations, each block pair, pending/non-followers, forged subject under anon, default grants, raw table bypasses, request/cancel/accept/reject/removal, stale generation, notification dedupe, privacy transitions, Discoverable independence, and suspension behavior.

Before release:
1. Review source, synthetic SQL results, independent security review, frontend checks, and a two-session lock/race test. Run applicable Supabase advisors against a disposable full-schema environment if available.
2. Verify installed function signatures and policies read-only. The original followers migration was manually installed without history; do not rerun it or repair migration history as a side effect.
3. Prepare the exact frontend build with no direct follow fallback. Coordinate a short rollout window; older loaded bundles cannot create new follows once the backend guard lands.
4. Apply **only this new reviewed SQL**, in one explicit transaction, after separate user approval. Do not run an indiscriminate db push against the manually managed history.
5. Verify grants, policies and return contracts, then promote the compatible frontend only with release authorization. Reload/force-quit old native shells. Validate two real approved test accounts, with no unsolicited follow/request to other golfers.
6. Check privacy setting, pending/accepted transitions, own/other tabs, removal across devices, background/resume and actual notification navigation.

Safe rollback after users enable approval is a frontend rollback/disable plus the protective backend retained, or a forward fix. Never restore broad graph SELECT or direct INSERT, drop saved privacy choices, or silently approve/delete pending requests to make an old client work. Rolling back an uncommitted migration transaction is safe.


## Current execution results (2026-11-11, verified normal server)

- Tested committed source: 5a2eeab9234f5acede37117a64c1f62d244a0888. Migration SHA-256 remains 69399931ce6f77e9ebbb829fc14729abd1f992a5bcf64c4237042f8b55ca657d. No implementation or assertion changes were needed to pass.
- After explicit user approval, official PGDG Ubuntu packages were signature/index/checksum verified and extracted into a fresh temporary workspace on MGPC/Ubuntu-24.04 WSL. Server and psql are PostgreSQL 17.11; compatible libpq is 18.6. The server ran as nonroot shmick, with no system installation, service registration or firewall change.
- The complete unchanged authorization fixture passed **139/139 assertions**, exit 0, on a normal permission-enforcing server. Its transaction rolled back; the synthetic profiles table and authenticated/anon/service_role roles were then verified absent.
- The opt-in race harness prepared only synthetic fixtures in that same dedicated cluster and passed **all ten real concurrent-session scenarios twice**, exit 0 both times. Every scenario observed the competing session's actual Lock wait before releasing the first transaction.
- Explicit RLS evidence: current_user=authenticated, session_user=postgres, row_security_active=true, rolsuper=false, rolbypassrls=false. Raw target-graph SELECT returned only the caller's one participant edge; direct INSERT permission was false.
- The server used a private mode-0700 Unix socket with listen_addresses empty. Shutdown completed successfully; pg_ctl status returned 3 (no server running), and both postmaster.pid and the Unix-socket file were absent. The stopped synthetic cluster, extracted packages and logs remain in the temporary workspace for review.
- Independent source review found no actionable SQL/client blocker. The earlier standalone PostgreSQL run correctly stopped because single-user mode bypassed RLS; it is retained as a **superseded diagnostic**, not the current database-test blocker. No assertion was weakened.
- Evidence manifest: docs/qa/private-social-controls-db-results.json. It records the exact commit, source/package/log hashes, execution timestamp, RLS evidence and shutdown proof. Logs are under /tmp/golfme-private-social-pg17-EybDk1 on MGPC/WSL.
- Remaining gaps: full-schema Supabase integration/advisors, real Auth/PostgREST end-to-end, Realtime/APNs delivery and physical-device cross-account behavior. The synthetic auth helper and push sink do not prove those integrations. The held production privilege-metadata query was not retried.
- No production metadata/database call, real-user write, migration-history repair, push or deployment occurred during this validation. Local test approval does not authorize a production migration or publication. Protective backend rules must remain if a frontend rollback is later needed.

### Hardened test-harness setup requirements

The optional harness must run only against a **new, dedicated disposable PostgreSQL cluster**, not an empty database inside an otherwise used local cluster. Preparation commits authenticated, anon and service_role, which are cluster-global roles.

After separately approved setup, start only that test server with the marker:
`-c golfme.test_cluster=private-social-controls-disposable-v1`

The harness also requires the explicit flag `--acknowledge-dedicated-disposable-cluster`. First-time fixture preparation additionally requires `--prepare-empty-synthetic-db`. Existing test-fixture runs require the committed synthetic marker and exact synthetic profile set. The preflight checks schemas, relations, functions, types, other namespaced objects, extensions, policies, large objects, foreign servers, publications/subscriptions and nondefault catalog objects before any fixture setup is committed. Unexpected cluster databases or roles are rejected.

Pending session timers are cleared on child error, exit and close; an ended session rejects new work. Temporary-file cleanup checks the resolved directory first.

Ten race scenarios are now prepared: privacy/follow in both orders, cancellation/acceptance in both orders, block/acceptance, acceptance/removal plus stale replay, opposite-direction follows, duplicate pending requests, and block/new-request in both orders. The harness observes the competing session's real Lock wait before releasing the first transaction. The hardened guards and all ten scenarios have now run successfully on the explicitly approved normal PostgreSQL 17.11 server, with two passing race-suite runs. The server is stopped, and the source migration is unchanged. The remaining Supabase/API/device gaps and release-approval requirements above still apply.

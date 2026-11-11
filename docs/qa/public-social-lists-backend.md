# Public follower/following lists: backend review

Status: production backend applied and catalog-verified on 2026-11-11; matching frontend release pending. Isolated branch feat/public-social-lists-20261111 integrates verified main 7f5259626e919ce2a702486f174692ca77831cf3. Earlier validation sections below retain their historical scope.

## Applied version reconciliation

- Reviewed source: 20261111085135_public_social_lists.sql. Provider-recorded version: 20261111193537_public_social_lists; local filename is now 20261111193537_public_social_lists.sql and the executable fixture include follows it.
- Local SQL bytes remain identical, SHA-256 c985e9fbbbdd51aa7360ef374c0e1e850b0d63fbd479d6d0efd518d55f06d3c1. Production stored SQL was verified to equal the exact approved timeout prefix plus reviewed source.
- Production catalog verification passed; existing privacy protections are unchanged. This local rename is source alignment, not migration-history repair or reapplication. Prior manually installed history gaps remain untouched.
- Authenticated API postchecks and matching frontend publication are separate gates. No frontend push occurred during this reconciliation.

## Scope and permissions

The new migration is supabase/migrations/20261111085135_public_social_lists.sql, generated with installed Supabase CLI 2.121.0 (migration new help inspected). Supabase changelog and function-security documentation were checked; CLI v3 change is not applicable to this pinned installed CLI. Migration SHA-256: c985e9fbbbdd51aa7360ef374c0e1e850b0d63fbd479d6d0efd518d55f06d3c1.

Only the normal owner access gate loses its accepted viewer-to-owner follow requirement. Active authenticated callers can read eligible public-profile connection lists, even with no follow, a pending request, or after removal. The existing account-active, either-direction block and owner-role checks remain. Internal test-only owners still require self or an accepted viewer-to-owner relationship; bot/seeded/app_reviewer exclusion remains absolute. This intentionally does not change special-role eligibility.

Candidate safety is unchanged and separate: active/onboarded/named, no ban/deletion/suspension, visible role, viewer-candidate and owner-candidate block checks, and existing Discoverable/direct-contact requirements. Non-discoverable normal candidates need self or either-direction direct contact with the caller. A hidden candidate is absent from all counts, search matches and rows.

No raw follows policies or table privileges change. The restrictive participant-only SELECT and revoked client INSERT/UPDATE stay. No request/private-setting/accepted-edge mutation is performed by this migration. All follow/request/approval/cancel/remove functions stay unchanged. Their existing shared gate now truthfully reports can_view_connections=true for eligible public owners, including pending requests, without converting pending to accepted.

## New API

golfer_profile_connections_page(p_profile_id uuid, p_kind text='followers', p_limit integer=30, p_search text='', p_cursor jsonb=null)

- Authenticated-only, empty search_path, SECURITY DEFINER required to inspect the protected graph and private safety data.
- Default grants explicitly revoked from PUBLIC, anon, authenticated and service_role; EXECUTE then granted only to authenticated.
- Owner denial: generic 42501 Followers unavailable, without private reason.
- Kind followers/following; limit 1..100. Search is trimmed, case-folded, at most 100 characters.
- Literal substring match on name/username using strpos; %, underscore and backslash never act as wildcards.
- Returns version=2, kind, total, matched_total, mutual_total, profiles, next_cursor.
- total is the current complete eligible tab count; matched_total is its current searched count.
- mutual_total always counts eligible people the viewer follows who follow the owner. It ignores tab and search.
- New row is_mutual uses the same definition on either tab. viewer_following is separately caller-to-candidate accepted follow; viewer_requested means caller-to-candidate pending and not accepted. No request IDs or third-party request facts are exposed.
- Public profiles have a fixed field allowlist matching the existing narrow public profile projection, plus those three booleans. No email, phone, auth fields, role, moderation data or precise coordinates. The fixed allowlist prevents future projection expansion from silently broadening this API.
- Existing golfer_profile_connections and golfer_profile_followers wrappers retain signatures and response shapes for old clients, including count-only limit=0. Their legacy row is_mutual means viewer follows that row; new page clients use the corrected v2 meaning.

## Pagination and concurrent changes

Keyset order is created_at DESC, UUID ASC. The accepted-edge schema enforces created_at NOT NULL; client UPDATE remains revoked and all current follow lifecycle functions INSERT/DELETE rather than altering timestamps. Cursor condition is time less than anchor OR equal time and UUID greater than anchor.

The cursor binds caller, owner, kind and normalized search. Required fields, UUID/timestamp conversion, finite timestamps, future bounds, 24-hour expiry and a 4-KiB payload cap are checked. Invalid/expired cursor returns 22023, instructing refresh. Cursor data is an unsigned position, never authorization; every page reevaluates current safety.

as_of is an insertion-time cutoff, NOT an MVCC snapshot. Current total/matched_total/mutual_total can change while a traversal excludes later insertions. Removing an anchor/earlier row cannot shift the continuation as offset paging does. Newer inserts wait until refresh. Deletions and new blocks hide rows immediately; renamed or newly eligible profiles can enter/leave the searched set. Therefore a traversal is not a frozen historical graph and cannot guarantee seeing rows inserted before the anchor between requests. Reset cursor and replace list after own mutations, search, owner/auth changes, and refresh; deduplicate IDs defensively.

Legacy offset paging remains for compatibility only; the new UI should not fetch every page then client-filter. Indexes cover incoming/outgoing owner plus ordering keys.

## Performance boundaries

Exact safety-filtered counts require work proportional to the owner's two graph degrees. The materialized eligible set scans both directions each request; a page limit bounds response size, not SQL work. No false constant-time/keyset-only claim is made. Search is a literal server-side substring scan over this eligible set, not a full client download.

On a fresh local PostgreSQL 17.11 cluster with 10,000 synthetic incoming edges, EXPLAIN (ANALYZE, BUFFERS) of a 30-row page returned:
- No search: 1,039.110 ms; 160,379 shared-buffer hits.
- Search large10: 1,090.909 ms; 160,381 shared-buffer hits.

This is wrapper-level execution timing, not an internal nested-statement plan or production percentile. The schema is intentionally synthetic; actual Supabase hardware, full profile projection and RLS integration can differ. A 20-second local statement timeout bounded these benchmark checks. Full-schema production-like load testing and a product decision about cached/approximate counts would be required before claiming capacity for much larger/high-traffic graphs. No cache/approximate counts or new privacy semantics were invented.

Index creation is nonconcurrent to support atomic application. Assess table size and the write-lock window before an approved production transaction; no indiscriminate db push or history repair.

## Validation

New guarded fixture: scripts/staging/public-social-lists-authz.sql. It retains all original dedicated-cluster/empty-database guards and deliberately updates only the former follow-dependent access expectations. New race harness: scripts/staging/public-social-lists-races.mjs; original lock scenarios/guards unchanged except selecting the new fixture.

Verified:
- 174 distinct authorization assertions (including existing ACL/RLS/private lifecycle checks) plus the separately rolled-back 10,000-row benchmark assertion.
- Existing accepted edges, pending requests and private settings are snapshotted before migration and unchanged afterwards.
- No-follow, pending and removed-viewer access; test/combined roles, blocks, suspension, bans/deletion; anon forged-subject denial; raw graph/write guard; public payload keys; literal wildcard search; cursor binding/expiry; count/mutual semantics.
- 1,100 tied-timestamp rows traversed completely in 30 pages of up to 37, without duplicates; deleted cursor anchor and newer insertion continuation tested.
- Independent review identified Following-row mutual semantics; fixed before the final SQL test run with a dedicated nonreciprocal following-row regression.
- All ten real two-session lock-contention scenarios passed twice: privacy/follow in both orders, cancel/accept in both orders, block/accept, accept/remove and stale replay, opposite follows, duplicate pending requests, and block/new request in both orders.
- Final reviewed SQL test logs: /tmp/golfme-public-social-reviewed-pg17-2m4bq4rk/{authorization.log,races1.log,races2.log,stop.log} on MGPC/WSL. The fixture subsequently had only a duplicated post-savepoint assertion removed; migration bytes and tested assertions were unchanged.
- Server ran nonroot using the already verified official extracted PG17.11 binaries. Private 0700 Unix socket, no TCP listener, no installation/service/firewall changes. Both earlier temporary servers and the final server were stopped. postmaster.pid and socket absence verified.

The database remains synthetic. Full Supabase/Auth/PostgREST integration/advisors, real Realtime notification delivery, and physical iOS Safari/WKWebView interaction tests are not proven by this fixture. Frontend validation is separate. Independent review found no remaining SQL correctness/security blocker; production release still requires the coordinator's approval and exact-action checks.

## Release and rollback

Apply only this reviewed migration in an explicit transaction after exact release authorization, never replay the prior applied private-social migration or repair unrelated history. Preserve the underlying defensive controls through any frontend rollback. Rollback of this read-only feature may restore the former owner gate and remove the additive RPC/indexes if explicitly approved, but must never drop private settings, pending requests, accepted relationships, participant RLS, or direct-write revocation.

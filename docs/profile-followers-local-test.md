# Followers isolated test result

Date: 2026-11-11. Feature revision: 1b349cb plus final explicit service-role grant removal. No remote/shared migration, live account or production data was used.

## PostgreSQL authorization tests: passed

PostgreSQL 17.11 (Debian 17.11-0+deb13u1), downloaded from the official signed Debian repositories and extracted into a fresh temporary cloud workspace. System packages, services and security settings were not changed.

A fresh cluster and empty golfme_followers_test database were created with synthetic identities only. The cloud runtime did not permit a Unix socket. Therefore the exact fixture SQL ran through PostgreSQL's built-in single-user backend, with psql include/echo directives expanded locally; the endpoint definitions and assertions were unchanged. Explicit SET LOCAL ROLE authenticated/anon assertions passed, including denied endpoint/private-helper access. A separate role probe confirmed the selected test role was not a superuser.

Passed: target visibility, visible-only counts and mutual totals, hidden direct-follow exceptions, unrelated hidden profiles, all viewer/target/follower block directions, active indefinite/future suspensions, expired suspensions, active excluded roles, inactive exclusions, incomplete profiles, pagination order/bounds, count-only calls, generic unavailable errors, anonymous denial and private table/helper grants.

The entire suite rolled back. Follow-up checks confirmed no fixture profiles table, endpoint function or test roles remained. The backend exited; no network listener or database service remains.

Source SHA256:
- scripts/staging/profile-followers-authz.sql: c42630247c3fa1953cc5e6d7e3aff75d18b5fc4fd7ebfa6999cbfce600c5492b
- supabase/migrations/20261111010730_profile_followers_visibility.sql: cad8ed26a74c79d40e81647f8be82dfb14619c9a2398f73777136450aa80ecce

## Hands-on UI demo

A separate loopback-only Vite launcher on MGPC uses dummy backend settings, no environment files, a sample-data banner and a restrictive Content Security Policy blocking external connections. It seeds synthetic localStorage data without a live login. The local artifact launcher is artifacts.local/preview-profile-followers.mjs; it is not a production application change.

While that process is running, open http://127.0.0.1:5192/profile on MGPC. It cannot be opened from another computer or a phone. The Reset control restores the sample data.

1. Tap 3 followers on Jordan Lee's profile. Followers contains three people; Mutuals contains two.
2. Search for Cam or @cam, then clear the search.
3. Open Alex Green and tap 2 followers. Mutuals contains Cam Hill only. Drew Lake is excluded by a two-way block.
4. Unfollow Alex, return to Jordan's profile and confirm mutuals drops to one. Reset to restore the starting scenario.

Independent browser check passed without external test-harness seeding: own/other counts, mutuals, search, navigation, Escape and 320/390/1440px layouts. No page errors or successful external responses. Windows localhost access also passed.

## Original isolated-test limits

The standalone SQL run proves the filtered SQL and role/grant assertions in the synthetic schema, not Supabase Auth/PostgREST wiring, full migration ordering, real concurrent requests, or physical iOS. The UI demo exercises the demo context, not the real API path. These two checks complement each other; neither is a live end-to-end staging test.

Next: separately authorize a full-schema isolated Supabase staging environment with synthetic accounts, run real authenticated API/client tests there, and obtain explicit backend rollout/publication approval. No production rollout is implied by this test result.

## Final SQL delivery review

Read-only metadata on the live project confirmed PostgreSQL 17.6 and matching columns, dependency signatures/bodies, postgres ownership/read/schema-create privileges, and no inherited application-role memberships. Its public function default ACL grants anon/authenticated/service_role; the migration now explicitly clears all of these and grants only authenticated. The private helper has no application-role execute grant.

The synthetic suite passed again with matching default grants and a BYPASSRLS service_role; actual service-role execution is denied. A fresh test cluster used postgres as owner. The atomic SQL Editor wrapper also passed ownership/security/search_path/exact-ACL assertions, a second install safely failed on existing functions, and rollback removed only the two new functions while preserving prerequisite tables. Full npm run check remains 1,251 tests: 1,248 passed, 3 existing skips, no failures.

The installer/rollback deliverables are copies in artifacts.local, with BEGIN/COMMIT and metadata verification. No deployment or remote migration has occurred. Manual SQL Editor application does not update CLI migration history; reconcile version 20261111010730 on the correct project before a future CLI db push. Full Supabase Auth/PostgREST staging remains a release gate.

## Subsequent production-read and integration checks

The user later ran the reviewed installer in production. Read-only verification matched both function bodies and all signatures/ownership/security/search_path/grants. No migration-history row was added. Do not replay the installer or repair history without separate approval.

The existing approved test-account session passed Auth and PostgREST read-only checks: matching identity; count-only and paged v1 responses; visible totals/mutuals; unique narrow profile rows; empty end page with stable totals; generic unavailable and parameter-bound errors. Anonymous endpoint access is denied and the private helper has no exposed route. No business data was modified. This is production read-only smoke, not full Supabase staging.

The integrated frontend on main f0a6b39 passed npm run check (1,283/1,283 tests; no skips/failures), plus the synthetic UI harness at 320/390/1440px. Typecheck/lint/build/prerender passed with 26 existing lint warnings. An independent integration review found no actionable regression, and current Caddie/API code remained unchanged. After explicit session-use permission, the exact reviewed fetch/parser source passed authenticated integration: filtered count/list mapping, unique identities, empty end-page totals, real generic-denial propagation and malformed-response rejection. The credential remained in memory, with six read-only Auth/follower requests and no token output/persistence. Visual new-UI real-account, full-schema staging, cross-account mutations and physical-iOS checks remain unverified. No frontend push has occurred at this milestone.

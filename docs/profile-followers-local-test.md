# Followers isolated test result

Date: 2026-11-11. Feature revision: 1b349cb. No remote/shared migration, live account or production data was used.

## PostgreSQL authorization tests: passed

PostgreSQL 17.11 (Debian 17.11-0+deb13u1), downloaded from the official signed Debian repositories and extracted into a fresh temporary cloud workspace. System packages, services and security settings were not changed.

A fresh cluster and empty golfme_followers_test database were created with synthetic identities only. The cloud runtime did not permit a Unix socket. Therefore the exact fixture SQL ran through PostgreSQL's built-in single-user backend, with psql include/echo directives expanded locally; the endpoint definitions and assertions were unchanged. Explicit SET LOCAL ROLE authenticated/anon assertions passed, including denied endpoint/private-helper access. A separate role probe confirmed the selected test role was not a superuser.

Passed: target visibility, visible-only counts and mutual totals, hidden direct-follow exceptions, unrelated hidden profiles, all viewer/target/follower block directions, active indefinite/future suspensions, expired suspensions, active excluded roles, inactive exclusions, incomplete profiles, pagination order/bounds, count-only calls, generic unavailable errors, anonymous denial and private table/helper grants.

The entire suite rolled back. Follow-up checks confirmed no fixture profiles table, endpoint function or test roles remained. The backend exited; no network listener or database service remains.

Source SHA256:
- scripts/staging/profile-followers-authz.sql: d014170a4031c4abbf9fa1eed9a8032d8425db48dd376a9637d9dd5063a86bae
- supabase/migrations/20261111010730_profile_followers_visibility.sql: 610efca93910d0931aab5d58d96f169278fcef73888a25be469e95a29c5a2f5c

## Hands-on UI demo

A separate loopback-only Vite launcher on MGPC uses dummy backend settings, no environment files, a sample-data banner and a restrictive Content Security Policy blocking external connections. It seeds synthetic localStorage data without a live login. The local artifact launcher is artifacts.local/preview-profile-followers.mjs; it is not a production application change.

While that process is running, open http://127.0.0.1:5192/profile on MGPC. It cannot be opened from another computer or a phone. The Reset control restores the sample data.

1. Tap 3 followers on Jordan Lee's profile. Followers contains three people; Mutuals contains two.
2. Search for Cam or @cam, then clear the search.
3. Open Alex Green and tap 2 followers. Mutuals contains Cam Hill only. Drew Lake is excluded by a two-way block.
4. Unfollow Alex, return to Jordan's profile and confirm mutuals drops to one. Reset to restore the starting scenario.

Independent browser check passed without external test-harness seeding: own/other counts, mutuals, search, navigation, Escape and 320/390/1440px layouts. No page errors or successful external responses. Windows localhost access also passed.

## Remaining limits before release

The standalone SQL run proves the filtered SQL and role/grant assertions in the synthetic schema, not Supabase Auth/PostgREST wiring, full migration ordering, real concurrent requests, or physical iOS. The UI demo exercises the demo context, not the real API path. These two checks complement each other; neither is a live end-to-end staging test.

Next: separately authorize a full-schema isolated Supabase staging environment with synthetic accounts, run real authenticated API/client tests there, and obtain explicit backend rollout/publication approval. No production rollout is implied by this test result.

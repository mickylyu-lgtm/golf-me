# Request rate limits: review and rollout

Status: database migration approved, applied and verified on 2026-11-11. Matching service/frontend release is approved and in progress. No unrelated migration or security-setting changes.

## Threats and scope

GolfMe sends requests directly to Supabase Auth, PostgREST, Storage and Edge Functions, plus three Vercel video APIs. A Vercel-only or browser-only limiter does not protect these separate origins. An in-memory limiter also resets across replicas and deployments.

This patch adds database-backed, authenticated account budgets to five expensive endpoints. Identity comes from verified user authentication and auth.uid(), never client-selected IDs or IP headers. Changing IPs, access tokens or instances does not change the account budget. Anonymous/public keys cannot spend provider credits through course-search or course-enrich.

Each account/action has one private row, at most five rows per account, deleted when its auth account is deleted. No request content, IPs, access tokens, API keys or media are recorded. Callers cannot select, reset, refund or alter limits. Blocked requests do not spend another quota slot. The database uses row locking and samples its clock after lock acquisition.

## Initial thresholds

| Action | Per 60-second window | Per 24-hour window | Charged |
| --- | ---: | ---: | --- |
| Course search / place search | 30 | 600 | All authenticated search attempts before provider calls |
| Course enrichment | 10 | 40 | Uncached enrichment attempts |
| Course photos, outlines, pictures, layouts | 120 | 3,000 | All authenticated requests, including polling |
| Caddie text translation | 12 | 120 | Attempts requiring translation; same-language cached answers are free |
| Chat video | 30 | 120 | Valid authenticated attempts, including repeated/idempotent requests |

These are fixed windows anchored at the first admitted request, not sliding windows or concurrency limits. Near a reset boundary up to twice the window quota can occur in a short interval. Normal batches of ten chat videos fit the burst allowance, but retries also count. Course photos have a higher allowance for batching and detail polling. Heavy legitimate activity can receive a temporary rejection.

An exhausted budget returns HTTP 429, Retry-After seconds, no-store and a safe code. A missing migration, database outage, timeout or malformed answer returns HTTP 503 and blocks provider/transcoding work. This deliberately trades availability of these features for cost safety. Imagery clients honor the pause rather than permanently declaring the function unavailable or bypassing it with direct provider requests.

## Existing controls retained

Repository-defined Caddie protections remain unchanged: 30 delivered analyses per rolling 24 hours, 60 pipeline starts including failures, four attempts per analysis, database enforcement, and client/server duration checks. Reports have a separate 20/hour guard. Course imagery already has shared provider-specific daily caps. Internal extract-frames and trim-video remain secret-authenticated rather than public user APIs. Those existing database settings were not changed by this patch.

## Additional security fixes

- Live course-search v38 had no getUser check, including a place path that returned without any database authorization. It now verifies a non-anonymous user before Geoapify work.
- Course-enrich also verifies a non-anonymous user before reading course data.
- Course-search no longer returns thrown fetch messages or provider bodies that could echo its API-key-bearing URL.
- chat-video's limiter is intentionally self-contained to avoid the prior Vercel missing relative TypeScript packaging failure.

## Validation

- Focused offline tests execute the actual course-search, course-enrich, translation and chat-video handlers with mocked platform/provider wiring, checking 401/429/503 before costly work, cached translations, strict response parsing, CORS/Retry-After, and emitted chat-video JavaScript startup.
- Real PostgreSQL 17.11 test: 28 assertions, 48 simultaneous requests admitting exactly 30, permission denial, forged/anonymous identity rejection, no counter resets, independent accounts/actions, minute/day reset, bounded storage and deletion cascade. Private Unix socket, no TCP listener, fake accounts only, no production connection. Server stopped and socket/PID removal verified. See request-rate-limits-db-results.json.
- Core independent review found no SQL/auth/race blocker. Its imagery recovery finding was fixed with focused tests.
- Final npm run check passed all 1,394 tests on integrated base d453266 with none skipped, TypeScript, lint (26 existing warnings / zero errors), build and prerender. Explicit Node API type check and git diff --check passed. Imagery recovery includes account switches, signout, token refresh and stale responses.
- Deployed entrypoint source was retrieved read-only and exactly matched base 32b39ce: course-search v38, course-enrich v31, course-photos v4, translate-caddie-analysis v22. See request-rate-limits-live-baseline.json.
- Vercel non-strict compiler diagnostics reproduced and fixed with explicit boolean guards; actual non-strict tsc is now a regression test. Independent correction review passed.
- Live authenticated end-to-end 429 recovery, Supabase integration advisors after migration, deployed artifact and physical iOS checks remain rollout gates. No production load/flood test was performed.

## Costs and remaining risks

No dependency or paid service was added. Each guarded request adds one small database RPC; search/enrichment add an Auth user lookup. Counts use the existing database and consume its compute. Provider usage remains charged by existing providers.

This is not infrastructure DDoS protection, a global spending cap, or protection against many separately registered accounts. Authentication/login/email limits are controlled by Supabase Auth, not these app functions. Raw Storage uploads, database writes such as messages/posts/follows, and public asset reads do not pass these guards. File-size/type/ownership rules remain necessary. IP/network attack rules, bot checks, global provider budgets and any upload/write quotas should be reviewed separately before production settings or policies change.

## Coordinated release

1. Obtain explicit approval for exact migration 20261111151846_request_rate_limits.sql. Review the thresholds above. Do not auto-repair historic migration history.
2. Apply only that reviewed migration to GolfMe. Verify function/table definitions, ACLs, RLS, own-account behavior and database advisors. Do not deploy a handler first: it will fail closed with 503.
3. Deploy only the four modified Edge Functions with their shared source. Keep verify_jwt enabled.
4. Publish the reviewed Vercel/frontend patch, ensuring chat-video's emitted artifact is self-contained. Verify exact-commit CI and staging startup before production.
5. Test with a dedicated authorized test account. Verify ordinary flows, rejection headers, recovery and account switching. Do not flood production or call paid providers merely to reach a limit.
6. Monitor normal error rates and legitimate-user rejections during the authorized session. Tune thresholds only with approval.

Rollback: restore previous Edge/Node/frontend versions if legitimate traffic is blocked, understanding this removes the new enforcement. The isolated counter table/RPC can remain unused; no destructive cleanup is needed. Existing Caddie, report, storage and privacy policies must stay intact.

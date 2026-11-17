# Caddie feedback re-share (prepared, not deployed)

## Scope

- One nullable owner-private analysis-to-feedback-post FK; no historical data
  rewritten or posts deleted. `source_post_id` retains its existing meaning.
- An owner-checked RPC locks the analysis and inserts/links the feedback in one
  transaction. Repeated requests, including lost-response retries, return the
  existing post. Structured created/existing/unavailable outcomes avoid implying
  a new post was published when it already exists or was moderated. Client-supplied post IDs/author IDs are not accepted.
- Deleting the linked post nulls its FK and clears the shared flag in the same
  transaction. Moderated (soft-removed) posts stay linked to prevent using this
  feature to evade removal.
- Old boolean-only shares retain their data. The RPC requires an explicit user
  confirmation before recreating these because the old post might still exist.
- Real client uses only the RPC, with no unsafe two-write fallback. Demo retains
  the prior local behavior. The feedback button can recheck persisted state
  even if an earlier screen or missed realtime event still says shared.
- The separate original-media action is labeled “Share swing video”. New copy
  is provided in all six existing languages.

## Approval and rollout

Do not deploy the client before applying the migration. It deliberately fails
closed if the RPC is missing. Production schema/security changes need explicit
approval. Review SECURITY DEFINER code and trigger permission behavior first.
No production changes, pushes or deployments were performed for this draft.

1. Apply the migration to an isolated local/staging database.
2. Run the isolated fixture suite using `scripts/test-caddie-share-db.mjs`
   (setup command in that file). Then repeat equivalent role and end-to-end
   cases against the full staging schema with a disposable test account. The
   fixture SQL creates its own test roles/tables and must not run on an app DB.
3. Verify simultaneous RPCs in two sessions return the same post ID, and a
   competing delete/re-share either succeeds or rolls back cleanly; retry after
   an error must never create two active posts.
4. Check full RLS/permission behavior as anon, another owner, owner, and service
   role; specifically reject direct link forgery and allow FK nulling on owner
   deletion. Check application moderation/rate-limit triggers still apply.
5. UI-check share → delete in Community → reopen analysis → share again, a
   cross-tab delete, a lost RPC response, translated feedback, and historical
   confirmation cancellation/acceptance. The source swing video remains private
   unless the separate video-share action is used.
6. Apply approved migration, then release matching client. Older clients can
   still make unlinked legacy shares and need the explicit confirmation path.

## Risks / rollback

- DDL briefly locks caddie_analyses; assess traffic and table size before rollout.
- Existing sessions using old clients cannot gain reliable associations for
  their two-write sharing flow. No heuristic backfill is performed.
- Removing schema before reverting client breaks sharing. Prefer retaining the
  additive schema/RPC when rolling back the UI; do not drop the link column and
  destroy associations without a deliberate recovery plan.
- No changes to media retention, original-analysis deletion, scoring or model
  behavior. No new public analysis data exposure.

## Verification in this workspace

TypeScript compilation, focused lint, latest production build, and 10 Caddie share helper tests passed. The revised TypeScript and
lint checks also passed.

Executed migration and SQL assertions in an isolated PGlite PostgreSQL runtime:
- Real authenticated role (not just a JWT setting), anon denial, missing JWT,
  cross-owner denial.
- New share, idempotent retry, direct deletion and actual repository deletion
  RPC, FK nulling under authenticated deletion, protected-link clearing denial.
- Legacy confirmation, moderation unavailable outcome, blank/null/oversized
  feedback and objectionable-text rejection, suspension rejection and atomic
  rollback (no orphan post or stale sharing state).

The fixture has reduced table/RLS definitions and loads the repository's actual
filter, suspension and deletion function bodies. It does not reproduce the full
Supabase schema/extension stack or every surrounding trigger. PGlite is
single-session, so it cannot prove cross-session row-lock behavior.

`test-caddie-share-concurrency.py` prepares genuine two-session initial-share,
legacy-confirm and delete/retry tests. It passed on isolated official PostgreSQL 17.6.
It accepts only a loopback DSN and disposable database `caddie_share_test`.
With explicit user authorization, PostgreSQL 17.6 source was downloaded from
`https://ftp.postgresql.org/pub/source/v17.6/`, checked against its official
SHA256 file, and compiled under an isolated cloud-workspace directory. Build
prerequisites came from signed official Debian trixie repositories and were
extracted locally, not installed into the system. The test server listened only
on 127.0.0.1:55439; no system service or MGPC install was made.

The PostgreSQL run passed the SQL suite (including forged INSERT/UPDATE links,
missing/incomplete analysis) and initial+legacy simultaneous share tests. The
runner observed the second session blocked by the first through pg_stat_activity
and pg_blocking_pids before asserting both return the same post ID. Ten real
concurrent deletion/retry races passed with no duplicate active posts.
`scripts/caddie-share-fixture-sql.py` emits the exact disposable setup.

Remaining release gates: full-schema staging RLS/trigger integration; browser/UI + realtime multi-tab behavior; real-account
end-to-end flow. No production schema or deployment changes have been made.

Supabase discovery on 2026-11-17 returned only the existing GolfMe project and
zero development branches. No hosted staging resource has been created, and no
production migration has been applied. Full-schema/browser integration needs a
separate staging environment; a mocked local browser test is not equivalent.

Local full-schema feasibility: the 131 migration files assume Supabase-managed
Auth, Storage, Realtime, pg_net, pg_cron and Vault, and the repo does not include a
local Supabase config/bootstrap. Replacing these with stubs would not constitute
full-schema validation. A dedicated staging branch/project or full local
Supabase stack is still needed for that gate.

`scripts/test-caddie-share-browser.mjs` prepares actual compiled-UI checks with
all Supabase requests mocked and external traffic blocked. It has NOT executed:
Chromium failed at launch with `process_singleton_posix.cc socket() failed:
Operation not permitted`, including an escalated retry. Its assertions are
unverified; run on a browser-capable isolated environment before relying on it.


## Release validation update (2026-11-17)

Independent reviewer replayed the schema in a temporary native local Supabase
stack with real GoTrue/Auth and REST. Owner/nonowner/anon checks, forged link
PATCH denial, blank input, idempotent retry, actual delete RPC, direct deletion,
legacy confirmation and re-sharing passed with synthetic users only. A
production-user-ID-specific data backfill was excluded; copied service URLs
were neutralized. Local stack used PG17.11; isolated concurrency used PG17.6,
matching production's major/minor version. No application/RPC fixes were
required by those tests.

Mocked actual-browser checks passed on MGPC. The test-only corrections now
preserved here wait for previous success toasts to disappear and assert exact
RPC counts after legacy cancellation and stale-state re-sharing. The browser
executable can be specified with CHROMIUM_PATH.

Production preflight found compatible existing tables/triggers, no conflicting
feedback linkage, and small affected tables. Historical migration records do
not enumerate every already-present schema feature: apply ONLY this new
migration, never replay the migration backlog. The schema-only preflight was
saved outside the repo. No production user content is copied into test fixtures.

DDL has 5-second lock and 30-second statement timeouts inside its transaction;
a failed application rolls back as a unit. No existing rows are rewritten by
the migration, so it requires no data backfill/recovery copy. Emergency frontend
rollback target is cdd449770b66d2ba29c22212d737fdb11179ec57; retain the additive
schema and associations rather than deleting accumulated sharing history.

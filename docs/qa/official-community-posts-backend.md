# Official community posts: backend review

Status: LOCAL ONLY. Base main 72e3d3c. No production migration, content, role, push, or deployment change.

## Contract and enforcement

Migration: `supabase/migrations/20261111210916_official_community_posts.sql`, generated using installed Supabase CLI 2.121.0 `migration new`.

- Adds `community_posts.is_official boolean not null default false`. Existing rows remain ordinary.
- `community_post_capabilities()` returns exactly `{"version":1,"can_post_official":boolean}`. Only authenticated has EXECUTE. Missing identity returns false; anonymous and service_role cannot invoke the RPC.
- Authorization is database-derived: existing Auth identity must be non-anonymous, not deleted or currently banned, have active admin role, and not be suspended. No founder ID, email, client flag, or editable user metadata is trusted.
- Creating an official post requires caller = author. The designation and official author/ID are immutable afterward, including for admins; no relabeling historical personal posts.
- An official post's non-moderation/non-analysis fields and associated media-row edits require current eligibility. This closes the former-admin edit path. Whole-post deletion remains under existing own-post DELETE permission and media FK cleanup works.
- Service updates to swing_analysis_status and removed_at/removed_by/removed_reason remain possible. Existing moderation and suspension triggers still enforce their own rules.
- No table grants, RLS policies, audience, ranking, notifications, role grants, public-directory rules, or Storage rules are changed. Official does not mean globally visible or pinned.
- All new privileged functions have empty search_path and fully qualified relations. Private helper/trigger EXECUTE is revoked from PUBLIC/anon/authenticated/service_role. Public capability EXECUTE is also revoked from defaults before granting authenticated.

## Checks completed

`python3 scripts/staging/official-community-posts.py /path/to/existing/pg-runtime`

58 assertions passed on PostgreSQL 17.11, using a newly created disposable cluster, Unix socket permissions 0700, no TCP listener, no production credentials or calls. The runner stops its own cluster in finally and verifies the PID/socket are gone. It uses repository base post/media table and policy SQL and extracts existing role/suspension/moderation functions and applies the existing media-cap migration to exercise their interaction. Results: `docs/qa/official-community-posts-db-results.json`.

Coverage: ordinary/admin/coach/anon/no-identity/service paths; author forgery; immutable designation and identity; revoked/anonymous/banned/deleted/suspended admins; direct post/media writes; private/default grants; fixed search paths; existing rows and unchanged policies/table grants; normal posting/editing; service analysis/moderation; removed-post visibility and whole-post cascade.

This is not a full Supabase Auth/PostgREST deployment test, full production-schema migration rehearsal, Storage-content integrity test, or physical-device test. Role checks have ordinary PostgreSQL statement-snapshot semantics, not cross-transaction revocation serialization.

## Rollout

The migration is additive but **requires separate production-application authorization**. Publication alone is not authorization to apply it. Deploying the frontend first is compatible: missing capability keeps the toggle unavailable and ordinary inserts omit the new field.

Before authorized application: verify exact target, current definitions and relevant dependencies, and review the final SQL bytes. Execute the migration atomically through the migration runner. For a manual approved transaction, use BEGIN, SET LOCAL lock_timeout='5s', SET LOCAL statement_timeout='30s', migration body, COMMIT. ADD COLUMN with constant false default on modern Postgres is metadata-only but needs an ACCESS EXCLUSIVE lock; timeout/failure must roll back the entire transaction. Never retry an uncertain application without checking catalogs/history first.

Postchecks: column/default/NOT NULL, exact function bodies/search paths/effective grants, triggers, unchanged RLS/grants, normal posting compatibility and authenticated capability behavior. Do not make test announcements using the owner's real account. Verify an authorized test admin/member pair separately before calling live posting verified.

Rollback preference: roll back frontend while retaining the additive backend. Once announcements exist, dropping the column loses their official designation and is not a safe unapproved rollback. Do not remove guards while retaining the flag.

## Remaining boundaries

Existing public Storage objects are not made immutable by this change. A former admin who still owns an object can exercise existing Storage permissions; these guards protect database metadata/media rows, not object bytes. No new Storage permissions or bypass are introduced.

The existing client publishes post and media in separate requests. Revocation between them can reject media after post insertion. Frontend must handle this explicitly (remove the newly created post if safe and confirmed, or report partial publication without inventing successful media or inviting a duplicate retry). Do not silently downgrade an official request to an ordinary post.

Supabase function/RLS documentation and current changelog were consulted. CLI v3 breaking changes do not apply to the pinned installed v2 CLI; no CLI upgrade performed.

## Read-only production catalog compatibility check

On 2026-11-11, metadata-only inspection of the verified GolfMe project confirmed required auth.users columns (id UUID, is_anonymous boolean, deleted_at/banned_until timestamptz), matching private.has_role(uuid,text)/private.is_suspended(uuid) definitions and postgres ownership, post/media schema, trigger inventory, and existing policies. Both target tables have RLS enabled. The new column and capability RPC are absent, as expected before installation.

Production anon/authenticated/service_role have table-level SELECT/INSERT/UPDATE/DELETE privileges; RLS is what denies ordinary anonymous access. The synthetic fixture now mirrors these grants rather than testing denial only at the privilege layer. Existing media-cap triggers are included and their atomic failure is checked.

No customer rows, credentials or post contents were inspected; no production mutation was performed. This compatibility check is not a full-schema migration execution or Auth/PostgREST integration test. Existing notification fanout/content-filter/feed-signal triggers were inspected by catalog, not executed in the synthetic fixture.

# Public social lists: read-only release audit

Audit date: 2026-11-11. No production changes, migration-history changes, real-record reads, secret-value reads, push or deployment occurred during this audit. This file records observations, not release approval.

## Source and integration

Remote main was ea54fac6b2c0b7a4f1b50ffb3d31a0e7b851a898, two commits ahead of the worktree base f5d3329d9f98faa37758c5e352b138700fdee84c. Remote changes concerned admin-user search and documentation; no changed-file overlap with the then-current public-list worktree was found. Integrate latest main and recheck before release.

Reviewed migration: 20261111085135_public_social_lists.sql. SHA-256: c985e9fbbbdd51aa7360ef374c0e1e850b0d63fbd479d6d0efd518d55f06d3c1. It broadens the shared eligible-owner graph gate, adds the paginated authenticated RPC and two ordered indexes, and changes function comments/grants. It does not mutate follows, requests, private settings, roles or lifecycle functions. The helper change immediately affects legacy graph RPCs and follow-state access flags too.

CI, package scripts and repository Vercel configuration do not run SQL or db push. Vercel dashboard overrides/integrations were not checked.

## Live metadata verification

Only narrow pg_catalog metadata, function-body hashes, normalized search_path and ACL declarations were read. All 18 deployed private-social function-body MD5 hashes matched released migration 20261111082608_private_social_controls.sql. Ownership was postgres; empty search_path, execution modes and intended public-RPC/private-helper ACLs matched the source declarations. The new page RPC was absent.

Public follows retains RLS, permissive participant SELECT plus its restrictive participant guard, and own-follower DELETE. Client INSERT/UPDATE grants are absent. Private follow_requests retains RLS and owner-only table ACL. Both UUID columns and created_at on follows are NOT NULL. The block cancellation trigger remains enabled as BEFORE INSERT FOR EACH ROW and targets private.cancel_requests_on_block. This is metadata verification, not a live multi-account runtime test.

## Index size and locking

Catalog estimate: 355 follows rows, 7 heap pages, 57,344 heap bytes and 147,456 total relation bytes. Estimates are not exact row counts. Existing valid/ready indexes were follows_following_id_idx (following_id; 16,384 bytes) and follows_pkey (follower_id, following_id; 49,152 bytes). Neither new index name exists, and neither existing index provides the full requested ordered keys.

The new nonconcurrent incoming/outgoing indexes should require little build work at this size. CREATE INDEX takes SHARE locks that conflict with writes, and locks last until transaction completion. Waiting on other transactions can dominate build time; zero interruption is not guaranteed. Exact safety-filtered counts still scan both graph directions: pagination bounds payload, not database work.

## Separate inherited risks, not remediated

The existing follows ACL additionally grants anon/authenticated TRUNCATE, REFERENCES, TRIGGER and MAINTAIN. These are unnecessary dangerous privileges and are not protected by the row SELECT/DELETE policies in the same way as ordinary row operations; TRUNCATE specifically bypasses RLS. This audit did not attempt those operations. They predate this change and do not establish a directly exposed PostgREST exploit, but must not be described as least privilege. They remain unremediated and require separately scoped review/authorization.

Supabase security advisors reported pg_net in public and leaked-password protection disabled, plus authenticated SECURITY DEFINER function warnings and RLS-without-policy notices for private tables including follow_requests. The latter notices do not alone imply a bypass when access is deliberately denied and mediated by reviewed RPCs. No new migration-specific advisor regression is claimed before application.

## Future approved execution and rollback

Release remains coordinator-owned. Verify the exact migration, current main and database prerequisites again, obtain exact DDL approval, then apply backend before releasing its dependent frontend. Do not replay earlier migrations or repair unrelated history.

For a runner whose managed transaction is verified, prepend SET LOCAL lock_timeout = '5s'; and SET LOCAL statement_timeout = '30s'; inside that transaction. Do not add nested BEGIN/COMMIT: PostgreSQL does not provide nested transactions through BEGIN, and an embedded COMMIT can defeat runner-controlled atomicity. SET LOCAL must not be sent in a separate request or outside the managed transaction. These bounds are per lock acquisition/per statement rather than a guaranteed overall release wall-clock bound.

Official endpoint contract verified from the current Supabase for Platforms guide, "Make database changes": "This endpoint will automatically create a migration inside the `supabase_migrations` schema and run the migration. If the schema migration fails, the changes will be rolled back." This supplies the provider's migration rollback guarantee for POST /v1/projects/{ref}/database/migrations, beyond the sparse OpenAPI description. Use the managed migration execution path, not a separate execute_sql call plus history repair. Keep the reviewed SQL together, with the two SET LOCAL statements and without embedded BEGIN/COMMIT.

Precision limit: that guide does not separately specify internal transaction boundaries or explicitly describe history-row behavior on failure; the connector tool description does not expose its implementation. Do not embellish the quote into an independently verified implementation guarantee. Read-only schema/history verification after any failure or uncertain transport outcome is still necessary before retrying. No production transaction experiment was performed.

Frontend rollback can retain the additive backend. An explicitly approved rollback may restore the former owner gate and remove the new RPC/indexes, but must coordinate with loaded clients. Never remove private settings, pending requests, accepted follows or protective policies/grants. Physical iOS and full real Auth/PostgREST/Realtime behavior remain separate verification limits.

## Sources

- https://github.com/mickylyu-lgtm/golf-me/commit/ea54fac6b2c0b7a4f1b50ffb3d31a0e7b851a898
- https://supabase.com/docs/guides/integrations/supabase-for-platforms#make-database-changes (current markdown fetched; migration recording and rollback quote above)
- https://api.supabase.com/api/v1-json (read-only official OpenAPI; v1-apply-a-migration, V1CreateMigrationBody)
- https://supabase.com/docs/guides/deployment/database-migrations
- https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

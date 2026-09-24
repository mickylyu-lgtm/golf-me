-- P0 (Health Audit P1-8, confirmed against production 2026-09-23): the
-- community-media bucket's SELECT policy granted every role -- including
-- anon -- read access to storage.objects for the whole bucket. That doesn't
-- matter for serving files (a public bucket's /object/public/ URLs bypass
-- RLS entirely), but it DOES make the Storage list API work for anyone with
-- the anon key, which ships in the web bundle. Reproduced: an anonymous
-- client could enumerate every user folder and discover private
-- direct-upload Caddie swing videos/thumbnails, then fetch them by URL.
--
-- Fix: replace the bucket-wide read policy with owner-only read. Public
-- community-post media keeps loading (public-URL serving never consults
-- this policy); owners keep SELECT on their own folder, which Storage
-- needs for their own list/remove/upsert calls. INSERT/UPDATE/DELETE
-- policies, bucket visibility, object paths and every existing object are
-- untouched. avatars is intentionally public and deliberately NOT changed.
--
-- Scope limit: this stops DISCOVERY only. Anyone who already holds a
-- Caddie object URL can still fetch it (public bucket, unguessable paths).
-- Genuinely private Caddie media (private bucket + signed URLs) is tracked
-- as a separate future security item, not done here.
--
-- Rollback (restores the exact prior state):
--   drop policy community_media_select_own on storage.objects;
--   create policy community_media_public_read on storage.objects
--     for select using (bucket_id = 'community-media');

drop policy community_media_public_read on storage.objects;

create policy community_media_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'community-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

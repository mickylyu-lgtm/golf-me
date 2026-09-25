-- Remaining 0g: private Caddie uploads move to a genuinely private bucket.
--
-- Direct-upload Caddie swing videos/thumbnails (and analyze-swing's trimmed
-- copies) used to live in the PUBLIC `community-media` bucket. Since
-- 20260923120000 nobody can LIST that bucket anonymously, but a public
-- object URL never expires, so anyone who ever held one could still fetch
-- the file. This migration adds the private home for them; the app, the
-- analyze-swing Edge Function and the backfill script
-- (scripts/migrate-caddie-media-private.ts) move the files.
--
-- 1. New private bucket `caddie-media` (public = false, same 200 MB cap as
--    community-media). Objects live at `<owner uid>/<file>`, exactly the
--    path convention community-media already uses. Owner-only RLS:
--      * select -- lets the owner create signed URLs (playback) and copy /
--        download their own file (Share to Community copies into
--        community-media at publish time);
--      * insert -- the client's upload, and analyze-swing's trimmed-copy
--        upload (it runs with the caller's JWT, not the service role);
--      * delete -- lets the client clean up an upload whose analysis never
--        got created, and analyze-swing remove the untrimmed original once
--        its trimmed copy replaced it.
--    No update policy: nothing overwrites an object in place (no upsert).
--    Service role (delete-account purge, backfill script) bypasses RLS.
--
-- 2. caddie_analyses gets `source_media_path` / `thumbnail_path`: object
--    paths inside caddie-media. Storing the path (not a URL) means nothing
--    durable ever holds a credential or an expiring link; the client turns
--    a path into a short-lived signed URL when it renders. A row uses EITHER
--    a path (private direct upload) OR the old public URL (Ask Caddie on a
--    Community post, whose media is public by the user's own choice, and
--    legacy rows until the backfill repoints them) -- so source_media_url
--    becomes nullable, with a check that at least one is set.
--    The path columns are pinned to the row owner's own folder, so a client
--    (caddie_analyses_update_own has no column limits) can't point its row
--    at someone else's object -- storage RLS would refuse to sign it anyway;
--    this keeps the stored data honest too.
--
-- Unchanged on purpose:
--   * community-media and its policies. Community posts stay public, and a
--     shared Caddie video is a separate public COPY made at publish time, so
--     a public post never depends on a private object.
--   * delete_community_post (20260924110000). It only ever returns
--     community-media paths, and posts can only reference community-media
--     objects, so no caddie-media object can be returned. Its caddie_analyses
--     reference check still reads source_media_url/thumbnail_url, which is
--     exactly right: those columns now only hold PUBLIC references (Ask
--     Caddie on a post, or legacy rows not yet backfilled). A share copy is
--     referenced only by its post, so deleting that post now removes the
--     public copy while the private original stays with the analysis.
--   * The persisted-job model (status/processing/complete/failed rows).
--
-- Rollback (only before any row has a path / any object is in caddie-media):
--   alter table public.caddie_analyses drop constraint caddie_analyses_media_present;
--   alter table public.caddie_analyses drop constraint caddie_analyses_media_path_owner;
--   alter table public.caddie_analyses drop constraint caddie_analyses_thumbnail_path_owner;
--   alter table public.caddie_analyses alter column source_media_url set not null;
--   alter table public.caddie_analyses drop column source_media_path, drop column thumbnail_path;
--   drop policy caddie_media_select_own on storage.objects;
--   drop policy caddie_media_insert_own on storage.objects;
--   drop policy caddie_media_delete_own on storage.objects;
--   delete from storage.buckets where id = 'caddie-media';  -- only if empty

insert into storage.buckets (id, name, public, file_size_limit)
values ('caddie-media', 'caddie-media', false, 209715200)
on conflict (id) do nothing;

create policy caddie_media_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'caddie-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy caddie_media_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'caddie-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy caddie_media_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'caddie-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter table public.caddie_analyses
  add column source_media_path text,
  add column thumbnail_path text;

alter table public.caddie_analyses
  alter column source_media_url drop not null;

alter table public.caddie_analyses
  add constraint caddie_analyses_media_present
    check (source_media_url is not null or source_media_path is not null);

alter table public.caddie_analyses
  add constraint caddie_analyses_media_path_owner
    check (
      source_media_path is null
      or (split_part(source_media_path, '/', 1) = owner_id::text
          and position('..' in source_media_path) = 0
          and length(source_media_path) <= 512)
    );

alter table public.caddie_analyses
  add constraint caddie_analyses_thumbnail_path_owner
    check (
      thumbnail_path is null
      or (split_part(thumbnail_path, '/', 1) = owner_id::text
          and position('..' in thumbnail_path) = 0
          and length(thumbnail_path) <= 512)
    );

comment on column public.caddie_analyses.source_media_path is
  'Object path in the private caddie-media bucket (<owner uid>/<file>). When set, it is the video; clients render it via a short-lived signed URL. source_media_url is then null.';
comment on column public.caddie_analyses.thumbnail_path is
  'Object path in the private caddie-media bucket for the poster frame. See source_media_path.';
comment on column public.caddie_analyses.source_media_url is
  'PUBLIC community-media URL: Ask Caddie on a Community post, or a legacy direct upload not yet moved to caddie-media. Null when source_media_path is set.';

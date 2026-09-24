-- Health audit Batch E, P2-10 (post half): deleting a Community post never
-- removed its Storage objects, so a deleted post's photos/video/thumbnail
-- stayed publicly reachable in the public `community-media` bucket.
--
-- Storage objects can't be deleted from SQL (storage.protect_delete blocks
-- direct DELETEs on storage.objects -- only the Storage API may remove
-- them), so this is split in two:
--   1. This RPC deletes the post (same author-only rule as the existing
--      community_posts_delete_own policy) and, in the same transaction,
--      works out which of that post's media objects are now unreferenced.
--      It runs as SECURITY DEFINER so the reference check sees EVERY row
--      in every table, not just what the caller's RLS would show.
--   2. The client removes exactly the returned paths via the Storage API,
--      where community_media_delete_own still limits it to the caller's
--      own folder.
--
-- What "still referenced" means -- any other row pointing at the same
-- object keeps it:
--   * caddie_analyses.source_media_url / thumbnail_url. Since Batch C
--     (20260924100000), deleting a Swing Post keeps its Ask-Caddie analysis
--     (converted to direct_upload) with source_media_url pointing at the
--     post's video, and "Share to Community" reuses a Caddie analysis's
--     video/thumbnail URLs for the new post. Both must survive.
--   * any other community_posts video_url / video_thumbnail_url /
--     image_url, and any community_post_media media_url / thumbnail_url
--     (the same analysis can be shared more than once).
-- The check runs AFTER the post delete, so the FK's ON DELETE SET NULL on
-- caddie_analyses.source_post_id (and the Batch C trigger's conversion)
-- has already happened and those analyses are counted as references.
--
-- Only objects inside the caller's own folder (`<auth.uid()>/...`) are
-- ever returned, so a post that references someone else's URL can never
-- cause their object to be removed. Matching is on the object path inside
-- the public URL, so a different host/prefix still counts as a reference
-- (false positives only ever mean a file is kept, never wrongly deleted).
--
-- Returns the object paths (relative to the community-media bucket) that
-- are safe to remove. Returns an empty array if the post doesn't exist
-- (already deleted -- same idempotent behavior as the old direct DELETE).
create or replace function public.delete_community_post(p_post_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_author_id uuid;
  v_marker constant text := '/storage/v1/object/public/community-media/';
  v_urls text[];
  v_paths text[];
begin
  if v_uid is null then
    raise exception 'Not authenticated.';
  end if;

  select author_id into v_author_id
  from public.community_posts
  where id = p_post_id
  for update;

  if v_author_id is null then
    return '{}'::text[];
  end if;
  if v_author_id <> v_uid then
    raise exception 'You can only delete your own posts.';
  end if;

  select coalesce(array_agg(distinct u), '{}'::text[]) into v_urls
  from (
    select unnest(array[p.video_url, p.video_thumbnail_url, p.image_url]) as u
    from public.community_posts p
    where p.id = p_post_id
    union all
    select unnest(array[m.media_url, m.thumbnail_url])
    from public.community_post_media m
    where m.post_id = p_post_id
  ) s
  where u is not null;

  -- Cascades community_post_media / comments / votes / saved / hidden, and
  -- detaches (keeps) any Ask-Caddie analysis via the Batch C conversion.
  delete from public.community_posts where id = p_post_id;

  select coalesce(array_agg(distinct c.path), '{}'::text[]) into v_paths
  from (
    select split_part(split_part(u, v_marker, 2), '?', 1) as path
    from unnest(v_urls) as u
    where position(v_marker in u) > 0
  ) c
  where c.path like v_uid::text || '/%'
    and c.path not like '%..%'
    and not exists (
      select 1 from public.caddie_analyses a
      where position(v_marker || c.path in coalesce(a.source_media_url, '')) > 0
         or position(v_marker || c.path in coalesce(a.thumbnail_url, '')) > 0
    )
    and not exists (
      select 1 from public.community_posts p
      where position(v_marker || c.path in coalesce(p.video_url, '')) > 0
         or position(v_marker || c.path in coalesce(p.video_thumbnail_url, '')) > 0
         or position(v_marker || c.path in coalesce(p.image_url, '')) > 0
    )
    and not exists (
      select 1 from public.community_post_media m
      where position(v_marker || c.path in coalesce(m.media_url, '')) > 0
         or position(v_marker || c.path in coalesce(m.thumbnail_url, '')) > 0
    );

  return v_paths;
end;
$$;

revoke execute on function public.delete_community_post(uuid) from public, anon;
grant execute on function public.delete_community_post(uuid) to authenticated;

-- Health audit Batch C, P1-2: deleting a Swing Post that has an Ask-Caddie
-- analysis failed with "Source post not found." (and so did deleting the
-- owner's account, which cascades through community_posts the same way).
--
-- Root cause: caddie_analyses.source_post_id is `on delete set null`
-- (20260817090000). Postgres applies that as an UPDATE on the analysis row,
-- which fires enforce_caddie_community_post_ownership() (BEFORE UPDATE,
-- 20260817091500) while source_type is still 'community_post' -- the trigger
-- looks up the (now-null) post, finds nothing, and raises. Even without the
-- trigger, caddie_analyses_source_consistency would reject a
-- community_post row with a null source_post_id.
--
-- Product decision (Micky, 2026-09-24): keep the private analysis when its
-- post is deleted, so the user's Caddie history survives. The analysis is
-- converted to a direct upload -- source_media_url, thumbnail, results and
-- everything else stay exactly as they were; only the link to the deleted
-- post goes away. The community-media objects themselves are not deleted by
-- the post-delete path, so the saved video URL keeps working.
--
-- The conversion only applies when source_post_id goes from a value to NULL
-- on a community_post row -- which is exactly what the FK's SET NULL does.
-- An owner doing the same thing by hand to their own row just gets the same
-- harmless conversion (caddie_analyses_update_own already limits it to
-- their own rows); every other insert/update still gets the original
-- ownership check unchanged.
create or replace function public.enforce_caddie_community_post_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_author_id uuid;
begin
  if tg_op = 'UPDATE'
     and old.source_type = 'community_post'
     and new.source_type = 'community_post'
     and old.source_post_id is not null
     and new.source_post_id is null then
    new.source_type := 'direct_upload';
    return new;
  end if;

  if new.source_type = 'community_post' then
    select author_id into v_post_author_id from public.community_posts where id = new.source_post_id;
    if v_post_author_id is null then
      raise exception 'Source post not found.';
    end if;
    if v_post_author_id <> new.owner_id then
      raise exception 'Ask Caddie is only available on your own posts.';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_caddie_community_post_ownership() from public, anon, authenticated;

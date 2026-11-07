-- At most 10 photos/videos per Community post, enforced in the database
-- (Micky, 2026-11-06). The app already caps a post at 10
-- (MAX_POST_MEDIA_ITEMS in pages/CreatePost.tsx, slot ledger in
-- lib/postMediaLedger.ts); this is the server-side backstop, so an older or
-- modified client can't attach more.
--
-- What it does: refuses a community_post_media row that would make its post
-- hold more than 10 rows, on INSERT and on an UPDATE that moves a row to
-- another post. Error: SQLSTATE 23514 (check_violation) with
-- hint 'community_post_media_cap'. A multi-row insert that would pass 10 is
-- refused as a whole (one statement, all or nothing).
--
-- Existing posts are never touched: no row is deleted or rewritten, reads
-- are unchanged, deleting media is unchanged, and an update that keeps a
-- row on its post (any other column) is not checked at all. A post that
-- already holds more than 10 keeps them all; it just can't gain more.
-- RLS and the existing policies are unchanged (users have no UPDATE policy
-- on this table; the UPDATE case covers service-role / dashboard edits).
--
-- Concurrency: the check runs AFTER the row is written (so it counts every
-- row of the same statement) under a per-post transaction advisory lock, so
-- two concurrent inserts into one post can't both see room for one more.
-- SECURITY DEFINER so the count sees every row of the post regardless of
-- the caller's RLS (select is already open to every signed-in user).

create function private.community_post_media_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('community_post_media_cap:' || new.post_id::text, 0));
  select count(*) into v_count from public.community_post_media where post_id = new.post_id;
  if v_count > 10 then
    raise exception 'A post can have at most 10 photos or videos.'
      using errcode = 'check_violation', hint = 'community_post_media_cap';
  end if;
  return null;
end;
$$;

revoke all on function private.community_post_media_cap() from public, anon, authenticated;

create trigger community_post_media_cap_insert
  after insert on public.community_post_media
  for each row execute function private.community_post_media_cap();

create trigger community_post_media_cap_move
  after update of post_id on public.community_post_media
  for each row
  when (old.post_id is distinct from new.post_id)
  execute function private.community_post_media_cap();

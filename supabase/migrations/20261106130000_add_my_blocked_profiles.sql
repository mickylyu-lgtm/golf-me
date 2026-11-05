-- Settings -> Safety -> Blocked golfers: names for the caller's own blocks
-- (2026-11-05). NOT APPLIED. Independent of 20261106130100.
--
-- Why: after 20261106120000 (golfer directory, step 1), every way the client
-- resolves another golfer (golfer_directory, golfer_public_profiles) drops
-- anyone blocked either way, and the blocked list never asked for them, so
-- on a cold reload Settings had no profile for a blocked contact and left
-- the row out: the block stayed, the Unblock button vanished. The client
-- now lists every block row the caller owns whatever happens here (a
-- "Blocked contact" fallback label); this function only puts a name and
-- avatar on the rows where that is safe.
--
-- my_blocked_profiles(): for golfers the CALLER blocked, and only while that
-- golfer has NOT also blocked the caller, return id, name and avatar fields.
-- Nothing else (no bio, area, coordinates, handicap, stats).
--   - Why showing these is safe: the caller already knew this person (they
--     picked them to block) and could read the same name/avatar through
--     golfer_public_profiles right up to the moment they blocked them.
--   - Never for someone who blocked the caller: that would let a blocked
--     user read their blocker's profile by blocking them back. That row
--     shows the fallback label instead.
--   - It can't list anyone new: the rows are the caller's own blocks
--     (blocks_insert_own requires blocker_id = auth.uid()), and a block on
--     a random id returns nothing more than golfer_public_profiles already
--     would for that id.
--   - Deleted accounts: blocks cascade on auth.users delete, so their rows
--     are already gone.
-- No directory, search or by-id rule changes. Blocks policies unchanged
-- (select: either party; insert/delete: blocker only; no update).
--
-- ROLLBACK: drop function if exists public.my_blocked_profiles();
-- (The client then shows "Blocked contact" for any row it can't name.)

create function public.my_blocked_profiles()
returns table (
  id uuid,
  name text,
  avatar_color text,
  avatar_initials text,
  photo_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.avatar_color, p.avatar_initials, p.photo_url
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where (select auth.uid()) is not null
    and b.blocker_id = (select auth.uid())
    and not exists (
      select 1 from public.blocks back
      where back.blocker_id = b.blocked_id and back.blocked_id = b.blocker_id
    )
  order by b.created_at desc
  limit 500;
$$;

comment on function public.my_blocked_profiles() is
  'Settings unblock list: id, name, avatar for golfers the caller blocked, unless they also blocked the caller. Nothing else; never lists anyone the caller did not block.';

revoke execute on function public.my_blocked_profiles() from public, anon;
grant execute on function public.my_blocked_profiles() to authenticated;

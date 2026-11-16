-- ---------------------------------------------------------------------------
-- 20261116120000_following_feed
--
-- Home's "Following" feed, server-side: posts (swing posts included) by the
-- golfers the caller follows, newest first, one keyset page at a time.
-- Before this, Home filtered the posts Community had already loaded, so a
-- followed golfer's post outside that load never reached Home.
--
-- public.get_following_feed(p_before, p_limit, p_before_id)
--   p_before     null = first page; else the created_at of the last row of
--                the previous page.
--   p_limit      page size, clamped to 1..50 (default 20).
--   p_before_id  the id of that same last row (tie-break for posts sharing a
--                created_at). Optional: without it the page starts strictly
--                before p_before.
--   Returns setof public.community_posts: the exact row shape of the
--   client's `community_posts.select("*")`, so the existing row mapper
--   (RealCommunityContext rowToPost) and PostCard are unchanged.
--
-- Visibility: SECURITY INVOKER, so every RLS policy the Community feed is
-- read under applies unchanged. The rules, and where they come from:
--   * removed by an admin, and authors suspended with hide_content (own
--     posts excepted): community_posts_select_authenticated
--     (20261107270000_admin_moderation, section 4). Applied by RLS.
--   * deleted accounts: community_posts.author_id cascades on delete
--     (20260816143600), so their posts no longer exist.
--   * blocks, either direction: not in the posts policy; the Community feed
--     drops them client-side (DataContext.visiblePosts, and
--     golfer_public_profiles() returns no profile across a block). Re-checked
--     here explicitly. The blocks SELECT policy
--     (20260813210000, blocks_select_own_or_against_self) lets the caller
--     read rows on both sides of a block that involves them, which is all
--     this check needs, so it works under invoker.
--   * posts the caller hid: client-side in the Community feed
--     (realCommunity.isPostHidden); re-checked here against
--     public.hidden_posts (own rows readable, hidden_posts_select_own).
--   * follows: public.follows, follower_id = auth.uid(); follows_no_self
--     means the caller's own posts are never included.
-- Not filtered, matching the Community feed: auth.users.banned_until (the
-- feed has never filtered on it; only the notification fan-out does) and
-- private.notification_fanout_muted_users (a push/bell opt-out, not a
-- content mute). There is no user-level content mute table.
--
-- Index: (author_id, created_at desc, id desc) so each followed author's
-- newest posts are read in order; community_posts_author_id_idx alone has no
-- created_at.
--
-- No table, policy or existing function is changed. Execute: authenticated
-- only. Rollback:
--   drop function if exists public.get_following_feed(timestamptz, integer, uuid);
--   drop index if exists public.community_posts_author_created_idx;
-- ---------------------------------------------------------------------------

create index if not exists community_posts_author_created_idx
  on public.community_posts (author_id, created_at desc, id desc);

create or replace function public.get_following_feed(
  p_before timestamptz default null,
  p_limit integer default 20,
  p_before_id uuid default null
)
returns setof public.community_posts
language sql
stable
security invoker
set search_path = ''
as $$
  select p.*
  from public.community_posts p
  where (select auth.uid()) is not null
    and exists (
      select 1 from public.follows f
      where f.follower_id = (select auth.uid()) and f.following_id = p.author_id
    )
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = p.author_id)
         or (b.blocker_id = p.author_id and b.blocked_id = (select auth.uid()))
    )
    and not exists (
      select 1 from public.hidden_posts h
      where h.owner_id = (select auth.uid()) and h.post_id = p.id
    )
    and (
      p_before is null
      or p.created_at < p_before
      or (p_before_id is not null and p.created_at = p_before and p.id < p_before_id)
    )
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.get_following_feed(timestamptz, integer, uuid) is
  'Home Following feed: posts by golfers the caller follows, newest first, keyset paged by (created_at, id). SECURITY INVOKER (posts RLS applies: removed / hidden-author); blocks either way and own hidden posts excluded. Page size 1..50.';

revoke execute on function public.get_following_feed(timestamptz, integer, uuid) from public, anon;
grant execute on function public.get_following_feed(timestamptz, integer, uuid) to authenticated;

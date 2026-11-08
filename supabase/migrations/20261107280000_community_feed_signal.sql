-- ---------------------------------------------------------------------------
-- 20261107280000_community_feed_signal
--
-- Problem (follow-up to 20261107270000_admin_moderation): a feed that is
-- already open on another device can keep showing removed content.
--   * Removal is an UPDATE that makes the row unreadable under the new
--     SELECT policies. Supabase Realtime checks each subscriber's RLS on
--     the NEW row before sending a postgres_changes UPDATE, so the other
--     users (the very people who must stop seeing it) are never told.
--   * "Hide their posts and comments" on a suspension changes only
--     private.user_suspensions, which nothing subscribes to.
-- Clients then only catch up on the next unrelated Community event or
-- when the app returns to the foreground.
--
-- Fix: a content-free signal. public.community_feed_version is one row
-- (id = 1) holding an opaque counter. It is bumped when content is removed
-- or restored, and when a suspension that hides content starts, changes or
-- is lifted. Every signed-in client can read it and receives its Realtime
-- UPDATE, then refetches the feed through the normal RLS-checked selects.
-- The payload is only {id: 1, version: n}: no post/comment id, text,
-- media, reason or author, so it reveals nothing about which rows became
-- unreadable (only that "something in Community changed").
--
-- RLS: enabled, SELECT for authenticated only, no INSERT/UPDATE/DELETE
-- policy and those privileges revoked from anon/authenticated. Only the
-- SECURITY DEFINER triggers below write it.
-- Triggers (owner-only functions, search_path ''):
--   * community_posts / community_comments AFTER UPDATE OF removed_at, when
--     removed_at actually changes (admin RPCs, SQL editor, anything).
--   * private.user_suspensions AFTER INSERT/UPDATE/DELETE, when hide_content
--     is (or was) true. A hide suspension that simply EXPIRES has no event:
--     that content reappears on the next refetch (foreground/any event).
--
-- Needs 20261107270000 (refuses to apply without it). The client feature-
-- detects the table: without it (or on any read error) it keeps the old
-- behaviour (refetch on events + on returning to the foreground).
-- CHECK: feed-signal-check.sql. ROLLBACK: feed-signal-rollback.sql.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('private.user_suspensions') is null then
    raise exception '20261107270000_admin_moderation is not applied. Nothing was changed.';
  end if;
end $$;

create table public.community_feed_version (
  id smallint primary key default 1 check (id = 1),
  version bigint not null default 0
);
insert into public.community_feed_version (id, version) values (1, 0);

alter table public.community_feed_version enable row level security;
create policy community_feed_version_select_authenticated on public.community_feed_version
  for select to authenticated using (true);
revoke all on table public.community_feed_version from anon;
revoke insert, update, delete, truncate, references, trigger on table public.community_feed_version from authenticated;
grant select on table public.community_feed_version to authenticated;

alter publication supabase_realtime add table public.community_feed_version;

create function private.bump_community_feed_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.community_feed_version set version = version + 1 where id = 1;
  return null;
end;
$$;
revoke execute on function private.bump_community_feed_version() from public, anon, authenticated;

create trigger community_posts_feed_signal
  after update of removed_at on public.community_posts
  for each row
  when (old.removed_at is distinct from new.removed_at)
  execute function private.bump_community_feed_version();

create trigger community_comments_feed_signal
  after update of removed_at on public.community_comments
  for each row
  when (old.removed_at is distinct from new.removed_at)
  execute function private.bump_community_feed_version();

create trigger user_suspensions_feed_signal_insert
  after insert on private.user_suspensions
  for each row
  when (new.hide_content)
  execute function private.bump_community_feed_version();

create trigger user_suspensions_feed_signal_update
  after update on private.user_suspensions
  for each row
  when (old.hide_content or new.hide_content)
  execute function private.bump_community_feed_version();

create trigger user_suspensions_feed_signal_delete
  after delete on private.user_suspensions
  for each row
  when (old.hide_content)
  execute function private.bump_community_feed_version();

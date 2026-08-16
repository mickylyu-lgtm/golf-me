-- Real Follow backend. Previously followUser/unfollowUser/isFollowing were
-- 100% local mock-array mutations, unbranched on isDemo, keyed off the mock
-- data blob's default currentUserId rather than the real authenticated
-- user's uuid -- meaning even within one real session, the write and the
-- read used two different identities, which is why Follow never reliably
-- showed as "Following." This is a genuine new table, not a bug fix to
-- existing real infrastructure -- no follows backend existed before this.
create table public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);
comment on table public.follows is 'One row per real follow relationship. Composite primary key is the uniqueness guard against duplicate follows; follows_no_self blocks following yourself at the database level, not just in the client.';

create index follows_following_id_idx on public.follows (following_id);

alter table public.follows enable row level security;

-- Broadly readable, same posture as golf_calls/courses -- who-follows-whom
-- isn't sensitive the way blocks/reports are, and both Find Friends and any
-- future "followers" display need to read relationships that aren't
-- necessarily the caller's own.
create policy follows_select_authenticated on public.follows
  for select to authenticated
  using (true);

create policy follows_insert_own on public.follows
  for insert to authenticated
  with check (follower_id = (select auth.uid()));

create policy follows_delete_own on public.follows
  for delete to authenticated
  using (follower_id = (select auth.uid()));

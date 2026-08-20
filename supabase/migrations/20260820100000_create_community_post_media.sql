-- Multiple images/videos per Community post (Instagram-style, swipeable
-- when there's more than one). A post's single legacy image_url/video_url
-- columns stay untouched — swing posts keep using video_url exclusively
-- (that column is tied to Caddie/coach-review semantics that only make
-- sense for one designated video), and old single-photo posts keep
-- rendering from image_url. This table is additive: new multi-photo posts
-- populate it instead, ordered by `position`.
create table public.community_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  media_url text not null,
  thumbnail_url text,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create index community_post_media_post_id_idx on public.community_post_media (post_id, position);

alter table public.community_post_media enable row level security;

-- Same visibility as the post itself (community_posts_select_authenticated
-- is `true` for any authenticated user — this is a public feed).
create policy community_post_media_select_authenticated
  on public.community_post_media for select
  to authenticated
  using (true);

-- Insert/delete only by the post's own author, mirroring
-- community_posts_insert_own/_delete_own (this table has no author_id of
-- its own, so check it via the parent post).
create policy community_post_media_insert_own
  on public.community_post_media for insert
  to authenticated
  with check (exists (select 1 from public.community_posts p where p.id = post_id and p.author_id = (select auth.uid())));

create policy community_post_media_delete_own
  on public.community_post_media for delete
  to authenticated
  using (exists (select 1 from public.community_posts p where p.id = post_id and p.author_id = (select auth.uid())));

alter publication supabase_realtime add table public.community_post_media;

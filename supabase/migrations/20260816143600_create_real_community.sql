-- Real Community backend. Previously 100% local: createPost()/createComment()/
-- toggleUpvote()/etc. only ever mutated an in-memory + localStorage blob, no
-- Supabase call anywhere -- confirmed by inspection before writing this
-- migration, not assumed. Worse, every real account's posts/comments were
-- attributed to a fixed mock placeholder id (data.currentUserId, never
-- updated for real accounts), not the real author -- real content looked
-- like it came from a mock persona instead of the person who wrote it.
create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('text', 'photo', 'course', 'round', 'swing')),
  text text not null default '',
  image_url text,
  video_url text,
  course_tag text,
  golf_call_id uuid references public.golf_calls(id) on delete set null,
  category text not null check (category in ('General', 'Memes', 'Course Talk', 'Equipment', 'Tips & Advice', 'Round Stories', 'Looking to Play')),
  -- 'not_applicable' for every non-swing post type; swing posts start
  -- 'pending' the moment the video finishes uploading. See
  -- src/lib/swingAnalysis.ts for why this never becomes 'complete' with
  -- fabricated results until a real analysis provider is connected.
  swing_analysis_status text not null default 'not_applicable' check (swing_analysis_status in ('not_applicable', 'pending', 'processing', 'complete')),
  created_at timestamptz not null default now()
);
create index community_posts_created_at_idx on public.community_posts (created_at desc);
create index community_posts_author_id_idx on public.community_posts (author_id);

create table public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) > 0),
  parent_comment_id uuid references public.community_comments(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index community_comments_post_id_idx on public.community_comments (post_id);

create table public.community_post_votes (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, voter_id)
);

create table public.community_comment_votes (
  comment_id uuid not null references public.community_comments(id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, voter_id)
);

-- Private per-user lists -- no reason for anyone but the owner to read these.
create table public.saved_posts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.community_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, post_id)
);

create table public.hidden_posts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.community_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, post_id)
);

alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_post_votes enable row level security;
alter table public.community_comment_votes enable row level security;
alter table public.saved_posts enable row level security;
alter table public.hidden_posts enable row level security;

-- Posts/comments/votes: shared feed, same open-select posture as
-- golf_calls/courses/follows -- blocked-author filtering happens
-- client-side (visiblePosts()) exactly as it did in the mock version,
-- reusing the same real blocks relationship, not a second block list.
create policy community_posts_select_authenticated on public.community_posts for select to authenticated using (true);
create policy community_posts_insert_own on public.community_posts for insert to authenticated with check (author_id = (select auth.uid()));
create policy community_posts_update_own on public.community_posts for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy community_posts_delete_own on public.community_posts for delete to authenticated using (author_id = (select auth.uid()));

create policy community_comments_select_authenticated on public.community_comments for select to authenticated using (true);
create policy community_comments_insert_own on public.community_comments for insert to authenticated with check (author_id = (select auth.uid()));
create policy community_comments_delete_own on public.community_comments for delete to authenticated using (author_id = (select auth.uid()));

create policy community_post_votes_select_authenticated on public.community_post_votes for select to authenticated using (true);
create policy community_post_votes_insert_own on public.community_post_votes for insert to authenticated with check (voter_id = (select auth.uid()));
create policy community_post_votes_delete_own on public.community_post_votes for delete to authenticated using (voter_id = (select auth.uid()));

create policy community_comment_votes_select_authenticated on public.community_comment_votes for select to authenticated using (true);
create policy community_comment_votes_insert_own on public.community_comment_votes for insert to authenticated with check (voter_id = (select auth.uid()));
create policy community_comment_votes_delete_own on public.community_comment_votes for delete to authenticated using (voter_id = (select auth.uid()));

create policy saved_posts_select_own on public.saved_posts for select to authenticated using (owner_id = (select auth.uid()));
create policy saved_posts_insert_own on public.saved_posts for insert to authenticated with check (owner_id = (select auth.uid()));
create policy saved_posts_delete_own on public.saved_posts for delete to authenticated using (owner_id = (select auth.uid()));

create policy hidden_posts_select_own on public.hidden_posts for select to authenticated using (owner_id = (select auth.uid()));
create policy hidden_posts_insert_own on public.hidden_posts for insert to authenticated with check (owner_id = (select auth.uid()));
create policy hidden_posts_delete_own on public.hidden_posts for delete to authenticated using (owner_id = (select auth.uid()));

-- Real media storage -- photo/swing-video uploads no longer become base64
-- data-URLs stuffed into localStorage (which would blow past its ~5-10MB
-- cap almost immediately for a video). 200MB per-object cap is generous for
-- a short swing clip while still bounding worst-case storage cost.
insert into storage.buckets (id, name, public, file_size_limit)
values ('community-media', 'community-media', true, 209715200)
on conflict (id) do nothing;

create policy community_media_public_read on storage.objects
  for select using (bucket_id = 'community-media');
create policy community_media_insert_own on storage.objects
  for insert to authenticated with check (bucket_id = 'community-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy community_media_update_own on storage.objects
  for update to authenticated using (bucket_id = 'community-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy community_media_delete_own on storage.objects
  for delete to authenticated using (bucket_id = 'community-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter publication supabase_realtime add table public.community_posts;
alter publication supabase_realtime add table public.community_comments;
alter publication supabase_realtime add table public.community_post_votes;

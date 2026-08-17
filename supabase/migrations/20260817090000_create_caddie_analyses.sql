-- Caddie: per-user AI swing-analysis history. Strictly private by
-- construction — every RLS policy scopes to owner_id = auth.uid(), no
-- select policy exists for any other role/relationship, so "another real
-- user must not see private AI Caddie feedback" is enforced at the
-- database, not just hidden in the UI (same posture as saved_posts/
-- hidden_posts). No real analysis provider exists yet (see
-- src/lib/swingAnalysis.ts) — status stays 'pending' forever until one is
-- connected; this table's job today is proving a real, durable per-user
-- history exists, not producing real feedback.
create table public.caddie_analyses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('direct_upload', 'community_post')),
  source_post_id uuid references public.community_posts(id) on delete set null,
  source_media_url text not null,
  swing_type text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'complete', 'failed')),
  analysis_summary text,
  strengths text[] not null default '{}',
  issues text[] not null default '{}',
  recommendations text[] not null default '{}',
  drills text[] not null default '{}',
  -- Only ever flips true via an explicit "Share Caddie Feedback" action on a
  -- community_post-sourced analysis that has real (status = 'complete')
  -- content — never automatic. No code path can set this today since
  -- status never reaches 'complete', which is intentional, not a bug.
  shared_to_community boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- direct_upload rows must carry no post reference; community_post rows must.
alter table public.caddie_analyses
  add constraint caddie_analyses_source_consistency check (
    (source_type = 'direct_upload' and source_post_id is null)
    or (source_type = 'community_post' and source_post_id is not null)
  );

create index caddie_analyses_owner_id_idx on public.caddie_analyses(owner_id, created_at desc);
create index caddie_analyses_source_post_id_idx on public.caddie_analyses(source_post_id) where source_post_id is not null;

alter table public.caddie_analyses enable row level security;

create policy caddie_analyses_select_own on public.caddie_analyses
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy caddie_analyses_insert_own on public.caddie_analyses
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy caddie_analyses_update_own on public.caddie_analyses
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy caddie_analyses_delete_own on public.caddie_analyses
  for delete to authenticated
  using (owner_id = (select auth.uid()));

create trigger set_caddie_analyses_updated_at
  before update on public.caddie_analyses
  for each row execute function public.set_updated_at();

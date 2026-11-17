-- Disposable local database ONLY. Reduced schema, not a full Supabase replica.
create role anon;
create role authenticated;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema public, auth to authenticated, anon;
create table public.community_posts (
 id uuid primary key default gen_random_uuid(), author_id uuid not null,
 type text, text text, category text, swing_analysis_status text,
 removed_at timestamptz, video_url text, video_thumbnail_url text, image_url text, course_tag text
);
create table public.community_post_media (post_id uuid references public.community_posts on delete cascade, media_url text, thumbnail_url text);
create table public.caddie_analyses (
 id uuid primary key, owner_id uuid not null, status text,
 shared_to_community boolean not null default false, source_media_url text, thumbnail_url text
);
create table private.user_suspensions(user_id uuid primary key, suspended_until timestamptz);
create table private.blocked_terms(term text, pattern text, enabled boolean default true, match_mode text);
insert into private.blocked_terms values('fixture_blocked_text','fixture_blocked_text',true,'substring');
alter table public.caddie_analyses enable row level security;
alter table public.community_posts enable row level security;
create policy own_analysis on public.caddie_analyses to authenticated using (owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy read_posts on public.community_posts for select to authenticated using(removed_at is null);
create policy own_post_insert on public.community_posts for insert to authenticated with check(author_id=auth.uid());
create policy own_post_delete on public.community_posts for delete to authenticated using(author_id=auth.uid());
grant select, insert, update, delete on public.caddie_analyses, public.community_posts to authenticated;
insert into public.caddie_analyses(id,owner_id,status) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','complete');

create role anon; create role authenticated;
create schema auth; create schema private;
create table auth.users(id uuid primary key,banned_until timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
create table private.user_suspensions(user_id uuid,suspended_until timestamptz);
create function private.is_suspended(p_user_id uuid) returns boolean language sql stable as $$
 select exists(select 1 from private.user_suspensions where user_id=p_user_id and (suspended_until is null or suspended_until>now())) $$;
create table public.community_posts(id uuid primary key,author_id uuid,removed_at timestamptz,image_url text,video_url text,video_thumbnail_url text);
create table public.community_post_media(id uuid primary key,post_id uuid,position smallint,media_type text,media_url text,thumbnail_url text);
create table public.blocks(blocker_id uuid,blocked_id uuid);
create table public.hidden_posts(owner_id uuid,post_id uuid);
create table public.golf_calls(id uuid primary key,host_user_id uuid,status text,course_name text,course_area_label text,date_iso timestamptz,tee_time_label text);
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
insert into community_posts values('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002',null,'https://adokdenbmpshqgjbzshb.supabase.co/storage/v1/object/public/community-media/a/photo.jpg',null,null);
insert into golf_calls values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','open','Test Course','Test City','2026-12-10T12:00:00Z','7:00 AM');

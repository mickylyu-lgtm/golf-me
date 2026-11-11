-- SYNTHETIC LOCAL TEST ONLY. Never run against a user-data/linked project.
-- Requires an empty disposable database named EXACTLY golfme_followers_test
-- and a local test superuser (roles are created only in this rollback transaction).
-- Run: psql -X -v ON_ERROR_STOP=1 -d golfme_followers_test -f scripts/staging/profile-followers-authz.sql
-- This does not test or change the production database.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() <> 'golfme_followers_test' or to_regclass('public.profiles') is not null then
    raise exception 'Refusing: use an EMPTY disposable golfme_followers_test database, never production.';
  end if;
end $$;
create schema auth;
create schema private;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
grant usage on schema public, auth to authenticated, anon;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create table public.profiles (id uuid primary key, name text, username text, avatar_color text, avatar_initials text, photo_url text, has_onboarded boolean default true, discoverable boolean default true);
create table public.follows (follower_id uuid, following_id uuid, created_at timestamptz default '2026-01-01', primary key(follower_id,following_id), check(follower_id<>following_id));
create table public.blocks (blocker_id uuid, blocked_id uuid, primary key(blocker_id,blocked_id));
create table public.user_roles (user_id uuid, role text, active boolean default true);
create table private.user_suspensions (user_id uuid primary key, suspended_until timestamptz);
alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.user_roles enable row level security;
alter table private.user_suspensions enable row level security;
revoke all on private.user_suspensions from public, anon, authenticated;
create function private.has_block_between(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.blocks where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a));
$$;
create function private.is_directory_excluded(uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_roles where user_id=uid and active and role in ('test','app_reviewer','bot','seeded'));
$$;
create function private.is_suspended(uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.user_suspensions where user_id=uid and (suspended_until is null or suspended_until>now()));
$$;
-- Mirrors the existing projection's auth/block contract; only fixture
-- identity columns are needed to exercise the new authorization endpoint.
create function public.golfer_public_profiles(p_ids uuid[]) returns table(id uuid,name text,username text,avatar_color text,avatar_initials text,photo_url text)
language sql stable security definer set search_path='' as $$
 select p.id,p.name,p.username,p.avatar_color,p.avatar_initials,p.photo_url from public.profiles p
 where p.id=any(p_ids[1:200]) and auth.uid() is not null and (p.id=auth.uid() or not private.has_block_between(auth.uid(),p.id));
$$;
\ir ../../supabase/migrations/20261111010730_profile_followers_visibility.sql

-- All ids/names are artificial. 1=viewer;2=target;20=hidden target.
insert into public.profiles(id,name,username,avatar_initials)
select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Fixture '||i,'fixture'||i,'FX' from generate_series(1,23) i;
update public.profiles set discoverable=false where id::text in (select '00000000-0000-0000-0000-'||lpad(i::text,12,'0') from unnest(array[4,5,19,20,21,22]) i);
update public.profiles set has_onboarded=false where id='00000000-0000-0000-0000-000000000016';
update public.profiles set name='  ' where id='00000000-0000-0000-0000-000000000017';
insert into public.follows(follower_id,following_id)
select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000002' from unnest(array[3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,21,22,23]) i;
insert into public.follows(follower_id,following_id) values
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003'),
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000018'),
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000019'),
('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000020');
-- Even direct contacts may not bypass hard exclusions.
insert into public.follows(follower_id,following_id)
select '00000000-0000-0000-0000-000000000001',('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid from unnest(array[6,7,8,9,10,12,13,14,15,16,17,23]) i;
insert into public.blocks values
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006'),
('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000008'),
('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000002');
insert into private.user_suspensions values
('00000000-0000-0000-0000-000000000010',null),
('00000000-0000-0000-0000-000000000023',now()+interval '1 day'),
('00000000-0000-0000-0000-000000000011',now()-interval '1 day');
insert into public.user_roles(user_id,role) values
('00000000-0000-0000-0000-000000000012','test'),
('00000000-0000-0000-0000-000000000013','bot'),
('00000000-0000-0000-0000-000000000014','seeded'),
('00000000-0000-0000-0000-000000000015','app_reviewer');
insert into public.user_roles(user_id,role,active) values ('00000000-0000-0000-0000-000000000003','test',false),('00000000-0000-0000-0000-000000000003','pre_launch',true);
create function public.check_followers_test(ok boolean,label text) returns void language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if;
end $$;

set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ declare r jsonb; ids text[]; begin
 r:=public.golfer_profile_followers('00000000-0000-0000-0000-000000000002',100,0);
 perform public.check_followers_test(r->>'total'='5' and r->>'mutual_total'='3','same permitted counts');
 select array_agg(x->>'id' order by x->>'id') into ids from jsonb_array_elements(r->'followers') x;
 perform public.check_followers_test(ids=array[
 '00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004',
 '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000018',
 '00000000-0000-0000-0000-000000000019'],'public and direct hidden only; expiry allowed; every exclusion removed');
 r:=public.golfer_profile_followers('00000000-0000-0000-0000-000000000002',0,0);
 perform public.check_followers_test(r->>'total'='5' and jsonb_array_length(r->'followers')=0,'count-only');
 r:=public.golfer_profile_followers('00000000-0000-0000-0000-000000000002',2,0);
 perform public.check_followers_test(r->'followers'->0->>'id'='00000000-0000-0000-0000-000000000003' and r->'followers'->1->>'id'='00000000-0000-0000-0000-000000000004','stable page ordering');
 r:=public.golfer_profile_followers('00000000-0000-0000-0000-000000000002',2,4);
 perform public.check_followers_test(r->>'total'='5' and jsonb_array_length(r->'followers')=1 and r->'followers'->0->>'id'='00000000-0000-0000-0000-000000000019','last page with full totals');
 r:=public.golfer_profile_followers('00000000-0000-0000-0000-000000000002',2,5);
 perform public.check_followers_test(r->>'total'='5' and jsonb_array_length(r->'followers')=0,'empty page with full totals');
 r:=public.golfer_profile_followers('00000000-0000-0000-0000-000000000001',100,0);
 perform public.check_followers_test(r->>'total'='1','own hidden incoming direct follower retained');
end $$;
-- Identical unavailable response for missing/hidden/incomplete/excluded/suspended targets.
do $$ declare id uuid; begin
 foreach id in array array[
 '00000000-0000-0000-0000-000000000099'::uuid,'00000000-0000-0000-0000-000000000020',
 '00000000-0000-0000-0000-000000000016','00000000-0000-0000-0000-000000000012',
 '00000000-0000-0000-0000-000000000010',null] loop
   begin
     perform public.golfer_profile_followers(id,100,0);
     raise exception 'FAIL: denied target returned rows';
   exception when insufficient_privilege then
     perform public.check_followers_test(sqlerrm='Followers unavailable.','generic unavailable');
   end;
 end loop;
 begin perform private.can_list_follower_profile(auth.uid(),auth.uid()); raise exception 'FAIL: private helper callable'; exception when insufficient_privilege then null; end;
 begin perform public.golfer_profile_followers('00000000-0000-0000-0000-000000000002',101,0); raise exception 'FAIL: over-limit'; exception when invalid_parameter_value then null; end;
 begin perform public.golfer_profile_followers('00000000-0000-0000-0000-000000000002',1,-1); raise exception 'FAIL: negative offset'; exception when invalid_parameter_value then null; end;
 begin perform public.golfer_profile_followers('00000000-0000-0000-0000-000000000002',1,100001); raise exception 'FAIL: clamped offset'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
-- A direct relationship allows the hidden target, but never bypasses a block.
insert into public.follows(follower_id,following_id) values ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001');
set local role authenticated;
select public.check_followers_test(public.golfer_profile_followers('00000000-0000-0000-0000-000000000020',100,0)->>'total'='1','direct hidden target allowed');
reset role;
insert into public.blocks values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020');
set local role authenticated;
do $$ begin
 begin perform public.golfer_profile_followers('00000000-0000-0000-0000-000000000020',100,0); raise exception 'FAIL: viewer-target block ignored'; exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.blocks where blocked_id='00000000-0000-0000-0000-000000000020';
insert into public.blocks values ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$ begin
 begin perform public.golfer_profile_followers('00000000-0000-0000-0000-000000000020',100,0); raise exception 'FAIL: target-viewer block ignored'; exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claim.sub='';
do $$ begin
 begin perform public.golfer_profile_followers('00000000-0000-0000-0000-000000000002',100,0); raise exception 'FAIL: null auth accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select public.check_followers_test(not has_function_privilege('anon','public.golfer_profile_followers(uuid,integer,integer)','execute'),'anon execute revoked');
select public.check_followers_test(not has_function_privilege('authenticated','private.can_list_follower_profile(uuid,uuid)','execute'),'helper execute revoked');
select public.check_followers_test(not has_table_privilege('authenticated','private.user_suspensions','select'),'suspensions private');
set local role anon;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ begin
 begin perform public.golfer_profile_followers('00000000-0000-0000-0000-000000000002',100,0); raise exception 'FAIL: anon executed endpoint'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo 'PASS: synthetic follower endpoint authorization, counts, paging and grants; all fixtures rolled back.'

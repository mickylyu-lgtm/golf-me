-- SYNTHETIC LOCAL TEST ONLY. Dedicated disposable cluster and empty DB; never a linked/used cluster.
-- Start the authorized test server with: -c golfme.test_cluster=private-social-controls-disposable-v1
-- Roles are cluster-global; this script rolls them back, but race-harness preparation commits them.
-- psql -X -v ON_ERROR_STOP=1 -d golfme_private_social_test -f scripts/staging/private-social-controls-authz.sql
-- A standalone PostgreSQL runner may expand the three \ir directives before execution.
\set ON_ERROR_STOP on
begin;
do $$ begin
 if current_setting('golfme.test_cluster',true) is distinct from 'private-social-controls-disposable-v1' then
 raise exception 'Refusing: dedicated disposable cluster marker is required.'; end if;
 if exists(select 1 from pg_database where datname not in('postgres','template0','template1','golfme_private_social_test'))
 or exists(select 1 from pg_roles where rolname !~ '^pg_' and rolname not in(session_user,'authenticated','anon','service_role')) then
 raise exception 'Refusing: cluster contains unexpected databases or roles; use a dedicated disposable cluster.'; end if;
 if current_database()<>'golfme_private_social_test'
 or exists(select 1 from pg_namespace where nspname not in('public','information_schema') and nspname !~ '^pg_')
 or exists(select 1 from pg_class where relnamespace='public'::regnamespace)
 or exists(select 1 from pg_proc where pronamespace='public'::regnamespace)
 or exists(select 1 from pg_type where typnamespace='public'::regnamespace)
 or exists(select 1 from pg_operator where oprnamespace='public'::regnamespace)
 or exists(select 1 from pg_opclass where opcnamespace='public'::regnamespace)
 or exists(select 1 from pg_opfamily where opfnamespace='public'::regnamespace)
 or exists(select 1 from pg_conversion where connamespace='public'::regnamespace)
 or exists(select 1 from pg_collation where collnamespace='public'::regnamespace)
 or exists(select 1 from pg_ts_config where cfgnamespace='public'::regnamespace)
 or exists(select 1 from pg_ts_dict where dictnamespace='public'::regnamespace)
 or exists(select 1 from pg_ts_parser where prsnamespace='public'::regnamespace)
 or exists(select 1 from pg_ts_template where tmplnamespace='public'::regnamespace)
 or exists(select 1 from pg_extension where extname<>'plpgsql')
 or exists(select 1 from pg_event_trigger)
 or exists(select 1 from pg_foreign_server)
 or exists(select 1 from pg_foreign_data_wrapper)
 or exists(select 1 from pg_publication)
 or exists(select 1 from pg_subscription)
 or exists(select 1 from pg_largeobject_metadata)
 or exists(select 1 from pg_default_acl)
 or exists(select 1 from pg_policy)
 or exists(select 1 from pg_statistic_ext)
 or exists(select 1 from pg_transform)
 or exists(select 1 from pg_am where oid>=16384)
 or exists(select 1 from pg_cast where oid>=16384)
 or exists(select 1 from pg_language where oid>=16384)
 or exists(select 1 from pg_operator where oid>=16384)
 or exists(select 1 from pg_opclass where oid>=16384)
 or exists(select 1 from pg_opfamily where oid>=16384)
 or exists(select 1 from pg_conversion where oid>=16384)
 or exists(select 1 from pg_collation where oid>=16384)
 or exists(select 1 from pg_ts_config where oid>=16384)
 or exists(select 1 from pg_ts_dict where oid>=16384)
 or exists(select 1 from pg_ts_parser where oid>=16384)
 or exists(select 1 from pg_ts_template where oid>=16384)
 -- Also reject custom objects deliberately placed in a system namespace.
 or exists(select 1 from pg_class where oid>=16384)
 or exists(select 1 from pg_proc where oid>=16384)
 or exists(select 1 from pg_type where oid>=16384)
 then raise exception 'Refusing: use an EMPTY dedicated disposable golfme_private_social_test database, never production.'; end if;
end $$;
create schema auth; create schema private; create schema vault;
create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
grant usage on schema public,auth to authenticated,anon,service_role;
alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function public.u(n integer) returns uuid language sql immutable as $$select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
create table auth.users(id uuid primary key,banned_until timestamptz,deleted_at timestamptz);
create table public.profiles(id uuid primary key references auth.users(id),name text,username text,avatar_color text,avatar_initials text,photo_url text,has_onboarded boolean default true,discoverable boolean default true,language text default 'en');
create table public.follows(follower_id uuid references auth.users(id),following_id uuid references auth.users(id),created_at timestamptz not null default '2026-01-01',primary key(follower_id,following_id),check(follower_id<>following_id));
create table public.blocks(blocker_id uuid,blocked_id uuid,primary key(blocker_id,blocked_id));
create table public.user_roles(user_id uuid,role text,active boolean default true);
create table private.user_suspensions(user_id uuid primary key,suspended_until timestamptz);
create table vault.decrypted_secrets(name text,decrypted_secret text); -- deliberately EMPTY
create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid,type text,actor_id uuid,text text,link_to text,created_at timestamptz default now(),constraint notifications_type_check check(type in('new_follower','new_message','round_joined','round_left','round_cancelled','comment_reply','post_reply','round_created_from_post','post_became_round','booking_proof_attached','tee_time_updated','booking_proof_removed','caddie_analysis_complete','new_round_nearby','circle_post','post_liked')));
alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.user_roles enable row level security;
alter table private.user_suspensions enable row level security;
create policy profiles_select_authenticated on public.profiles for select to authenticated using(true);
create policy profiles_update_own on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy follows_select_authenticated on public.follows for select to authenticated using(true);
create policy follows_insert_own on public.follows for insert to authenticated with check(follower_id=(select auth.uid()));
create policy follows_delete_own on public.follows for delete to authenticated using(follower_id=(select auth.uid()));
create policy blocks_select_own on public.blocks for select to authenticated using((select auth.uid()) in(blocker_id,blocked_id));
create policy blocks_insert_own on public.blocks for insert to authenticated with check(blocker_id=(select auth.uid()));
create policy blocks_delete_own on public.blocks for delete to authenticated using(blocker_id=(select auth.uid()));
grant select,insert,update,delete on public.follows to authenticated;
grant select,update on public.profiles to authenticated;
grant select,insert,delete on public.blocks to authenticated;
create function private.has_block_between(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.blocks where (blocker_id=a and blocked_id=b) or(blocker_id=b and blocked_id=a));$$;
create function private.is_directory_excluded(uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_roles where user_id=uid and active and role in('test','app_reviewer','bot','seeded'));$$;
create function private.is_suspended(uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.user_suspensions where user_id=uid and(suspended_until is null or suspended_until>now()));$$;
create function private.fanout_golfer_fallback(lang text) returns text language sql immutable as $$select 'Golfer'::text$$;
-- Synthetic push implementation: local sink only. No network/provider calls.
create table public.test_pushes(recipient uuid,title text,body text,link text);
create function private.send_round_push(secret text,recipient uuid,title text,body text,link text,unused text) returns void language sql as $$
 insert into public.test_pushes values(recipient,title,body,link);$$;
create function public.golfer_public_profiles(p_ids uuid[]) returns table(id uuid,name text,username text,avatar_color text,avatar_initials text,photo_url text)
language sql stable security definer set search_path='' as $$
 select p.id,p.name,p.username,p.avatar_color,p.avatar_initials,p.photo_url from public.profiles p
 where p.id=any(p_ids[1:200]) and auth.uid() is not null and(p.id=auth.uid() or not private.has_block_between(auth.uid(),p.id));$$;
-- Real legacy triggers/helpers and prior endpoint, not reimplemented approximations.
\ir ../../supabase/migrations/20261108150000_follow_notifications.sql
\ir ../../supabase/migrations/20261111010730_profile_followers_visibility.sql
\ir ../../supabase/migrations/20261111082608_private_social_controls.sql
insert into auth.users(id) select u(i) from generate_series(1,60) i;
insert into public.profiles(id,name,username,avatar_initials) select u(i),'Fixture '||i,'fixture'||i,'FX' from generate_series(1,60) i;
create table public.test_results(label text);
grant insert,select on public.test_results to authenticated,anon,service_role;
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if;
 insert into public.test_results values(label);
end$$;
create function public.test_denied(q text,label text,expected text default '42501') returns void language plpgsql as $$
begin
 begin execute q; raise exception 'FAIL: unexpected success: %',label;
 exception when others then
 if sqlstate<>expected then raise exception 'FAIL: % got [%] %',label,sqlstate,sqlerrm; end if;
 end;
 perform public.test_assert(true,label);
end$$;
-- Graph fixtures: excluded identities and every three-party block pairing.
update public.profiles set discoverable=false where id in(u(4),u(5));
update public.profiles set has_onboarded=false where id=u(12);
update public.profiles set name='  ' where id=u(13);
insert into public.user_roles values(u(6),'test',true),(u(7),'test',true),(u(8),'test',true),(u(8),'bot',true),(u(15),'app_reviewer',true),(u(16),'bot',true),(u(17),'seeded',true),(u(18),'test',false),(u(18),'pre_launch',true);
insert into private.user_suspensions values(u(9),null),(u(14),now()-interval '1 day');
insert into public.blocks values(u(1),u(10)),(u(11),u(2));
insert into public.follows(follower_id,following_id) select u(i),u(2) from unnest(array[1,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18])i;
insert into public.follows(follower_id,following_id) values(u(1),u(3)),(u(1),u(6)),(u(1),u(8)),(u(5),u(1)),(u(2),u(3)),(u(2),u(4)),(u(2),u(6)),(u(2),u(7)),(u(2),u(19));
-- Verify upgrade does not change pre-existing accepted edges, privacy or pending requests.
update public.profiles set is_private=true where id=u(59);
insert into private.follow_requests(requester_id,target_id,status) values(u(58),u(59),'pending');
create temp table before_public_migration as select
 (select jsonb_agg(to_jsonb(f) order by follower_id,following_id) from follows f) follows,
 (select jsonb_agg(to_jsonb(r) order by requester_id,target_id) from private.follow_requests r) requests,
 (select jsonb_agg(jsonb_build_array(id,is_private) order by id) from profiles) privacy;
\ir ../../supabase/migrations/20261111085135_public_social_lists.sql
select test_assert((select follows is not distinct from (select jsonb_agg(to_jsonb(f) order by follower_id,following_id) from follows f)
 and requests is not distinct from (select jsonb_agg(to_jsonb(r) order by requester_id,target_id) from private.follow_requests r)
 and privacy is not distinct from (select jsonb_agg(jsonb_build_array(id,is_private) order by id) from profiles)
 from before_public_migration),'migration preserves existing relationships pending requests and private settings');
delete from private.follow_requests where requester_id=u(58) and target_id=u(59);
update public.profiles set is_private=false where id=u(59);
set local role authenticated;
select set_config('request.jwt.claim.sub',u(1)::text,true);
do $$declare r jsonb; ids uuid[]; begin
 r:=golfer_profile_connections(u(2),'followers',100,0);
 select array_agg((x->>'id')::uuid order by x->>'id') into ids from jsonb_array_elements(r->'profiles')x;
 perform test_assert(ids=array[u(1),u(3),u(5),u(6),u(14),u(18)],'candidate eligibility: direct test, hidden direct normal, expired/inactive roles; all hard exclusions');
 perform test_assert(r->>'total'='6' and r->>'mutual_total'='2','filtered follower and mutual totals');
 r:=golfer_profile_connections(u(2),'following',100,0);
 perform test_assert(r->>'total'='3' and r->>'mutual_total'='2','following list and stable legacy mutual formula');
 perform test_assert(golfer_profile_connections(u(2),'followers',0,0)->'profiles'='[]'::jsonb,'count-only has no rows');
 perform test_assert(jsonb_array_length(golfer_profile_connections(u(2),'followers',2,0)->'profiles')=2,'page bound');
 perform test_assert(golfer_profile_connections(u(2),'followers',2,100)->>'total'='6','empty page retains totals');
 perform test_assert(golfer_profile_followers(u(2),100,0)->'followers'=golfer_profile_connections(u(2),'followers',100,0)->'profiles','legacy wrapper shares filtered rows');
 perform test_assert((select count(*)=1 from follows where following_id=u(2)),'raw graph only reveals participant edge despite owner-follow permission');
 perform test_assert(golfer_profile_connections(u(1))->>'version'='1','own list allowed');
 perform test_assert((golfer_follow_state(u(1))->>'can_view_connections')::boolean,'self state supports setting');
end$$;
select test_denied('select golfer_profile_connections(u(2),null)','null list kind','22023');
select test_denied('select golfer_profile_connections(u(2),''followers'',101,0)','list limit rejected','22023');
select test_denied('select golfer_profile_connections(u(2),''followers'',1,-1)','negative offset rejected','22023');
select test_denied('insert into follows(follower_id,following_id) values(u(1),u(30))','old direct INSERT fails closed');
select test_denied('update follows set following_id=u(30) where follower_id=u(1)','direct UPDATE fails closed');
select set_config('request.jwt.claim.sub',u(19)::text,true);
select test_assert(golfer_profile_connections(u(2))->>'version'='1','reverse-follow can read public target');
select test_assert(golfer_profile_connections(u(2),'following',0,0)->>'version'='1','public count-only allowed');
select test_assert(golfer_profile_followers(u(2))->>'version'='1','legacy route public access');
reset role;
insert into public.user_roles values(u(2),'test',true);
set local role authenticated;
select set_config('request.jwt.claim.sub',u(1)::text,true);
select test_assert(golfer_profile_connections(u(2))->>'total'='6','test target allowed by accepted viewer-follow');
select set_config('request.jwt.claim.sub',u(2)::text,true);
select test_assert(golfer_profile_connections(u(2))->>'version'='1','test self allowed');
reset role;
insert into public.user_roles values(u(2),'app_reviewer',true);
set local role authenticated;
select set_config('request.jwt.claim.sub',u(1)::text,true);
select test_denied('select golfer_profile_connections(u(2))','test+reviewer never bypassed');
reset role;
delete from public.user_roles where user_id=u(2) and role='app_reviewer';
insert into public.blocks values(u(2),u(1));
set local role authenticated;
select test_denied('select golfer_profile_connections(u(2))','test target reverse block wins');
reset role;
delete from public.blocks where blocker_id=u(2) and blocked_id=u(1);
insert into private.user_suspensions values(u(2),now()+interval '1 hour');
set local role authenticated;
select test_denied('select golfer_profile_connections(u(2))','test target suspension wins');
reset role;
delete from private.user_suspensions where user_id=u(2);
-- No suspension row, null auth ban and inactive roles must not accidentally deny.
set local role authenticated;
select test_assert(golfer_profile_connections(u(2))->>'total'='6','absent suspension/null ban allowed');
select set_config('request.jwt.claim.sub','',true);
select test_denied('select golfer_profile_connections(u(2))','null auth graph denied');
select test_denied('select follow_golfer(u(2))','null auth mutation denied');
reset role;

-- Private request lifecycle. Request ids are saved only in synthetic settings.
set local role authenticated;
select set_config('request.jwt.claim.sub',u(21)::text,true);
select test_assert(set_account_private(true)->>'is_private'='true','owner enables approval');
select set_config('request.jwt.claim.sub',u(20)::text,true);
do $$declare r jsonb; begin
 r:=follow_golfer(u(21)); perform set_config('test.request',(r->>'request_id'),true);
 perform test_assert(r->>'state'='pending' and r->>'can_view_connections'='true','private follow creates only pending request');
 perform test_assert(follow_golfer(u(21))->>'request_id'=r->>'request_id','repeat follow idempotent');
 perform test_assert((select count(*)=0 from follows where follower_id=u(20) and following_id=u(21)),'pending grants no edge');
 perform test_assert(my_follow_requests()->>'total'='0','requester cannot read incoming target inbox');
end$$;
select test_assert(golfer_profile_connections(u(21))->>'version'='1','pending request does not gate public lists');
select test_denied('select respond_to_follow_request(current_setting(''test.request'')::uuid,true)','requester cannot accept self');
select set_config('request.jwt.claim.sub',u(22)::text,true);
select test_denied('select respond_to_follow_request(current_setting(''test.request'')::uuid,true)','third party cannot accept');
select test_assert(cancel_follow_request(current_setting('test.request')::uuid)->>'changed'='false','third-party cancel harmless');
select set_config('request.jwt.claim.sub',u(21)::text,true);
select test_assert(my_follow_requests()->>'total'='1','owner sees pending');
select test_assert(my_follow_requests(0)->'requests'='[]'::jsonb,'request count-only returns no identities');
select test_denied('select respond_to_follow_request(current_setting(''test.request'')::uuid,null)','null accept cannot accidentally reject');
select test_assert(my_follow_requests()->>'total'='1','null accept leaves request pending');
select test_assert(respond_to_follow_request(current_setting('test.request')::uuid,true)->>'state'='accepted','owner accepts');
select test_denied('select respond_to_follow_request(current_setting(''test.request'')::uuid,true)','repeat acceptance cannot recreate edge');
select test_assert(my_follow_requests()->>'total'='0','accepted request leaves incoming list');
select set_config('request.jwt.claim.sub',u(20)::text,true);
select test_assert(golfer_follow_state(u(21))->>'state'='following','acceptance becomes accepted follow');
select test_assert(golfer_profile_connections(u(21))->>'version'='1','accepted follow opens lists');
select set_config('request.jwt.claim.sub',u(21)::text,true);
select set_account_private(false); select set_account_private(true);
select test_assert((select count(*)=1 from follows where follower_id=u(20) and following_id=u(21)),'privacy toggles preserve accepted follows');
select test_assert(remove_follower(u(20))->>'changed'='true','owner removes follower');
select test_assert(remove_follower(u(20))->>'changed'='false','repeated removal idempotent');
select test_denied('select respond_to_follow_request(current_setting(''test.request'')::uuid,true)','old acceptance cannot resurrect removed follower');
select set_config('request.jwt.claim.sub',u(20)::text,true);
select test_assert(golfer_follow_state(u(21))->>'state'='none','removal revokes accepted relationship');
select test_assert(golfer_profile_connections(u(21))->>'version'='1','removal keeps public graph access');
select test_denied('select follow_golfer(u(21))','request recreation cooldown','P0001');
reset role;
select test_assert((select count(*)=1 from notifications where user_id=u(21) and actor_id=u(20) and type='new_follow_request'),'one request alert on retry');
select test_assert((select count(*)=1 from notifications where user_id=u(20) and actor_id=u(21) and type='follow_request_accepted'),'one acceptance alert');
select test_assert((select count(*)=1 from notifications where user_id=u(21) and actor_id=u(20) and type='new_follower'),'actual accepted edge triggers existing follower notification');
update private.follow_requests set created_at=now()-interval '2 minutes' where requester_id=u(20) and target_id=u(21);
set local role authenticated;
select set_config('request.jwt.claim.sub',u(20)::text,true);
do $$declare old_id text:=current_setting('test.request'); r jsonb; begin
 r:=follow_golfer(u(21)); perform test_assert(r->>'request_id'<>old_id,'new request gets new generation id');
 perform set_config('test.old_request',old_id,true); perform set_config('test.request',r->>'request_id',true);
 perform test_assert(cancel_follow_request((r->>'request_id')::uuid)->>'changed'='true','requester cancellation');
 perform test_assert(cancel_follow_request((r->>'request_id')::uuid)->>'changed'='false','repeat cancellation idempotent');
end$$;
select set_config('request.jwt.claim.sub',u(21)::text,true);
select test_denied('select respond_to_follow_request(current_setting(''test.old_request'')::uuid,true)','stale generation cannot approve new request');
select test_denied('select respond_to_follow_request(current_setting(''test.request'')::uuid,true)','cancelled request cannot be accepted');
reset role;
update private.follow_requests set created_at=now()-interval '2 minutes' where requester_id=u(20) and target_id=u(21);
set local role authenticated;
select set_config('request.jwt.claim.sub',u(20)::text,true);
select set_config('test.request',follow_golfer(u(21))->>'request_id',true);
select set_config('request.jwt.claim.sub',u(21)::text,true);
select test_assert(respond_to_follow_request(current_setting('test.request')::uuid,false)->>'state'='rejected','owner rejects');
select test_assert((select count(*)=0 from follows where follower_id=u(20) and following_id=u(21)),'rejection creates no edge');
reset role;
update private.follow_requests set created_at=now()-interval '2 minutes' where requester_id=u(20) and target_id=u(21);
set local role authenticated;
select set_config('request.jwt.claim.sub',u(20)::text,true);
select set_config('test.request',follow_golfer(u(21))->>'request_id',true);
select set_config('request.jwt.claim.sub',u(21)::text,true);
select set_account_private(false);
select test_assert(my_follow_requests()->>'total'='1','switching public preserves pending for explicit decision');
select set_config('request.jwt.claim.sub',u(20)::text,true);
select test_assert(follow_golfer(u(21))->>'state'='pending','pending retry never silently autoaccepts');
select cancel_follow_request(current_setting('test.request')::uuid);
select test_assert(follow_golfer(u(21))->>'state'='following','public fresh follow immediate after explicit cancellation');
select test_assert(unfollow_golfer(u(21))->>'changed'='true','unfollow accepted relationship');
select test_assert(unfollow_golfer(u(21))->>'changed'='false','unfollow idempotent');
reset role;

-- Block cancels both pending directions; unblock never revives either.
update public.profiles set is_private=true where id in(u(23),u(24),u(25));
set local role authenticated;
select set_config('request.jwt.claim.sub',u(23)::text,true);
select set_config('test.block_request',follow_golfer(u(24))->>'request_id',true);
select set_config('request.jwt.claim.sub',u(24)::text,true);
select follow_golfer(u(23));
insert into blocks values(u(24),u(23));
select test_assert(my_follow_requests()->>'total'='0','block hides and cancels incoming pending');
select test_denied('select respond_to_follow_request(current_setting(''test.block_request'')::uuid,true)','blocked acceptance rejected');
delete from blocks where blocker_id=u(24) and blocked_id=u(23);
select test_assert(my_follow_requests()->>'total'='0','unblock does not revive incoming request');
select test_assert(golfer_follow_state(u(23))->>'state'='none','unblock does not revive outgoing request');
select set_config('request.jwt.claim.sub',u(20)::text,true);
select set_config('test.suspended_request',follow_golfer(u(25))->>'request_id',true);
reset role;
insert into private.user_suspensions values(u(20),null);
set local role authenticated;
select set_config('request.jwt.claim.sub',u(25)::text,true);
select test_assert(my_follow_requests()->>'total'='0','suspended requester hidden from inbox');
select test_denied('select respond_to_follow_request(current_setting(''test.suspended_request'')::uuid,true)','suspended requester cannot be accepted');
select set_config('request.jwt.claim.sub',u(20)::text,true);
select test_denied('select follow_golfer(u(26))','suspended actor follow denied');
select test_assert(cancel_follow_request(current_setting('test.suspended_request')::uuid)->>'changed'='true','suspended actor may revoke own pending access');
reset role;

-- Discoverable is NOT follow authorization. Known hidden normal profile works.
update public.profiles set discoverable=false,is_private=true where id=u(30);
set local role authenticated;
select set_config('request.jwt.claim.sub',u(29)::text,true);
select test_assert(follow_golfer(u(30))->>'state'='pending','known non-discoverable profile can receive request');
select test_denied('select follow_golfer(u(29))','self follow rejected');
select test_denied('select follow_golfer(null)','null follow target rejected');
select test_denied('select set_account_private(null)','null privacy value rejected','22023');
select test_denied('select my_follow_requests(-1)','negative request page rejected','22023');
reset role;

-- ACL/default grant audit: clients never call arbitrary-id private helpers.
do $$declare fn text; role_name text; begin
 foreach fn in array array['golfer_profile_connections_page(uuid,text,integer,text,jsonb)','golfer_profile_connections(uuid,text,integer,integer)','golfer_profile_followers(uuid,integer,integer)','golfer_follow_state(uuid)','follow_golfer(uuid)','set_account_private(boolean)','my_follow_requests(integer,integer)','respond_to_follow_request(uuid,boolean)','cancel_follow_request(uuid)','unfollow_golfer(uuid)','remove_follower(uuid)'] loop
 perform test_assert(has_function_privilege('authenticated','public.'||fn,'execute'),'authenticated RPC '||fn);
 foreach role_name in array array['anon','service_role'] loop
 perform test_assert(not has_function_privilege(role_name,'public.'||fn,'execute'),role_name||' denied RPC '||fn);
 end loop;
 end loop;
 foreach fn in array array['social_account_active(uuid)','social_role_visible(uuid,uuid)','can_view_profile_connections(uuid,uuid)','can_list_follower_profile(uuid,uuid)','social_lock_pair(uuid,uuid)','social_interaction_allowed(uuid,uuid)','social_request_notification(uuid,uuid,boolean)','cancel_requests_on_block()'] loop
 foreach role_name in array array['authenticated','anon','service_role'] loop
 perform test_assert(not has_function_privilege(role_name,'private.'||fn,'execute'),role_name||' denied helper '||fn);
 end loop; end loop;
 foreach role_name in array array['authenticated','anon','service_role'] loop
 perform test_assert(not has_table_privilege(role_name,'private.follow_requests','select'),role_name||' denied request table');
 end loop;
end$$;
set local role anon;
select set_config('request.jwt.claim.sub',u(1)::text,true);
select test_denied('select golfer_profile_connections(u(2))','anon with forged subject denied');
select test_denied('select follow_golfer(u(2))','anon mutation with forged subject denied');
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub',u(1)::text,true);
select test_denied('select golfer_profile_connections(u(2))','service default execute removed');
reset role;

-- Public API safety/search/keyset tests, entirely synthetic and rolled back.
savepoint public_page_tests;
insert into follows(follower_id,following_id) values(u(1),u(19));
set local role authenticated;
select set_config('request.jwt.claim.sub',u(1)::text,true);
select test_assert((select (p->>'viewer_following')::boolean and not (p->>'is_mutual')::boolean
 from jsonb_array_elements(golfer_profile_connections_page(u(2),'following')->'profiles') p
 where p->>'id'=u(19)::text),'following row requires candidate to follow owner before mutual');
reset role;
delete from follows where follower_id=u(1) and following_id=u(19);

set local role authenticated;
select set_config('request.jwt.claim.sub',u(1)::text,true);
select test_assert((select jsonb_agg(x-'viewer_following'-'viewer_requested') from jsonb_array_elements(golfer_profile_connections_page(u(2))->'profiles') x)=golfer_profile_connections(u(2))->'profiles','new page agrees with legacy eligible rows');
select test_assert(golfer_profile_connections_page(u(2),'following',30,'no match')->>'mutual_total'='2','mutual total independent of following search');
select test_assert(golfer_profile_connections_page(u(2),'followers',30,'FIXTURE3')->>'matched_total'='1','username search case insensitive');
select test_assert(golfer_profile_connections_page(u(2),'followers',30,'%')->>'matched_total'='0','percent literal not wildcard');
select test_assert(golfer_profile_connections_page(u(2),'followers',30,'_')->>'matched_total'='0','underscore literal not wildcard');
select test_assert(golfer_profile_connections_page(u(2),'followers',30,chr(92))->>'matched_total'='0','backslash literal not wildcard');
select test_denied('select golfer_profile_connections_page(u(2),''followers'',0)','zero limit denied','22023');
select test_denied('select golfer_profile_connections_page(u(2),''followers'',101)','oversize limit denied','22023');
select test_denied('select golfer_profile_connections_page(u(2),''followers'',30,repeat(''a'',101))','oversize search denied','22023');
select test_denied('select golfer_profile_connections_page(u(2),''followers'',30,'''',''{}''::jsonb)','invalid cursor denied','22023');
select test_assert(not exists(select 1 from jsonb_array_elements(golfer_profile_connections_page(u(2))->'profiles') p,jsonb_object_keys(p) k where k not in('id','name','username','avatar_color','avatar_initials','photo_url','is_mutual','viewer_following','viewer_requested')),'fixture public payload explicit allowlist');
select set_config('test.cursor',(golfer_profile_connections_page(u(2),'followers',2)->'next_cursor')::text,true);
select test_denied('select golfer_profile_connections_page(u(2),''following'',2,'''',current_setting(''test.cursor'')::jsonb)','cursor kind bound','22023');
select test_denied('select golfer_profile_connections_page(u(2),''followers'',2,''other'',current_setting(''test.cursor'')::jsonb)','cursor search bound','22023');
select test_denied('select golfer_profile_connections_page(u(3),''followers'',2,'''',current_setting(''test.cursor'')::jsonb)','cursor owner bound','22023');
select test_denied('select golfer_profile_connections_page(u(2),''followers'',2,'''',jsonb_set(current_setting(''test.cursor'')::jsonb,''{as_of}'',to_jsonb((now()-interval ''25 hours'')::text)))','stale cursor rejected','22023');
reset role;
-- Compare unmodified relationship/request/privacy state across repeated reads.
create temp table before_read as select
 (select jsonb_agg(to_jsonb(f) order by follower_id,following_id) from follows f) follows,
 (select jsonb_agg(to_jsonb(r) order by requester_id,target_id) from private.follow_requests r) requests,
 (select jsonb_agg(jsonb_build_array(id,is_private) order by id) from profiles) privacy;
set local role authenticated;
select set_config('request.jwt.claim.sub',u(60)::text,true);
select test_assert(golfer_profile_connections_page(u(50))->>'total'='0','unrelated no-follow public profile opens empty list');
select test_assert(golfer_follow_state(u(50))->>'can_view_connections'='true','no-follow state grants public list access');
select test_denied('select golfer_profile_connections_page(u(2))','unrelated viewer cannot discover test-role owner');
select set_config('request.jwt.claim.sub','',true);
select test_denied('select golfer_profile_connections_page(u(50))','null auth new endpoint denied');
reset role;
select test_assert((select follows is not distinct from (select jsonb_agg(to_jsonb(f) order by follower_id,following_id) from follows f)
 and requests is not distinct from (select jsonb_agg(to_jsonb(r) order by requester_id,target_id) from private.follow_requests r)
 and privacy is not distinct from (select jsonb_agg(jsonb_build_array(id,is_private) order by id) from profiles)
 from before_read),'reads preserve all relationships requests and settings');
insert into auth.users(id) select u(i) from generate_series(100,1199) i;
insert into profiles(id,name,username) select u(i),'Large '||i,'large'||i from generate_series(100,1199) i;
insert into follows(follower_id,following_id,created_at) select u(i),u(50),'2026-01-01' from generate_series(100,1199) i;
set local role authenticated;
select set_config('request.jwt.claim.sub',u(60)::text,true);
do $$declare r jsonb; cursor_value jsonb:=null; ids uuid[]:='{}'; page_count integer:=0; begin
 loop
  r:=golfer_profile_connections_page(u(50),'followers',37,'',cursor_value);
  select ids||coalesce(array_agg((p->>'id')::uuid),'{}'::uuid[]) into ids from jsonb_array_elements(r->'profiles') p;
  page_count:=page_count+1;
  cursor_value:=r->'next_cursor';
  exit when cursor_value='null'::jsonb;
  if page_count>40 then raise exception 'pagination did not terminate'; end if;
 end loop;
 perform test_assert(cardinality(ids)=1100 and (select count(distinct x)=1100 from unnest(ids)x),'1100 rows keyset complete with tied timestamps and no duplicates');
 perform test_assert(page_count=30,'bounded large list pages');
 perform test_assert(r->>'total'='1100' and r->>'matched_total'='1100','large list totals consistent');
end$$;
reset role;
savepoint large_benchmark;
insert into auth.users(id) select u(i) from generate_series(1200,10099) i;
insert into profiles(id,name,username) select u(i),'Large '||i,'large'||i from generate_series(1200,10099) i;
insert into follows(follower_id,following_id,created_at) select u(i),u(50),'2026-01-01' from generate_series(1200,10099) i;
analyze public.follows; analyze public.profiles;
set local role authenticated;
set local statement_timeout='20s';
select test_assert(golfer_profile_connections_page(u(50),'followers',30)->>'total'='10000','10000 row graph bounded page with safe total');
explain (analyze,buffers) select golfer_profile_connections_page(u(50),'followers',30);
explain (analyze,buffers) select golfer_profile_connections_page(u(50),'followers',30,'large10');
reset role;
rollback to savepoint large_benchmark;
set local role authenticated;
select set_config('test.cursor',(golfer_profile_connections_page(u(50),'followers',2)->'next_cursor')::text,true);
reset role;
-- Deleting the anchor or earlier rows cannot shift the continuation offset.
delete from follows where following_id=u(50) and follower_id in(u(100),u(101));
insert into follows(follower_id,following_id,created_at) values(u(59),u(50),clock_timestamp()+interval '1 second');
set local role authenticated;
select test_assert(golfer_profile_connections_page(u(50),'followers',2,'',current_setting('test.cursor')::jsonb)->'profiles'->0->>'id'=u(102)::text,'deleted anchor does not skip next row');
select test_assert(golfer_profile_connections_page(u(50),'followers',2,'',current_setting('test.cursor')::jsonb)->'profiles'->1->>'id'=u(103)::text,'newer insertion does not duplicate page');
select test_denied('select golfer_profile_connections_page(u(50),''followers'',2,'''',jsonb_set(current_setting(''test.cursor'')::jsonb,''{viewer}'',to_jsonb(u(59)::text)))','cursor viewer bound','22023');
reset role;
update auth.users set banned_until=now()+interval '1 day' where id=u(102);
update auth.users set deleted_at=now() where id=u(103);
insert into private.user_suspensions values(u(104),null);
insert into blocks values(u(60),u(105)),(u(106),u(50));
set local role authenticated;
select test_assert(golfer_profile_connections_page(u(50),'followers',30,'large10')->>'matched_total'='103','banned deleted suspended and both block pairs absent from search counts');
reset role;
update auth.users set deleted_at=now() where id=u(50);
set local role authenticated;
select test_denied('select golfer_profile_connections_page(u(50))','deleted owner denied');
reset role;
update auth.users set deleted_at=null where id=u(50);
update auth.users set banned_until=now()+interval '1 day' where id=u(60);
set local role authenticated;
select test_denied('select golfer_profile_connections_page(u(50))','banned viewer denied');
reset role;
set local role anon;
select set_config('request.jwt.claim.sub',u(1)::text,true);
select test_denied('select golfer_profile_connections_page(u(2))','anon forged subject new endpoint denied');
reset role;
select count(*) as public_and_private_passed_assertions from public.test_results;
rollback to savepoint public_page_tests;

select count(*) as preserved_private_passed_assertions from public.test_results;
rollback;
\echo 'PASS: synthetic public social lists and preserved private controls; all fixtures rolled back. No full Supabase or concurrency claim.'

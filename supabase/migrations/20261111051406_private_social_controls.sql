-- LOCAL REVIEW ONLY. Apply atomically only after explicit release approval.
-- Do not replay the manually installed original followers migration or repair history.
-- Private = approval for NEW follows only. Profile/posts remain public.
-- Existing accepted follows and pending requests survive either privacy toggle.
do $$ begin
 if to_regprocedure('private.has_block_between(uuid,uuid)') is null
 or to_regprocedure('private.is_suspended(uuid)') is null
 or to_regprocedure('public.golfer_public_profiles(uuid[])') is null
 or to_regprocedure('public.golfer_profile_followers(uuid,integer,integer)') is null
 or to_regprocedure('private.follow_notify_skipped(uuid,uuid)') is null
 or to_regprocedure('private.fanout_golfer_fallback(text)') is null
 or to_regprocedure('private.send_round_push(text,uuid,text,text,text,text)') is null then
 raise exception 'Required social definitions are missing. Nothing changed.'; end if;
end $$;
alter table public.profiles add column is_private boolean not null default false;
comment on column public.profiles.is_private is 'Approval for new follows only; posts/profile details stay public. Existing accepted follows survive. Independent of Discoverable.';
-- Latest generation per directed pair. Terminal rows are a small cooldown
-- ledger, never accepted authority; that remains exclusively public.follows.
create table private.follow_requests (
 requester_id uuid not null references auth.users(id) on delete cascade,
 target_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null unique default gen_random_uuid(),
 status text not null check(status in ('pending','accepted','rejected','cancelled')),
 created_at timestamptz not null default now(), resolved_at timestamptz,
 primary key(requester_id,target_id), check(requester_id<>target_id),
 check((status='pending')=(resolved_at is null))
);
create index follow_requests_incoming_idx on private.follow_requests(target_id,created_at desc,request_id) where status='pending';
alter table private.follow_requests enable row level security;
revoke all on private.follow_requests from public,anon,authenticated,service_role;
drop policy follows_select_authenticated on public.follows;
create policy follows_select_participant on public.follows for select to authenticated
 using((select auth.uid()) in (follower_id,following_id));
create policy follows_select_participant_guard on public.follows as restrictive for select to authenticated
 using((select auth.uid()) in (follower_id,following_id));
drop policy follows_insert_own on public.follows;
revoke insert,update on public.follows from public,anon,authenticated;
-- Old clients may still delete their own accepted edge. No direct insert,
-- upsert, request write, or third-party graph SELECT remains available.

create function private.social_account_active(p_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select p_id is not null and exists(
 select 1 from public.profiles p join auth.users u on u.id=p.id
 where p.id=p_id and p.has_onboarded and nullif(btrim(p.name),'') is not null
 and not private.is_suspended(p.id)
 and (u.banned_until is null or u.banned_until<=now()) and u.deleted_at is null);
$$;
-- Test-only exception, never bot/seeded/app_reviewer, including multiple roles.
-- Null/absent moderation rows are not treated as active suspensions.
create function private.social_role_visible(p_viewer uuid,p_profile uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select not exists(select 1 from public.user_roles r where r.user_id=p_profile and r.active
 and r.role in ('bot','seeded','app_reviewer')) and (
 not exists(select 1 from public.user_roles r where r.user_id=p_profile and r.active and r.role='test')
 or p_viewer=p_profile or exists(select 1 from public.follows f where f.follower_id=p_viewer and f.following_id=p_profile));
$$;
create function private.can_view_profile_connections(p_viewer uuid,p_owner uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select p_viewer is not null and p_viewer=(select auth.uid())
 and private.social_account_active(p_viewer) and private.social_account_active(p_owner)
 and private.social_role_visible(p_viewer,p_owner) and not private.has_block_between(p_viewer,p_owner)
 and (p_viewer=p_owner or exists(select 1 from public.follows f where f.follower_id=p_viewer and f.following_id=p_owner));
$$;
-- Candidate eligibility is deliberately separate from graph-owner access.
-- Normal non-discoverable identities retain the earlier either-direction
-- direct-contact exception. Test identities additionally require viewer->candidate.
create or replace function private.can_list_follower_profile(p_viewer uuid,p_profile uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select p_viewer is not null and p_viewer=(select auth.uid())
 and private.social_account_active(p_profile) and private.social_role_visible(p_viewer,p_profile)
 and not private.has_block_between(p_viewer,p_profile)
 and exists(select 1 from public.profiles p where p.id=p_profile and
 (p.id=p_viewer or p.discoverable or exists(select 1 from public.follows f
 where (f.follower_id=p_viewer and f.following_id=p.id) or (f.follower_id=p.id and f.following_id=p_viewer))));
$$;
create function public.golfer_profile_connections(p_profile_id uuid,p_kind text default 'followers',p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_viewer uuid:=(select auth.uid()); v_limit integer:=coalesce(p_limit,100); v_offset integer:=coalesce(p_offset,0); v_result jsonb;
begin
 if p_kind is null or p_kind not in ('followers','following') or v_limit<0 or v_limit>100 or v_offset<0 or v_offset>100000 then
 raise exception 'Invalid connection page.' using errcode='22023'; end if;
 if not private.can_view_profile_connections(v_viewer,p_profile_id) then
 raise exception 'Followers unavailable.' using errcode='42501'; end if;
 with edges as materialized (
 select f.follower_id as id,f.created_at,'followers'::text kind from public.follows f where f.following_id=p_profile_id
 union all select f.following_id,f.created_at,'following'::text from public.follows f where f.follower_id=p_profile_id
 ), eligible as materialized (
 select e.*,exists(select 1 from public.follows mine where mine.follower_id=v_viewer and mine.following_id=e.id) is_mutual
 from edges e where private.can_list_follower_profile(v_viewer,e.id) and not private.has_block_between(p_profile_id,e.id)
 ), page as (
 select * from eligible where kind=p_kind order by created_at desc,id limit v_limit offset v_offset
 ), rows as (
 select to_jsonb(p)||jsonb_build_object('is_mutual',page.is_mutual) payload,page.created_at,page.id
 from public.golfer_public_profiles(array(select id from page)) p join page on page.id=p.id
 )
 select jsonb_build_object('version',1,'kind',p_kind,'total',(select count(*) from eligible where kind=p_kind),
 -- Preserved definition: people the viewer follows who also follow the owner.
 'mutual_total',(select count(*) from eligible where kind='followers' and is_mutual),
 'profiles',coalesce((select jsonb_agg(payload order by created_at desc,id) from rows),'[]'::jsonb)) into v_result;
 return v_result;
end $$;
create or replace function public.golfer_profile_followers(p_profile_id uuid,p_limit integer default 100,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path='' as $$
 select (r-'kind'-'profiles')||jsonb_build_object('followers',r->'profiles')
 from(select public.golfer_profile_connections(p_profile_id,'followers',p_limit,p_offset) r) q;
$$;
comment on function public.golfer_profile_connections(uuid,text,integer,integer) is 'Viewer-filtered followers/following and mutual summary. Self or accepted viewer-to-owner follow required; blocks/suspension win; narrow direct test-role exception. No pending access.';
comment on function public.golfer_profile_followers(uuid,integer,integer) is 'Compatibility wrapper for golfer_profile_connections followers. Same self/accepted-follow authorization and filtered counts; no discovery or reverse-follow target exception.';
-- Shared locks serialize follow, response, removal, cancellation, privacy
-- updates, and block INSERT. Recheck authority in a new statement after locking.
create function private.social_lock_pair(p_a uuid,p_b uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin perform p.id from public.profiles p where p.id in(p_a,p_b) order by p.id for update; end $$;
create function private.social_interaction_allowed(p_viewer uuid,p_target uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select p_viewer is not null and p_viewer=(select auth.uid())
 and private.social_account_active(p_viewer) and private.social_account_active(p_target)
 and private.social_role_visible(p_viewer,p_target) and not private.has_block_between(p_viewer,p_target);
$$;
create function public.golfer_follow_state(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_viewer uuid:=(select auth.uid()); v_private boolean; v_request uuid; v_state text:='none';
begin
 if not private.social_interaction_allowed(v_viewer,p_profile_id) then raise exception 'Follow unavailable.' using errcode='42501'; end if;
 select is_private into v_private from public.profiles where id=p_profile_id;
 if exists(select 1 from public.follows where follower_id=v_viewer and following_id=p_profile_id) then v_state:='following';
 else select request_id into v_request from private.follow_requests where requester_id=v_viewer and target_id=p_profile_id and status='pending';
 if v_request is not null then v_state:='pending'; end if; end if;
 return jsonb_build_object('version',1,'state',v_state,'request_id',v_request,'is_private',v_private,
 'can_view_connections',private.can_view_profile_connections(v_viewer,p_profile_id));
end $$;
do $$ declare v_def text; v_types text[];
begin
 select pg_get_constraintdef(oid) into v_def from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_type_check';
 select array_agg(distinct m[1]) into v_types from regexp_matches(v_def,'''([a-z_]+)''','g') m;
 if v_types is null or not('new_follower'=any(v_types)) then raise exception 'Required notification types are missing. Nothing changed.'; end if;
 v_types:=v_types||array['new_follow_request','follow_request_accepted'];
 alter table public.notifications drop constraint notifications_type_check;
 execute 'alter table public.notifications add constraint notifications_type_check check(type=any('||quote_literal(v_types::text)||'::text[]))';
end $$;
create function private.social_request_notification(p_recipient uuid,p_actor uuid,p_accepted boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare v_name text; v_lang text; v_text text; v_type text; v_link text; v_secret text;
begin
 if private.follow_notify_skipped(p_actor,p_recipient) then return; end if;
 select language into v_lang from public.profiles where id=p_recipient;
 select coalesce(nullif(btrim(name),''),private.fanout_golfer_fallback(v_lang)) into v_name from public.profiles where id=p_actor;
 v_type:=case when p_accepted then 'follow_request_accepted' else 'new_follow_request' end;
 v_link:=case when p_accepted then '/golfer/'||p_actor else '/profile' end;
 -- Cooldown survives request cancellation/recreation. Actual pending state
 -- always comes from my_follow_requests, not an old notification.
 if exists(select 1 from public.notifications where user_id=p_recipient and actor_id=p_actor and type=v_type and created_at>now()-interval '24 hours') then return; end if;
 v_text:=case coalesce(v_lang,'en')
 when 'es' then v_name||case when p_accepted then ' aceptó tu solicitud de seguimiento.' else ' quiere seguirte.' end
 when 'ja' then v_name||case when p_accepted then 'さんがフォローリクエストを承認しました。' else 'さんからフォローリクエストが届きました。' end
 when 'ko' then v_name||case when p_accepted then '님이 팔로우 요청을 수락했어요.' else '님이 팔로우를 요청했어요.' end
 when 'zh-CN' then v_name||case when p_accepted then ' 接受了你的关注请求。' else ' 请求关注你。' end
 when 'zh-TW' then v_name||case when p_accepted then ' 接受了你的追蹤請求。' else ' 請求追蹤你。' end
 else v_name||case when p_accepted then ' accepted your follow request.' else ' requested to follow you.' end end;
 insert into public.notifications(user_id,type,actor_id,text,link_to) values(p_recipient,v_type,p_actor,v_text,v_link);
 begin
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='push_internal_secret' limit 1;
 perform private.send_round_push(v_secret,p_recipient,v_name,v_text,v_link,null);
 exception when others then raise warning 'follow request push skipped: %',sqlerrm; end;
end $$;
create function public.follow_golfer(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_viewer uuid:=(select auth.uid()); v_private boolean; v_request private.follow_requests%rowtype;
begin
 if v_viewer is null or p_profile_id is null or p_profile_id=v_viewer then raise exception 'Follow unavailable.' using errcode='42501'; end if;
 perform private.social_lock_pair(v_viewer,p_profile_id);
 if not private.social_interaction_allowed(v_viewer,p_profile_id) then raise exception 'Follow unavailable.' using errcode='42501'; end if;
 if exists(select 1 from public.follows where follower_id=v_viewer and following_id=p_profile_id) then return public.golfer_follow_state(p_profile_id); end if;
 select * into v_request from private.follow_requests where requester_id=v_viewer and target_id=p_profile_id;
 if v_request.status='pending' then return public.golfer_follow_state(p_profile_id); end if;
 select is_private into v_private from public.profiles where id=p_profile_id;
 if v_private then
 -- A request must not reveal an unrelated excluded actor to its recipient.
 if not private.social_role_visible(p_profile_id,v_viewer) then raise exception 'Follow unavailable.' using errcode='42501'; end if;
 if v_request.created_at>now()-interval '1 minute' then raise exception 'Please wait before requesting again.' using errcode='P0001',hint='follow_request_cooldown'; end if;
 insert into private.follow_requests(requester_id,target_id,status) values(v_viewer,p_profile_id,'pending')
 on conflict(requester_id,target_id) do update set request_id=gen_random_uuid(),status='pending',created_at=now(),resolved_at=null;
 perform private.social_request_notification(p_profile_id,v_viewer,false);
 else insert into public.follows(follower_id,following_id) values(v_viewer,p_profile_id) on conflict do nothing;
 end if;
 return public.golfer_follow_state(p_profile_id);
end $$;
create function public.set_account_private(p_is_private boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_viewer uuid:=(select auth.uid());
begin
 if v_viewer is null then raise exception 'Sign in required.' using errcode='42501'; end if;
 if p_is_private is null then raise exception 'Privacy setting is required.' using errcode='22023'; end if;
 update public.profiles set is_private=p_is_private where id=v_viewer;
 if not found then raise exception 'Profile unavailable.' using errcode='42501'; end if;
 return jsonb_build_object('version',1,'is_private',p_is_private);
end $$;
create function public.my_follow_requests(p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_viewer uuid:=(select auth.uid()); v_result jsonb;
begin
 if v_viewer is null or not private.social_account_active(v_viewer) then raise exception 'Requests unavailable.' using errcode='42501'; end if;
 if p_limit is null or p_limit<0 or p_limit>100 or p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'Invalid request page.' using errcode='22023'; end if;
 with eligible as materialized (
 select r.* from private.follow_requests r where r.target_id=v_viewer and r.status='pending'
 and private.social_account_active(r.requester_id) and private.social_role_visible(v_viewer,r.requester_id)
 and not private.has_block_between(v_viewer,r.requester_id)
 ), page as(select * from eligible order by created_at desc,request_id limit p_limit offset p_offset),
 rows as(select jsonb_build_object('request_id',page.request_id,'created_at',page.created_at,'profile',to_jsonb(p)) payload,page.created_at,page.request_id
 from page join public.golfer_public_profiles(array(select requester_id from page)) p on p.id=page.requester_id)
 select jsonb_build_object('version',1,'total',(select count(*) from eligible),
 'requests',coalesce((select jsonb_agg(payload order by created_at desc,request_id) from rows),'[]'::jsonb)) into v_result;
 return v_result;
end $$;
create function public.respond_to_follow_request(p_request_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_viewer uuid:=(select auth.uid()); v_request private.follow_requests%rowtype;
begin
 if v_viewer is null or p_accept is null then raise exception 'Request unavailable.' using errcode='42501'; end if;
 select * into v_request from private.follow_requests where request_id=p_request_id and target_id=v_viewer;
 if not found then raise exception 'Request unavailable.' using errcode='42501'; end if;
 perform private.social_lock_pair(v_viewer,v_request.requester_id);
 select * into v_request from private.follow_requests where request_id=p_request_id and target_id=v_viewer;
 if not found or v_request.status<>'pending' then raise exception 'Request unavailable.' using errcode='42501'; end if;
 if not private.social_interaction_allowed(v_viewer,v_request.requester_id) then raise exception 'Request unavailable.' using errcode='42501'; end if;
 if p_accept then
 insert into public.follows(follower_id,following_id) values(v_request.requester_id,v_viewer) on conflict do nothing;
 update private.follow_requests set status='accepted',resolved_at=now() where request_id=p_request_id;
 perform private.social_request_notification(v_request.requester_id,v_viewer,true);
 else update private.follow_requests set status='rejected',resolved_at=now() where request_id=p_request_id;
 end if;
 return jsonb_build_object('version',1,'state',case when p_accept then 'accepted' else 'rejected' end);
end $$;
create function public.cancel_follow_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_viewer uuid:=(select auth.uid()); v_target uuid; v_count integer;
begin
 if v_viewer is null then raise exception 'Sign in required.' using errcode='42501'; end if;
 select target_id into v_target from private.follow_requests where request_id=p_request_id and requester_id=v_viewer;
 if v_target is null then return jsonb_build_object('version',1,'changed',false); end if;
 perform private.social_lock_pair(v_viewer,v_target);
 update private.follow_requests set status='cancelled',resolved_at=now() where request_id=p_request_id and requester_id=v_viewer and status='pending';
 get diagnostics v_count=row_count;
 return jsonb_build_object('version',1,'changed',v_count>0);
end $$;
create function public.unfollow_golfer(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_viewer uuid:=(select auth.uid()); v_count integer;
begin
 if v_viewer is null then raise exception 'Sign in required.' using errcode='42501'; end if;
 perform private.social_lock_pair(v_viewer,p_profile_id);
 delete from public.follows where follower_id=v_viewer and following_id=p_profile_id;
 get diagnostics v_count=row_count;
 return jsonb_build_object('version',1,'changed',v_count>0);
end $$;
create function public.remove_follower(p_follower_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_viewer uuid:=(select auth.uid()); v_count integer;
begin
 if v_viewer is null then raise exception 'Sign in required.' using errcode='42501'; end if;
 perform private.social_lock_pair(v_viewer,p_follower_id);
 delete from public.follows where follower_id=p_follower_id and following_id=v_viewer;
 get diagnostics v_count=row_count;
 return jsonb_build_object('version',1,'changed',v_count>0);
end $$;
-- Blocking cancels pending requests in both directions under the same locks.
-- Accepted edges keep current behavior (hidden while blocked, not destroyed).
create function private.cancel_requests_on_block()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.social_lock_pair(new.blocker_id,new.blocked_id);
 update private.follow_requests set status='cancelled',resolved_at=now() where status='pending' and
 ((requester_id=new.blocker_id and target_id=new.blocked_id) or (requester_id=new.blocked_id and target_id=new.blocker_id));
 return new;
end $$;
create trigger cancel_follow_requests_on_block before insert on public.blocks for each row execute function private.cancel_requests_on_block();
revoke all on function private.social_account_active(uuid),private.social_role_visible(uuid,uuid),
 private.can_view_profile_connections(uuid,uuid),private.can_list_follower_profile(uuid,uuid),private.social_lock_pair(uuid,uuid),
 private.social_interaction_allowed(uuid,uuid),private.social_request_notification(uuid,uuid,boolean),private.cancel_requests_on_block()
 from public,anon,authenticated,service_role;
revoke all on function public.golfer_profile_connections(uuid,text,integer,integer),public.golfer_profile_followers(uuid,integer,integer),
 public.golfer_follow_state(uuid),public.follow_golfer(uuid),public.set_account_private(boolean),public.my_follow_requests(integer,integer),
 public.respond_to_follow_request(uuid,boolean),public.cancel_follow_request(uuid),public.unfollow_golfer(uuid),public.remove_follower(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.golfer_profile_connections(uuid,text,integer,integer),public.golfer_profile_followers(uuid,integer,integer),
 public.golfer_follow_state(uuid),public.follow_golfer(uuid),public.set_account_private(boolean),public.my_follow_requests(integer,integer),
 public.respond_to_follow_request(uuid,boolean),public.cancel_follow_request(uuid),public.unfollow_golfer(uuid),public.remove_follower(uuid)
 to authenticated;

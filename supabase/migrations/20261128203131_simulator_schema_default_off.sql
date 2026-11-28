-- Candidate: Simulator schema, default-off. Requires review before release.
begin;
do $simulator_install$
begin
 if to_regnamespace('simulator_private') is not null
  or to_regprocedure('private.social_account_active(uuid)') is null
  or to_regclass('public.blocks') is null
 then raise exception 'Unexpected Simulator install state'; end if;
end $simulator_install$;

-- No public tables, outdoor mutations, reservations or inventory.
create schema simulator_private;
revoke all on schema simulator_private from public, anon, authenticated, service_role;
alter default privileges in schema simulator_private revoke all on tables from public,anon,authenticated,service_role;
alter default privileges in schema simulator_private revoke execute on functions from public,anon,authenticated,service_role;
create table simulator_private.settings(singleton boolean primary key default true check(singleton), enabled boolean not null default false, enroll_all_active boolean not null default false);
insert into simulator_private.settings(singleton,enabled,enroll_all_active) values(true,false,false);
-- No app grants, default empty. Enabling alone never enables any account.
create table simulator_private.allowed_actors(user_id uuid primary key references auth.users(id) on delete cascade);
-- A dedicated per-actor mutex. Auth rows are never explicitly locked for lifecycle coordination.
create table simulator_private.actor_locks(user_id uuid primary key references auth.users(id) on delete cascade);
create table simulator_private.venues(id text primary key, city text not null check(city in ('nyc','hk')), name text not null, address text not null, timezone text not null check((city='nyc' and timezone='America/New_York') or (city='hk' and timezone='Asia/Hong_Kong')), active boolean not null default true,max_group_size integer not null default 4 check(max_group_size between 2 and 6));
create table simulator_private.sessions(id uuid primary key default gen_random_uuid(),host_id uuid not null references auth.users(id) on delete cascade,venue_id text not null references simulator_private.venues(id),starts_at timestamptz not null,duration_minutes integer not null check(duration_minutes in (60,90,120)),capacity integer not null check(capacity between 2 and 6),status text not null default 'open' check(status in ('open','cancelled')),created_at timestamptz not null default clock_timestamp(),cancelled_at timestamptz,check ((status='cancelled')=(cancelled_at is not null)));
create table simulator_private.participants(session_id uuid references simulator_private.sessions(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,joined_at timestamptz not null default clock_timestamp(),cleanup_token uuid not null unique default gen_random_uuid(),primary key(session_id,user_id));
create table simulator_private.requests(actor uuid not null references auth.users(id) on delete cascade,request_id uuid not null,payload jsonb not null,session_id uuid not null references simulator_private.sessions(id) on delete cascade,primary key(actor,request_id));
create index simulator_sessions_host on simulator_private.sessions(host_id,created_at);
create index simulator_sessions_host_future_open on simulator_private.sessions(host_id,starts_at) where status='open';
create index simulator_requests_session on simulator_private.requests(session_id);
create index simulator_sessions_upcoming on simulator_private.sessions(starts_at,id) where status='open';
create index simulator_participants_user on simulator_private.participants(user_id,session_id);
alter table simulator_private.participants add column recovery_label text check(recovery_label in ('blue-1', 'blue-2', 'blue-3', 'blue-4', 'blue-5', 'blue-6', 'green-1', 'green-2', 'green-3', 'green-4', 'green-5', 'green-6', 'gold-1', 'gold-2', 'gold-3', 'gold-4', 'gold-5', 'gold-6', 'purple-1', 'purple-2', 'purple-3', 'purple-4', 'purple-5', 'purple-6'));
create index simulator_participants_actor_label on simulator_private.participants(user_id,recovery_label) where recovery_label is not null;

alter table simulator_private.settings enable row level security;
alter table simulator_private.allowed_actors enable row level security;
alter table simulator_private.actor_locks enable row level security;
alter table simulator_private.venues enable row level security;
alter table simulator_private.sessions enable row level security;
alter table simulator_private.participants enable row level security;
alter table simulator_private.requests enable row level security;
revoke all on all tables in schema simulator_private from public, anon, authenticated, service_role;
create function simulator_private.active_user(actor uuid) returns boolean language sql stable set search_path='' as $$
 select actor is not null and coalesce(private.social_account_active(actor),false) and exists(select 1 from auth.users u where u.id=actor and u.deleted_at is null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=statement_timestamp()))
$$;
create function simulator_private.can_access(actor uuid) returns boolean language sql stable set search_path='' as $$
 select simulator_private.active_user(actor) is true
 and exists(select 1 from simulator_private.settings s where s.enabled
  and (s.enroll_all_active or exists(select 1 from simulator_private.allowed_actors a where a.user_id=actor)))
$$;
create function simulator_private.require_actor() returns uuid language plpgsql set search_path='' as $$
declare actor uuid:=auth.uid(); begin
 if simulator_private.can_access(actor) is not true then raise exception 'simulator_unavailable'; end if;
 return actor; end $$;
create function simulator_private.lock_actor(actor uuid) returns void language plpgsql set search_path='' as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'unsupported_isolation'; end if;
 insert into simulator_private.actor_locks(user_id) values(actor) on conflict do nothing;
 perform 1 from simulator_private.actor_locks l where l.user_id=actor for update;
end $$;
create function simulator_private.eligible(sid uuid,actor uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from simulator_private.sessions s join simulator_private.venues v on v.id=s.venue_id where s.id=sid and v.active and simulator_private.can_access(s.host_id) is true)
 and not exists(select 1 from simulator_private.participants p join public.blocks b on (b.blocker_id=actor and b.blocked_id=p.user_id) or (b.blocked_id=actor and b.blocker_id=p.user_id) where p.session_id=sid)
$$;
-- Called under the actor lock, covering hidden and visible upcoming memberships.
create function simulator_private.check_recovery_label(actor uuid,label text) returns void
language plpgsql set search_path='' as $$
begin
 if label is null or label not in ('blue-1', 'blue-2', 'blue-3', 'blue-4', 'blue-5', 'blue-6', 'green-1', 'green-2', 'green-3', 'green-4', 'green-5', 'green-6', 'gold-1', 'gold-2', 'gold-3', 'gold-4', 'gold-5', 'gold-6', 'purple-1', 'purple-2', 'purple-3', 'purple-4', 'purple-5', 'purple-6') then raise exception 'invalid_recovery_label'; end if;
 if exists(select 1 from simulator_private.participants p join simulator_private.sessions s on s.id=p.session_id
   where p.user_id=actor and p.recovery_label=label and s.status='open' and s.starts_at>clock_timestamp()) then
  raise exception 'recovery_label_in_use';
 end if;
end $$;
create function public.create_simulator_session(request_id uuid,venue_id text,starts_at timestamptz,duration_minutes integer,capacity integer,recovery_label text) returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=simulator_private.require_actor(); payload jsonb:=jsonb_build_array(venue_id,extract(epoch from starts_at),duration_minutes,capacity,recovery_label); prior simulator_private.requests; sid uuid; checked_at timestamptz; venue_cap integer;
begin
 if request_id is null then raise exception 'request_id_required'; end if;
 perform simulator_private.lock_actor(actor);
 if simulator_private.require_actor() is distinct from actor then raise exception 'simulator_unavailable'; end if;
 select * into prior from simulator_private.requests r where r.actor=actor and r.request_id=create_simulator_session.request_id;
 if found then
  if prior.payload<>payload then raise exception 'request_payload_changed'; end if;
  -- Keep the actor-first lock order. A committed cancellation is never returned as a successful retry.
  perform s.id from simulator_private.sessions s
   join simulator_private.participants p on p.session_id=s.id and p.user_id=actor and p.recovery_label=create_simulator_session.recovery_label
   where s.id=prior.session_id and s.host_id=actor and s.status='open'
     and s.starts_at>clock_timestamp() for update of s;
  if not found then raise exception 'request_stale'; end if;
  if simulator_private.eligible(prior.session_id,actor) is not true then raise exception 'simulator_unavailable'; end if;
  return prior.session_id;
 end if;
 checked_at:=clock_timestamp();
 if starts_at is null or starts_at<=checked_at or starts_at>checked_at+interval '180 days' then raise exception 'invalid_start_time'; end if;
 select v.max_group_size into venue_cap from simulator_private.venues v where v.id=venue_id and v.active;
 if not found then raise exception 'invalid_venue'; end if;
 if capacity is null or capacity<2 or capacity>venue_cap then raise exception 'invalid_capacity'; end if;
 -- These fresh READ COMMITTED queries run after the per-host lock and retry lookup.
 if (select count(*) from simulator_private.sessions s where s.host_id=actor and s.status='open' and s.starts_at>checked_at)>=5 then
  raise exception 'simulator_open_host_limit';
 end if;
 if (select count(*) from simulator_private.sessions s where s.host_id=actor and s.created_at>checked_at-interval '24 hours')>=10 then
  raise exception 'simulator_rolling_create_limit';
 end if;
 perform simulator_private.check_recovery_label(actor,recovery_label);
 insert into simulator_private.sessions(host_id,venue_id,starts_at,duration_minutes,capacity,created_at) values(actor,venue_id,starts_at,duration_minutes,capacity,checked_at) returning id into sid;
 insert into simulator_private.participants(session_id,user_id,recovery_label) values(sid,actor,recovery_label);
 insert into simulator_private.requests values(actor,request_id,payload,sid);
 return sid;
end $$;
create function public.join_simulator_session(session_id uuid,recovery_label text) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=simulator_private.require_actor(); s simulator_private.sessions; existing_label text;
begin
 -- Consistent lock order: actor first, then session. The count includes all confirmed
 -- seats so subsequent moderation reinstatement cannot overflow the capacity.
 perform simulator_private.lock_actor(actor);
 select * into s from simulator_private.sessions where id=session_id for update;
 if not found or simulator_private.require_actor() is distinct from actor or simulator_private.eligible(session_id,actor) is not true or s.status<>'open' or s.starts_at<=clock_timestamp() then raise exception 'session_unavailable'; end if;
 select p.recovery_label into existing_label from simulator_private.participants p
  where p.session_id=join_simulator_session.session_id and p.user_id=actor;
 if found then
  if recovery_label is null or existing_label is distinct from recovery_label then raise exception 'label_conflict_stale'; end if;
  return;
 end if;
 if (select count(*) from simulator_private.participants p where p.session_id=join_simulator_session.session_id)>=s.capacity then raise exception 'session_full'; end if;
 if (select count(*) from simulator_private.participants p join simulator_private.sessions upcoming on upcoming.id=p.session_id
     where p.user_id=actor and upcoming.host_id<>actor and upcoming.status='open' and upcoming.starts_at>clock_timestamp())>=5 then
  raise exception 'simulator_open_join_limit';
 end if;
 perform simulator_private.check_recovery_label(actor,recovery_label);
 insert into simulator_private.participants(session_id,user_id,recovery_label) values(session_id,actor,recovery_label);
end $$;
create function public.leave_simulator_session(session_id uuid) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); s simulator_private.sessions;
begin
 -- Cleanup remains available after account restriction or feature disablement.
 if actor is null then raise exception 'authentication_required'; end if;
 -- No unrelated user may allocate an actor row or lock a session.
 if not exists(select 1 from simulator_private.participants p
    where p.session_id=leave_simulator_session.session_id and p.user_id=actor) then return; end if;
 perform simulator_private.lock_actor(actor);
 select * into s from simulator_private.sessions where id=session_id for update;
 if not found or s.status<>'open' or s.starts_at<=clock_timestamp() then return; end if;
 if not exists(select 1 from simulator_private.participants p
    where p.session_id=leave_simulator_session.session_id and p.user_id=actor) then return; end if;
 if s.host_id=actor then raise exception 'host_must_cancel'; end if;
 delete from simulator_private.participants p where p.session_id=leave_simulator_session.session_id and p.user_id=actor;
end $$;
create function public.cancel_simulator_session(session_id uuid) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); s simulator_private.sessions;
begin
 if actor is null then raise exception 'authentication_required'; end if;
 -- Same error for missing and non-owned; only an owner reaches lifecycle locks.
 if not exists(select 1 from simulator_private.sessions owned
    where owned.id=cancel_simulator_session.session_id and owned.host_id=actor) then raise exception 'not_host'; end if;
 perform simulator_private.lock_actor(actor);
 select * into s from simulator_private.sessions where id=session_id for update;
 if not found or s.host_id is distinct from actor then raise exception 'not_host'; end if;
 if s.status='open' and s.starts_at>clock_timestamp() then
  update simulator_private.sessions set status='cancelled',cancelled_at=clock_timestamp() where id=session_id;
 end if;
end $$;
create function public.list_simulator_sessions(city text) returns table(id uuid,venue_id text,starts_at timestamptz,duration_minutes integer,capacity integer,occupied integer,joined boolean,is_host boolean,own_recovery_label text) language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=simulator_private.require_actor(); begin
 return query select s.id,s.venue_id,s.starts_at,s.duration_minutes,s.capacity,(select count(*)::integer from simulator_private.participants p where p.session_id=s.id),exists(select 1 from simulator_private.participants p where p.session_id=s.id and p.user_id=actor),s.host_id=actor,
 (select p.recovery_label from simulator_private.participants p where p.session_id=s.id and p.user_id=actor)
 from simulator_private.sessions s join simulator_private.venues v on v.id=s.venue_id where v.city=list_simulator_sessions.city and s.status='open' and s.starts_at>statement_timestamp() and s.starts_at<=statement_timestamp()+interval '180 days' and simulator_private.eligible(s.id,actor) is true order by s.starts_at,s.id limit 100;
end $$;
revoke all on all functions in schema simulator_private from public,anon,authenticated,service_role;
revoke all on function public.create_simulator_session(uuid,text,timestamptz,integer,integer,text),public.join_simulator_session(uuid,text),public.leave_simulator_session(uuid),public.cancel_simulator_session(uuid),public.list_simulator_sessions(text) from public,anon,service_role;
grant execute on function public.create_simulator_session(uuid,text,timestamptz,integer,integer,text),public.join_simulator_session(uuid,text),public.leave_simulator_session(uuid),public.cancel_simulator_session(uuid),public.list_simulator_sessions(text) to authenticated;
-- The optional exact prior-receipt recovery path remains owner-scoped.
alter table simulator_private.participants
  add column recovery_receipt uuid not null unique default gen_random_uuid();

-- Return an opaque receipt only for a session the signed-in caller is still
-- allowed to see and is currently a member of. Do not return any session details.
create function public.issue_simulator_recovery_receipt(session_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); receipt uuid;
begin
 if simulator_private.can_access(actor) is not true then return null; end if;
 select p.recovery_receipt into receipt
   from simulator_private.participants p join simulator_private.sessions s on s.id=p.session_id
   where p.user_id=actor and p.session_id=issue_simulator_recovery_receipt.session_id
     and s.status='open' and s.starts_at>clock_timestamp()
     and simulator_private.eligible(s.id,actor) is true;
 return receipt;
end $$;

-- A proof issued while the caller could see the session identifies exactly
-- one hidden membership now. New callers learn nothing about other sessions.
create function public.find_simulator_cleanup(receipt uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); entry jsonb;
begin
 if actor is null then raise exception 'authentication_required'; end if;
 select jsonb_build_object('cleanup_token',p.cleanup_token,
   'action',case when s.host_id=actor then 'cancel' else 'leave' end) into entry
 from simulator_private.participants p join simulator_private.sessions s on s.id=p.session_id
 where p.user_id=actor and p.recovery_receipt=receipt and s.status='open'
   and s.starts_at>clock_timestamp()
   and (simulator_private.can_access(actor) is not true or simulator_private.eligible(s.id,actor) is not true);
 return entry;
end $$;

-- Remove the legacy list and token-only action; neither is needed with proof lookup.
-- Resolve under the same actor/session lock order as join, leave, and cancel.
create function public.resolve_simulator_cleanup(token uuid,receipt uuid,expected_action text)
returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); sid uuid; s simulator_private.sessions; changed boolean:=false;
begin
 if actor is null then raise exception 'authentication_required'; end if;
 if expected_action is null or expected_action not in ('leave','cancel') then return false; end if;
 select p.session_id into sid from simulator_private.participants p
   where p.user_id=actor and p.cleanup_token=token and p.recovery_receipt=receipt;
 if not found then return false; end if;

 perform simulator_private.lock_actor(actor);
 select * into s from simulator_private.sessions where id=sid for update;
 if not found or s.status<>'open' or s.starts_at<=clock_timestamp() then return false; end if;
 if expected_action is distinct from
    (case when s.host_id=actor then 'cancel' else 'leave' end) then return false; end if;

 if expected_action='cancel' then
   update simulator_private.sessions as target set status='cancelled',cancelled_at=clock_timestamp()
   where target.id=sid and target.host_id=actor and target.starts_at>clock_timestamp()
     and exists(select 1 from simulator_private.participants p where p.session_id=sid
       and p.user_id=actor and p.cleanup_token=token and p.recovery_receipt=receipt)
     and (simulator_private.can_access(actor) is not true or simulator_private.eligible(sid,actor) is not true)
   returning true into changed;
 else
   delete from simulator_private.participants p where p.session_id=sid and p.user_id=actor
     and p.cleanup_token=token and p.recovery_receipt=receipt
     and s.host_id<>actor and s.starts_at>clock_timestamp()
     and (simulator_private.can_access(actor) is not true or simulator_private.eligible(sid,actor) is not true)
   returning true into changed;
 end if;
 return coalesce(changed,false);
end $$;

revoke all on function public.issue_simulator_recovery_receipt(uuid),public.find_simulator_cleanup(uuid),
 public.resolve_simulator_cleanup(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.issue_simulator_recovery_receipt(uuid),public.find_simulator_cleanup(uuid),
 public.resolve_simulator_cleanup(uuid,uuid,text) to authenticated;

-- Exact own-membership management even outside the current city, discovery cap,
-- or pilot access. Never returns venue, date, participant or session identifiers.
create function public.list_simulator_label_cleanup()
returns table(label text,action text,token uuid) language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); begin
 if actor is null then raise exception 'authentication_required'; end if;
 return query select p.recovery_label,case when s.host_id=actor then 'cancel' else 'leave' end,p.cleanup_token
 from simulator_private.participants p join simulator_private.sessions s on s.id=p.session_id
 where p.user_id=actor and p.recovery_label is not null and s.status='open'
 and s.starts_at>statement_timestamp()
 order by p.recovery_label collate "C" limit 24;
end $$;
create function public.resolve_simulator_label_cleanup(token uuid,label text,expected_action text)
returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); sid uuid; s simulator_private.sessions; changed boolean:=false;
begin
 if actor is null then raise exception 'authentication_required'; end if;
 if expected_action is null or expected_action not in ('leave','cancel') then return false; end if;
 select p.session_id into sid from simulator_private.participants p
   where p.user_id=actor and p.cleanup_token=token and p.recovery_label=label;
 if not found then return false; end if;

 perform simulator_private.lock_actor(actor);
 select * into s from simulator_private.sessions where id=sid for update;
 if not found or s.status<>'open' or s.starts_at<=clock_timestamp() then return false; end if;
 if expected_action is distinct from
    (case when s.host_id=actor then 'cancel' else 'leave' end) then return false; end if;

 if expected_action='cancel' then
   update simulator_private.sessions as target set status='cancelled',cancelled_at=clock_timestamp()
   where target.id=sid and target.status='open' and target.host_id=actor and target.starts_at>clock_timestamp()
     and exists(select 1 from simulator_private.participants p where p.session_id=sid
       and p.user_id=actor and p.cleanup_token=token and p.recovery_label=label)
   returning true into changed;
 else
   delete from simulator_private.participants p where p.session_id=sid and p.user_id=actor
     and p.cleanup_token=token and p.recovery_label=label
     and s.host_id<>actor and s.starts_at>clock_timestamp()
   returning true into changed;
 end if;
 return coalesce(changed,false);
end $$;

revoke all on function public.list_simulator_label_cleanup(),public.resolve_simulator_label_cleanup(uuid,text,text) from public,anon,service_role;
grant execute on function public.list_simulator_label_cleanup(),public.resolve_simulator_label_cleanup(uuid,text,text) to authenticated;

-- The operator-only purge is scheduled separately from schema and activation.
-- Keep terminal session metadata for no more than 72 hours after play ends or
-- cancellation, plus the eventual job interval. Memberships and receipts are
-- removed by the existing cascade; independent moderation history is untouched.
create function simulator_private.purge_terminal_sessions()
returns integer language sql volatile security invoker set search_path = '' as $$
 with cutoff as (select statement_timestamp() - interval '72 hours' as deadline),
 candidates as materialized (
  select s.id from simulator_private.sessions s cross join cutoff
  where (s.status='cancelled' and s.cancelled_at <= cutoff.deadline)
     or (s.status='open' and s.starts_at <= cutoff.deadline
         and s.starts_at + make_interval(mins => s.duration_minutes) <= cutoff.deadline)
  order by coalesce(s.cancelled_at,s.starts_at),s.id
  limit 250 for update of s skip locked
 ), removed as (
  delete from simulator_private.sessions s using candidates c where s.id=c.id returning 1
 )
 select count(*)::integer from removed
$$;
revoke all on function simulator_private.purge_terminal_sessions() from public,anon,authenticated,service_role;

do $verify$
declare fn text; app_role text; rel record; helper record;
begin
 if not exists(select 1 from simulator_private.settings where not enabled and not enroll_all_active)
  or exists(select 1 from simulator_private.allowed_actors) or exists(select 1 from simulator_private.venues)
 then raise exception 'Simulator must install disabled, unseeded and with no audience'; end if;
 foreach fn in array array['public.create_simulator_session(uuid,text,timestamptz,integer,integer,text)','public.join_simulator_session(uuid,text)','public.leave_simulator_session(uuid)','public.cancel_simulator_session(uuid)','public.list_simulator_sessions(text)','public.issue_simulator_recovery_receipt(uuid)','public.find_simulator_cleanup(uuid)','public.resolve_simulator_cleanup(uuid,uuid,text)','public.list_simulator_label_cleanup()','public.resolve_simulator_label_cleanup(uuid,text,text)'] loop
  if to_regprocedure(fn) is null or not has_function_privilege('authenticated',fn,'execute')
   or has_function_privilege('anon',fn,'execute') or has_function_privilege('service_role',fn,'execute')
  then raise exception 'Unexpected Simulator public RPC privileges'; end if;
 end loop;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='simulator_private' and c.relkind='r' and c.relrowsecurity)<>7 then
  raise exception 'Simulator table inventory or RLS differs';
 end if;
 foreach app_role in array array['anon','authenticated','service_role'] loop
  if has_schema_privilege(app_role,'simulator_private','usage,create') then
   raise exception 'Unexpected Simulator schema privilege';
  end if;
  for rel in select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='simulator_private' and c.relkind='r' loop
   if has_table_privilege(app_role,rel.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception 'Unexpected Simulator table privilege';
   end if;
  end loop;
  for helper in select proc.oid from pg_proc proc join pg_namespace n on n.oid=proc.pronamespace
     where n.nspname='simulator_private' loop
   if has_function_privilege(app_role,helper.oid,'execute') then
    raise exception 'Unexpected Simulator private helper privilege';
   end if;
  end loop;
 end loop;
end $verify$;
select pg_notify('pgrst','reload schema');
commit;

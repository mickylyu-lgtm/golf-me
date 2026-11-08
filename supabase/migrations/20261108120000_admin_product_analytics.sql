-- Admin product analytics foundations (2026-11-08). PREPARED, NOT APPLIED.
-- Contract: docs/ANALYTICS_CONTRACT.md. Read-only for user data except the
-- new private event log below; nothing here changes what users can see/do.
--
-- 1. private.analytics_excluded_users: accounts that never count (Micky's
--    own account, test accounts, bots). Seeded by Micky with SQL he runs
--    himself (scratchpad analytics-seed-exclusions.sql looks his id up by
--    the email he types in). Not API-exposed, no client grants.
--    Also always excluded: any account holding an active 'admin', 'test',
--    'app_reviewer', 'bot' or 'seeded' role (same set as
--    admin_activation_funnel). 'pre_launch', 'coach_reviewer' and
--    'booking_reviewer' accounts are real golfers and DO count.
--    Exclusion is applied at read time, so marking an account later
--    removes it from all history retroactively.
--
-- 2. private.analytics_events (version 1): server-recorded events that the
--    source tables cannot reconstruct:
--      round_joined         every successful join, incl. re-joins
--                           (round_participants.joined_at is overwritten on
--                           re-join, so earlier joins are otherwise lost)
--      round_left           a joined golfer left (no left_at column exists)
--      round_completed      host marked completed (no completed_at column)
--      round_cancelled      host cancelled (no cancelled_at column)
--      onboarding_completed has_onboarded false -> true (no onboarded_at)
--    Written only by AFTER triggers inside the same transaction as the real
--    change, so a rolled-back join leaves no event. Every capture is wrapped
--    in its own exception block: a capture failure can never fail a join,
--    leave, status change or onboarding. occurred_at is the server's
--    transaction time (never a client clock). idempotency_key is unique, and
--    every insert is ON CONFLICT DO NOTHING. No message text, no media, no
--    device ids, no IPs. user_id cascades on account deletion; round_id is a
--    plain uuid (no FK) so a joiner's own activity survives the host
--    deleting their account. Retention: not scheduled yet (open question,
--    see the contract doc).
--    No history is backfilled: the events start at apply time
--    (private.analytics_meta 'events_tracking_started_at').
--
-- 3. Admin-only SECURITY DEFINER RPCs (has_role admin check first, 42501
--    otherwise; execute revoked from public/anon), each returning one jsonb
--    with version, timezone, range and coverage:
--      admin_analytics_activity(p_from date, p_to date)
--      admin_analytics_retention(p_from date, p_to date)
--      admin_analytics_golf_calls(p_from date, p_to date)
--      admin_analytics_social(p_from date, p_to date)
--      admin_analytics_exclusions()
--    p_from/p_to are reporting-timezone calendar dates, inclusive; they map
--    to the half-open range [p_from 00:00, p_to + 1 00:00) in
--    America/New_York (DST-correct via AT TIME ZONE). Max 366 days.
--
-- Activity (headline DAU/WAU/MAU/retention): a successful join of a round
-- someone else hosts, OR a successfully stored message (DM or round chat)
-- sent into a conversation/round that has at least one other eligible
-- account. Browsing, app opens, refreshes, hosting, posts and Caddie do not
-- count (feature metrics only).
--
-- Indexes: created_at / joined_at on the source tables for bounded scans.
--
-- ROLLBACK (also in scratchpad analytics-rollback.sql):
--   drop function if exists public.admin_analytics_activity(date, date);
--   drop function if exists public.admin_analytics_retention(date, date);
--   drop function if exists public.admin_analytics_golf_calls(date, date);
--   drop function if exists public.admin_analytics_social(date, date);
--   drop function if exists public.admin_analytics_exclusions();
--   drop trigger if exists trg_analytics_round_participation on public.round_participants;
--   drop trigger if exists trg_analytics_round_status on public.golf_calls;
--   drop trigger if exists trg_analytics_onboarding on public.profiles;
--   drop function if exists private.analytics_capture_round_participation();
--   drop function if exists private.analytics_capture_round_status();
--   drop function if exists private.analytics_capture_onboarding();
--   drop function if exists private.analytics_activity(timestamptz, timestamptz);
--   drop function if exists private.analytics_window(date, date);
--   drop function if exists private.analytics_excluded_ids();
--   drop function if exists private.analytics_tz();
--   drop table if exists private.analytics_events;
--   drop table if exists private.analytics_meta;
--   drop table if exists private.analytics_excluded_users;
--   drop index if exists public.analytics_messages_created_at_idx;
--   drop index if exists public.analytics_round_messages_created_at_idx;
--   drop index if exists public.analytics_round_participants_joined_at_idx;
--   drop index if exists public.analytics_golf_calls_created_at_idx;
--   drop index if exists public.analytics_profiles_created_at_idx;
--   drop index if exists public.analytics_community_comments_created_at_idx;
--   drop index if exists public.analytics_post_votes_created_at_idx;
--   drop index if exists public.analytics_comment_votes_created_at_idx;

-- ---------------------------------------------------------------- config

create table private.analytics_excluded_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text not null check (reason in ('founder', 'admin', 'test', 'bot', 'other')),
  note text check (note is null or char_length(note) <= 200),
  added_at timestamptz not null default now()
);
comment on table private.analytics_excluded_users is
  'Accounts excluded from every admin analytics number, by stable auth id. Edited by hand in the SQL editor only.';
alter table private.analytics_excluded_users enable row level security;
revoke all on table private.analytics_excluded_users from public, anon, authenticated;

create table private.analytics_meta (
  key text primary key,
  value_at timestamptz not null
);
alter table private.analytics_meta enable row level security;
revoke all on table private.analytics_meta from public, anon, authenticated;
insert into private.analytics_meta (key, value_at) values ('events_tracking_started_at', now())
  on conflict (key) do nothing;

create table private.analytics_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'round_joined', 'round_left', 'round_completed', 'round_cancelled', 'onboarding_completed'
  )),
  event_version smallint not null default 1 check (event_version = 1),
  user_id uuid not null references auth.users (id) on delete cascade,
  round_id uuid,
  occurred_at timestamptz not null,
  idempotency_key text not null unique check (char_length(idempotency_key) <= 200),
  recorded_at timestamptz not null default clock_timestamp()
);
comment on table private.analytics_events is
  'v1 server-side analytics events for facts the source tables overwrite or never store. Trigger-written only. No content, no device data.';
alter table private.analytics_events enable row level security;
revoke all on table private.analytics_events from public, anon, authenticated;
create index analytics_events_type_time_idx on private.analytics_events (event_type, occurred_at);
create index analytics_events_user_idx on private.analytics_events (user_id);
create index analytics_events_round_idx on private.analytics_events (round_id) where round_id is not null;

create index if not exists analytics_messages_created_at_idx on public.messages (created_at);
create index if not exists analytics_round_messages_created_at_idx on public.round_messages (created_at);
create index if not exists analytics_round_participants_joined_at_idx on public.round_participants (joined_at);
create index if not exists analytics_golf_calls_created_at_idx on public.golf_calls (created_at);
create index if not exists analytics_profiles_created_at_idx on public.profiles (created_at);
create index if not exists analytics_community_comments_created_at_idx on public.community_comments (created_at);
create index if not exists analytics_post_votes_created_at_idx on public.community_post_votes (created_at);
create index if not exists analytics_comment_votes_created_at_idx on public.community_comment_votes (created_at);

-- ---------------------------------------------------------------- helpers

-- The one reporting timezone. Change it here only.
create function private.analytics_tz()
returns text
language sql
immutable
set search_path = ''
as $$ select 'America/New_York'::text $$;

create function private.analytics_excluded_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select x.user_id from private.analytics_excluded_users x
  union
  select r.user_id from public.user_roles r
  where r.active and r.role in ('admin', 'test', 'app_reviewer', 'bot', 'seeded')
$$;

-- Validates a reporting range and returns its half-open bounds.
-- prev_* is the immediately preceding window of the same elapsed length
-- (so a partial current period is compared like for like).
create function private.analytics_window(p_from date, p_to date)
returns table (
  start_at timestamptz,
  end_at timestamptz,
  effective_end timestamptz,
  prev_start timestamptz,
  prev_end timestamptz,
  days int,
  partial boolean,
  today date
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text := private.analytics_tz();
  v_today date := (now() at time zone v_tz)::date;
  v_start timestamptz;
  v_end timestamptz;
  v_eff timestamptz;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'Invalid range: from <= to, at most 366 days.' using errcode = '22023';
  end if;
  if p_from > v_today then
    raise exception 'Invalid range: starts in the future.' using errcode = '22023';
  end if;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;
  v_eff := least(v_end, now());
  return query select
    v_start, v_end, v_eff,
    v_start - (v_eff - v_start), v_start,
    (p_to - p_from + 1)::int,
    v_end > now(),
    v_today;
end;
$$;

-- Every qualifying activity in [p_start, p_end) by eligible accounts.
-- One row per source record; callers dedupe by user (and day).
create function private.analytics_activity(p_start timestamptz, p_end timestamptz)
returns table (user_id uuid, occurred_at timestamptz, source text)
language sql
stable
security definer
set search_path = ''
as $$
  with ex as (select e as user_id from private.analytics_excluded_ids() e)
  select a.user_id, a.occurred_at, a.source
  from (
    -- Latest join per (round, golfer) as stored; earlier joins only via events.
    select rp.user_id, rp.joined_at as occurred_at, 'round_join'::text as source
    from public.round_participants rp
    join public.golf_calls g on g.id = rp.round_id
    where rp.user_id <> g.host_user_id
      and rp.joined_at >= p_start and rp.joined_at < p_end
    union all
    select ev.user_id, ev.occurred_at, 'round_join'
    from private.analytics_events ev
    where ev.event_type = 'round_joined'
      and ev.occurred_at >= p_start and ev.occurred_at < p_end
    union all
    select m.sender_id, m.created_at, 'dm'
    from public.messages m
    where m.created_at >= p_start and m.created_at < p_end
      and exists (
        select 1 from public.conversation_participants cp
        where cp.conversation_id = m.conversation_id
          and cp.user_id <> m.sender_id
          and cp.user_id not in (select user_id from ex)
      )
    union all
    select rm.sender_id, rm.created_at, 'round_message'
    from public.round_messages rm
    join public.golf_calls g on g.id = rm.round_id
    where rm.created_at >= p_start and rm.created_at < p_end
      and (
        (g.host_user_id <> rm.sender_id and g.host_user_id not in (select user_id from ex))
        or exists (
          select 1 from public.round_participants rp
          where rp.round_id = rm.round_id
            and rp.user_id <> rm.sender_id
            and rp.user_id not in (select user_id from ex)
        )
      )
  ) a
  where a.user_id not in (select user_id from ex)
$$;

revoke execute on function private.analytics_excluded_ids() from public, anon, authenticated;
revoke execute on function private.analytics_window(date, date) from public, anon, authenticated;
revoke execute on function private.analytics_activity(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function private.analytics_tz() from public, anon, authenticated;

-- ---------------------------------------------------------------- capture triggers

create function private.analytics_capture_round_participation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid;
begin
  begin
    select g.host_user_id into v_host from public.golf_calls g where g.id = new.round_id;
    -- The host's own auto-inserted row is not a join.
    if v_host is not null and new.user_id <> v_host then
      if new.participant_status = 'joined'
         and (tg_op = 'INSERT'
              or old.participant_status is distinct from 'joined'
              or old.joined_at is distinct from new.joined_at) then
        insert into private.analytics_events (event_type, user_id, round_id, occurred_at, idempotency_key)
        values ('round_joined', new.user_id, new.round_id, new.joined_at,
                'round_joined:' || new.round_id || ':' || new.user_id || ':' || extract(epoch from new.joined_at)::text)
        on conflict (idempotency_key) do nothing;
      elsif tg_op = 'UPDATE' and old.participant_status = 'joined' and new.participant_status = 'left' then
        insert into private.analytics_events (event_type, user_id, round_id, occurred_at, idempotency_key)
        values ('round_left', new.user_id, new.round_id, now(),
                'round_left:' || new.round_id || ':' || new.user_id || ':' || extract(epoch from now())::text)
        on conflict (idempotency_key) do nothing;
      end if;
    end if;
  exception when others then
    raise warning 'analytics capture skipped (%)', sqlstate;
  end;
  return null;
end;
$$;

create function private.analytics_capture_round_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into private.analytics_events (event_type, user_id, round_id, occurred_at, idempotency_key)
    values ('round_' || new.status, new.host_user_id, new.id, now(),
            'round_' || new.status || ':' || new.id || ':' || extract(epoch from now())::text)
    on conflict (idempotency_key) do nothing;
  exception when others then
    raise warning 'analytics capture skipped (%)', sqlstate;
  end;
  return null;
end;
$$;

create function private.analytics_capture_onboarding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    -- First completion only: a later reset + redo keeps the original time.
    insert into private.analytics_events (event_type, user_id, occurred_at, idempotency_key)
    values ('onboarding_completed', new.id, now(), 'onboarding_completed:' || new.id)
    on conflict (idempotency_key) do nothing;
  exception when others then
    raise warning 'analytics capture skipped (%)', sqlstate;
  end;
  return null;
end;
$$;

revoke execute on function private.analytics_capture_round_participation() from public, anon, authenticated;
revoke execute on function private.analytics_capture_round_status() from public, anon, authenticated;
revoke execute on function private.analytics_capture_onboarding() from public, anon, authenticated;

create trigger trg_analytics_round_participation
  after insert or update of participant_status, joined_at on public.round_participants
  for each row execute function private.analytics_capture_round_participation();

create trigger trg_analytics_round_status
  after update of status on public.golf_calls
  for each row
  when (new.status in ('completed', 'cancelled') and old.status is distinct from new.status)
  execute function private.analytics_capture_round_status();

create trigger trg_analytics_onboarding
  after update of has_onboarded on public.profiles
  for each row
  when (new.has_onboarded = true and old.has_onboarded is distinct from true)
  execute function private.analytics_capture_onboarding();

-- ---------------------------------------------------------------- admin RPCs

create function public.admin_analytics_activity(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := private.analytics_tz();
  w record;
  v_tracking timestamptz;
  v_result jsonb;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select * into w from private.analytics_window(p_from, p_to);
  select value_at into v_tracking from private.analytics_meta where key = 'events_tracking_started_at';

  with cur as (
    select a.user_id, a.occurred_at, a.source from private.analytics_activity(w.start_at, w.effective_end) a
  ), cur_users as (
    select distinct user_id from cur
  ), prev_users as (
    select distinct a.user_id from private.analytics_activity(w.prev_start, w.prev_end) a
  ), earlier as (
    select distinct a.user_id from private.analytics_activity('-infinity'::timestamptz, w.start_at) a
  ), days as (
    select d::date as day
    from generate_series(p_from::timestamp, least(p_to, w.today)::timestamp, interval '1 day') d
  ), daily as (
    select (c.occurred_at at time zone v_tz)::date as day, count(distinct c.user_id) as active
    from cur c group by 1
  ), now5 as (
    select count(distinct a.user_id) as n from private.analytics_activity(now() - interval '5 minutes', now()) a
  ), today_u as (
    select count(distinct a.user_id) as n
    from private.analytics_activity(w.today::timestamp at time zone v_tz, now()) a
  ), r7 as (
    select count(distinct a.user_id) as n from private.analytics_activity(now() - interval '7 days', now()) a
  ), r30 as (
    select count(distinct a.user_id) as n from private.analytics_activity(now() - interval '30 days', now()) a
  ), s30 as (
    -- 30 complete reporting days ending yesterday.
    select a.user_id, (a.occurred_at at time zone v_tz)::date as day
    from private.analytics_activity((w.today - 30)::timestamp at time zone v_tz, w.today::timestamp at time zone v_tz) a
  )
  select jsonb_build_object(
    'version', 1,
    'timezone', v_tz,
    'range', jsonb_build_object(
      'from', p_from, 'to', p_to, 'start_at', w.start_at, 'end_at', w.end_at,
      'partial', w.partial, 'prev_start', w.prev_start, 'prev_end', w.prev_end, 'days', w.days),
    'active_users', (select count(*) from cur_users),
    'prev_active_users', (select count(*) from prev_users),
    'new_active_users', (select count(*) from cur_users u where u.user_id not in (select user_id from earlier)),
    'returning_active_users', (select count(*) from cur_users u where u.user_id in (select user_id from earlier)),
    'by_source', jsonb_build_object(
      'round_join', (select count(distinct user_id) from cur where source = 'round_join'),
      'dm', (select count(distinct user_id) from cur where source = 'dm'),
      'round_message', (select count(distinct user_id) from cur where source = 'round_message')),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'active', coalesce(dl.active, 0), 'partial', d.day = w.today) order by d.day)
      from days d left join daily dl on dl.day = d.day), '[]'::jsonb),
    'active_last_5_min', (select n from now5),
    'dau_today', (select n from today_u),
    'wau_rolling_7d', (select n from r7),
    'mau_rolling_30d', (select n from r30),
    'stickiness_30d', jsonb_build_object(
      'avg_dau', (select round(count(distinct (user_id, day))::numeric / 30, 2) from s30),
      'unique_users', (select count(distinct user_id) from s30)),
    'coverage', jsonb_build_object(
      'events_tracking_started_at', v_tracking,
      'join_history', 'Before events_tracking_started_at only the latest join per golfer per round is stored; earlier joins of re-joined rounds are not counted.',
      'deleted_accounts', 'Deleted accounts and their messages are gone and never counted.')
  ) into v_result;
  return v_result;
end;
$$;

create function public.admin_analytics_retention(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := private.analytics_tz();
  w record;
  v_tracking timestamptz;
  v_result jsonb;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select * into w from private.analytics_window(p_from, p_to);
  select value_at into v_tracking from private.analytics_meta where key = 'events_tracking_started_at';

  with cohort as (
    select p.id as user_id, p.created_at, (p.created_at at time zone v_tz)::date as signup_day, p.has_onboarded
    from public.profiles p
    where p.created_at >= w.start_at and p.created_at < w.effective_end
      and p.id not in (select e from private.analytics_excluded_ids() e)
  ), act as (
    select a.user_id, a.occurred_at, (a.occurred_at at time zone v_tz)::date as day
    from private.analytics_activity(w.start_at, now()) a
    where a.user_id in (select user_id from cohort)
  ), per_user as (
    select c.user_id, c.signup_day, c.has_onboarded, c.created_at,
      (select min(a.occurred_at) from act a where a.user_id = c.user_id and a.occurred_at >= c.created_at) as first_at,
      exists (select 1 from act a where a.user_id = c.user_id and a.day = c.signup_day + 1) as d1,
      exists (select 1 from act a where a.user_id = c.user_id and a.day = c.signup_day + 7) as d7,
      exists (select 1 from act a where a.user_id = c.user_id and a.day = c.signup_day + 30) as d30
    from cohort c
  ), by_day as (
    select signup_day, count(*) as size, count(*) filter (where has_onboarded) as onboarded,
      count(*) filter (where d1) as d1, count(*) filter (where d7) as d7, count(*) filter (where d30) as d30
    from per_user group by signup_day
  )
  select jsonb_build_object(
    'version', 1,
    'timezone', v_tz,
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'start_at', w.start_at, 'end_at', w.end_at, 'partial', w.partial),
    'cohort_users', (select count(*) from per_user),
    'onboarded_users', (select count(*) from per_user where has_onboarded),
    'onboarding_events_since_tracking', (
      select count(*) from private.analytics_events ev
      where ev.event_type = 'onboarding_completed' and ev.user_id in (select user_id from cohort)),
    'cohorts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', b.signup_day, 'size', b.size, 'onboarded', b.onboarded,
        'd1', case when b.signup_day + 1 < w.today then b.d1 end,
        'd7', case when b.signup_day + 7 < w.today then b.d7 end,
        'd30', case when b.signup_day + 30 < w.today then b.d30 end) order by b.signup_day)
      from by_day b), '[]'::jsonb),
    'd1', jsonb_build_object(
      'mature_users', (select count(*) from per_user where signup_day + 1 < w.today),
      'retained', (select count(*) from per_user where signup_day + 1 < w.today and d1),
      'pending_users', (select count(*) from per_user where signup_day + 1 >= w.today)),
    'd7', jsonb_build_object(
      'mature_users', (select count(*) from per_user where signup_day + 7 < w.today),
      'retained', (select count(*) from per_user where signup_day + 7 < w.today and d7),
      'pending_users', (select count(*) from per_user where signup_day + 7 >= w.today)),
    'd30', jsonb_build_object(
      'mature_users', (select count(*) from per_user where signup_day + 30 < w.today),
      'retained', (select count(*) from per_user where signup_day + 30 < w.today and d30),
      'pending_users', (select count(*) from per_user where signup_day + 30 >= w.today)),
    'first_activity', jsonb_build_object(
      'users_with_activity', (select count(*) from per_user where first_at is not null),
      'users_without_activity', (select count(*) from per_user where first_at is null),
      'median_hours', (
        select round((percentile_cont(0.5) within group (order by extract(epoch from (first_at - created_at)) / 3600))::numeric, 1)
        from per_user where first_at is not null)),
    'coverage', jsonb_build_object(
      'events_tracking_started_at', v_tracking,
      'onboarding', 'Onboarded = has_onboarded now. When they onboarded is only known for completions after events_tracking_started_at.',
      'cohort', 'Signup = profiles.created_at, eligible accounts only. Dn = activity on exactly signup day + n (reporting timezone). A day that has not fully ended is pending, never 0.')
  ) into v_result;
  return v_result;
end;
$$;

create function public.admin_analytics_golf_calls(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w record;
  v_tracking timestamptz;
  v_result jsonb;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select * into w from private.analytics_window(p_from, p_to);
  select value_at into v_tracking from private.analytics_meta where key = 'events_tracking_started_at';

  with ex as (
    select e as user_id from private.analytics_excluded_ids() e
  ), r as (
    -- Rounds hosted in range by eligible hosts.
    select g.id, g.host_user_id, g.created_at, g.date_iso, g.status, g.total_spots
    from public.golf_calls g
    where g.created_at >= w.start_at and g.created_at < w.effective_end
      and g.host_user_id not in (select user_id from ex)
  ), joiners as (
    -- Eligible non-host participant rows, any status (left rows keep "joined once").
    select rp.round_id, rp.user_id, rp.participant_status, rp.joined_at
    from public.round_participants rp
    join r on r.id = rp.round_id
    where rp.user_id <> r.host_user_id and rp.user_id not in (select user_id from ex)
  ), first_join as (
    select x.round_id, min(x.at) as at
    from (
      select round_id, joined_at as at from joiners
      union all
      select ev.round_id, ev.occurred_at from private.analytics_events ev
      join r on r.id = ev.round_id
      where ev.event_type = 'round_joined' and ev.user_id not in (select user_id from ex)
    ) x group by x.round_id
  ), per_round as (
    select r.*,
      (select count(*) from joiners j where j.round_id = r.id) as ever_joined,
      (select count(*) from joiners j where j.round_id = r.id and j.participant_status = 'joined') as joined_now,
      fj.at as first_join_at,
      exists (
        select 1 from public.round_reviews rv
        join public.round_participants rp on rp.round_id = rv.round_id and rp.user_id = rv.reviewer_user_id
        where rv.round_id = r.id and rv.reviewer_user_id <> r.host_user_id and rv.showed_up
          and rv.reviewer_user_id not in (select user_id from ex)
      ) as participant_confirmed
    from r left join first_join fj on fj.round_id = r.id
  ), joins_in_range as (
    -- Joins by eligible golfers in range, into any round (incl. excluded hosts').
    select x.user_id, x.round_id, x.host_excluded
    from (
      select rp.user_id, rp.round_id, g.host_user_id in (select user_id from ex) as host_excluded
      from public.round_participants rp join public.golf_calls g on g.id = rp.round_id
      where rp.user_id <> g.host_user_id and rp.joined_at >= w.start_at and rp.joined_at < w.effective_end
      union all
      select ev.user_id, ev.round_id, coalesce(g.host_user_id in (select user_id from ex), false)
      from private.analytics_events ev left join public.golf_calls g on g.id = ev.round_id
      where ev.event_type = 'round_joined' and ev.occurred_at >= w.start_at and ev.occurred_at < w.effective_end
    ) x
    where x.user_id not in (select user_id from ex)
  ), members as (
    -- Host + still-joined eligible golfers of non-cancelled rounds in range.
    select r.id as round_id, r.host_user_id as user_id from r where r.status <> 'cancelled'
    union
    select j.round_id, j.user_id from joiners j join r on r.id = j.round_id
    where j.participant_status = 'joined' and r.status <> 'cancelled'
  ), pairs as (
    select distinct least(a.user_id, b.user_id) as u1, greatest(a.user_id, b.user_id) as u2
    from members a join members b on a.round_id = b.round_id and a.user_id < b.user_id
  ), repeaters as (
    select user_id, count(distinct round_id) as rounds from joins_in_range group by user_id
  )
  select jsonb_build_object(
    'version', 1,
    'timezone', private.analytics_tz(),
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'start_at', w.start_at, 'end_at', w.end_at, 'partial', w.partial),
    'rounds_hosted', (select count(*) from per_round),
    'unique_hosts', (select count(distinct host_user_id) from per_round),
    'rounds_with_a_join', (select count(*) from per_round where ever_joined > 0),
    'fill', jsonb_build_object(
      'rounds', (select count(*) from per_round where status <> 'cancelled'),
      'slots_total', (select coalesce(sum(total_spots), 0) from per_round where status <> 'cancelled'),
      'slots_taken_now', (select coalesce(sum(1 + joined_now), 0) from per_round where status <> 'cancelled'),
      'rounds_full_now', (select count(*) from per_round where status <> 'cancelled' and 1 + joined_now >= total_spots)),
    'median_minutes_to_first_join', (
      select round((percentile_cont(0.5) within group (order by extract(epoch from (first_join_at - created_at)) / 60))::numeric, 1)
      from per_round where first_join_at is not null),
    'zero_join_past_rounds', (select count(*) from per_round where status <> 'cancelled' and date_iso < now() and ever_joined = 0),
    'zero_join_upcoming_rounds', (select count(*) from per_round where status <> 'cancelled' and date_iso >= now() and ever_joined = 0),
    'cancelled_rounds', (select count(*) from per_round where status = 'cancelled'),
    'cancel_events_in_range', (
      select count(*) from private.analytics_events ev
      where ev.event_type = 'round_cancelled' and ev.occurred_at >= w.start_at and ev.occurred_at < w.effective_end
        and ev.user_id not in (select user_id from ex)),
    'upcoming_now', (
      select count(*) from public.golf_calls g
      where g.status in ('open', 'full') and g.date_iso >= now()
        and g.host_user_id not in (select user_id from ex)),
    'played', jsonb_build_object(
      'host_confirmed', (select count(*) from per_round where status = 'completed'),
      'participant_confirmed', (select count(*) from per_round where participant_confirmed),
      'both', (select count(*) from per_round where status = 'completed' and participant_confirmed),
      'combined_deduped', (select count(*) from per_round where status = 'completed' or participant_confirmed),
      'estimated', null),
    'unique_joiners', (select count(distinct user_id) from joins_in_range),
    'joiners_into_excluded_hosts_rounds', (select count(distinct user_id) from joins_in_range where host_excluded),
    'repeat_joiners', (select count(*) from repeaters where rounds >= 2),
    'co_participation_pairs', (select count(*) from pairs),
    'coverage', jsonb_build_object(
      'events_tracking_started_at', v_tracking,
      'first_join', 'Before tracking, a re-join overwrote joined_at, so time to first join can read later than it was.',
      'fill', 'Current membership only: a round that filled and then lost a golfer reads as not full.',
      'cancelled', 'Cancel time is only known for cancellations after tracking; cancelled_rounds is by hosted date.',
      'participant_confirmed', 'A joined golfer (not the host) submitted a post-round review saying someone showed up. Reviews need host-marked completion, so it is a subset of host_confirmed.',
      'estimated', 'Unavailable: no agreed heuristic. Past tee time is never treated as played.',
      'pairs', 'Co-participation in the same non-cancelled round. Not friendship and not proof they met.')
  ) into v_result;
  return v_result;
end;
$$;

create function public.admin_analytics_social(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w record;
  v_result jsonb;
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select * into w from private.analytics_window(p_from, p_to);

  with ex as (
    select e as user_id from private.analytics_excluded_ids() e
  ), act as (
    select distinct a.user_id, a.source from private.analytics_activity(w.start_at, w.effective_end) a
  ), active as (
    select distinct user_id from act
  ), dm as (
    -- Eligible human DMs in range, into conversations with another eligible account.
    select m.id, m.conversation_id, m.sender_id, m.created_at, m.unsent_at
    from public.messages m
    where m.created_at >= w.start_at and m.created_at < w.effective_end
      and m.sender_id not in (select user_id from ex)
      and exists (
        select 1 from public.conversation_participants cp
        where cp.conversation_id = m.conversation_id and cp.user_id <> m.sender_id
          and cp.user_id not in (select user_id from ex))
  ), rmsg as (
    -- Same rule as analytics_activity: another eligible host/participant.
    select rm.id, rm.round_id, rm.sender_id, rm.created_at
    from public.round_messages rm
    join public.golf_calls g on g.id = rm.round_id
    where rm.created_at >= w.start_at and rm.created_at < w.effective_end
      and rm.sender_id not in (select user_id from ex)
      and (
        (g.host_user_id <> rm.sender_id and g.host_user_id not in (select user_id from ex))
        or exists (
          select 1 from public.round_participants rp
          where rp.round_id = rm.round_id and rp.user_id <> rm.sender_id
            and rp.user_id not in (select user_id from ex)))
  ), conv_first as (
    -- Per conversation and eligible sender: first message ever.
    select m.conversation_id, m.sender_id, min(m.created_at) as first_at
    from public.messages m
    where m.sender_id not in (select user_id from ex)
      and m.conversation_id in (select conversation_id from dm)
    group by m.conversation_id, m.sender_id
  ), conv_two_way_at as (
    -- The moment a conversation first had a second eligible sender.
    select conversation_id, first_at as two_way_at
    from (
      select conversation_id, first_at, row_number() over (partition by conversation_id order by first_at) as rn
      from conv_first
    ) x where rn = 2
  ), posts as (
    select cp.id, cp.author_id from public.community_posts cp
    where cp.created_at >= w.start_at and cp.created_at < w.effective_end
      and cp.author_id not in (select user_id from ex)
  ), comments as (
    select cc.author_id from public.community_comments cc
    where cc.created_at >= w.start_at and cc.created_at < w.effective_end
      and cc.author_id not in (select user_id from ex)
  ), interactors as (
    select author_id as user_id from comments
    union
    select v.voter_id from public.community_post_votes v
    where v.created_at >= w.start_at and v.created_at < w.effective_end and v.voter_id not in (select user_id from ex)
    union
    select v.voter_id from public.community_comment_votes v
    where v.created_at >= w.start_at and v.created_at < w.effective_end and v.voter_id not in (select user_id from ex)
  ), community_users as (
    select author_id as user_id from posts union select user_id from interactors
  ), messaging_users as (
    select sender_id as user_id from dm union select sender_id from rmsg
  )
  select jsonb_build_object(
    'version', 1,
    'timezone', private.analytics_tz(),
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'start_at', w.start_at, 'end_at', w.end_at, 'partial', w.partial),
    'active_users', (select count(*) from active),
    'messaging_users', (select count(*) from messaging_users),
    'dm_senders', (select count(distinct sender_id) from dm),
    'round_chat_senders', (select count(distinct sender_id) from rmsg),
    'dm_messages', (select count(*) from dm),
    'dm_messages_later_unsent', (select count(*) from dm where unsent_at is not null),
    'round_chat_messages', (select count(*) from rmsg),
    'messages_per_active_user', (
      select case when (select count(*) from active) = 0 then null
        else round(((select count(*) from dm) + (select count(*) from rmsg))::numeric / (select count(*) from active), 2) end),
    'two_way_dm_conversations', (
      select count(*) from (select conversation_id from dm group by conversation_id having count(distinct sender_id) >= 2) t),
    'new_two_way_dm_conversations', (
      select count(*) from conv_two_way_at where two_way_at >= w.start_at and two_way_at < w.effective_end),
    'round_chats_active', (select count(distinct round_id) from rmsg),
    'round_chats_two_way', (
      select count(*) from (select round_id from rmsg group by round_id having count(distinct sender_id) >= 2) t),
    'post_creators', (select count(distinct author_id) from posts),
    'posts', (select count(*) from posts),
    'commenters', (select count(distinct author_id) from comments),
    'post_interactors', (select count(*) from interactors),
    'community_users', (select count(*) from community_users),
    'active_in_community', (select count(*) from active a where a.user_id in (select user_id from community_users)),
    'active_messaging', (select count(*) from active a where a.user_id in (select user_id from messaging_users)),
    'coverage', jsonb_build_object(
      'messages', 'Stored messages only (a failed send leaves no row). Unsent messages still count as sent. Deleted accounts take their messages with them.',
      'community', 'Current rows: a deleted post/comment or a removed like is gone. Likes are one per golfer per post, so no double counting.',
      'two_way', 'Two different eligible accounts each sent at least one message. The automated founder welcome never counts.')
  ) into v_result;
  return v_result;
end;
$$;

create function public.admin_analytics_exclusions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'version', 1,
    'listed', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', p.name, 'reason', x.reason, 'added_at', x.added_at) order by x.added_at)
      from private.analytics_excluded_users x left join public.profiles p on p.id = x.user_id), '[]'::jsonb),
    'by_role', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'name', p.name, 'role', r.role) order by r.role, r.user_id)
      from public.user_roles r left join public.profiles p on p.id = r.user_id
      where r.active and r.role in ('admin', 'test', 'app_reviewer', 'bot', 'seeded')), '[]'::jsonb),
    'excluded_total', (select count(*) from private.analytics_excluded_ids())
  );
end;
$$;

revoke execute on function public.admin_analytics_activity(date, date) from public, anon;
revoke execute on function public.admin_analytics_retention(date, date) from public, anon;
revoke execute on function public.admin_analytics_golf_calls(date, date) from public, anon;
revoke execute on function public.admin_analytics_social(date, date) from public, anon;
revoke execute on function public.admin_analytics_exclusions() from public, anon;
grant execute on function public.admin_analytics_activity(date, date) to authenticated;
grant execute on function public.admin_analytics_retention(date, date) to authenticated;
grant execute on function public.admin_analytics_golf_calls(date, date) to authenticated;
grant execute on function public.admin_analytics_social(date, date) to authenticated;
grant execute on function public.admin_analytics_exclusions() to authenticated;

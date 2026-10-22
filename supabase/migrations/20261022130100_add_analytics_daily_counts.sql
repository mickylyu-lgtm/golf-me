-- Privacy-safe product analytics (2026-10-22): anonymous daily counts of a
-- few whitelisted funnel events (first-round hosting onboarding + sharing).
--
-- What is stored: (UTC day, event name, count). Nothing else -- no user id,
-- device id, IP, properties or timestamps finer than a day. One row per
-- event per day, so the table stays tiny.
--
-- Access:
--   * RLS on with no policies, and every table privilege revoked from anon
--     and authenticated: no client can read or write the table directly.
--   * Writes only through track_analytics_event() (SECURITY DEFINER,
--     search_path = ''), callable by signed-in users only. It accepts a
--     whitelisted event name and adds exactly 1 -- the caller never chooses
--     the amount, the day or anything else.
--   * Reads only through admin_analytics_daily_counts(), gated on
--     private.has_role(auth.uid(), 'admin') like every other admin_* RPC.
--
-- Abuse: a signed-in user calling the RPC in a loop can inflate a count
-- (there is deliberately no per-user state to rate-limit on). The numbers
-- are a product signal, not billing; each (day, event) also stops at
-- 1,000,000 so a runaway client can't grow it without bound.
--
-- Rollback:
--   drop function if exists public.admin_analytics_daily_counts(integer);
--   drop function if exists public.track_analytics_event(text);
--   drop table if exists public.analytics_daily_counts;

create table public.analytics_daily_counts (
  day date not null,
  event text not null,
  count bigint not null default 0,
  primary key (day, event),
  constraint analytics_daily_counts_count_nonnegative check (count >= 0),
  constraint analytics_daily_counts_event_whitelist check (event in (
    'first_round_prompt_shown',
    'first_round_host_started',
    'first_round_hosted',
    'round_shared',
    'app_shared'
  ))
);

comment on table public.analytics_daily_counts is
  'Anonymous daily event counts. No user/device identifiers. Write via track_analytics_event(), read via admin_analytics_daily_counts().';

alter table public.analytics_daily_counts enable row level security;
revoke all on table public.analytics_daily_counts from public, anon, authenticated;

create function public.track_analytics_event(p_event text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if p_event is null or p_event not in (
    'first_round_prompt_shown',
    'first_round_host_started',
    'first_round_hosted',
    'round_shared',
    'app_shared'
  ) then
    raise exception 'Unknown analytics event.' using errcode = '22023';
  end if;

  insert into public.analytics_daily_counts as c (day, event, count)
  values ((now() at time zone 'utc')::date, p_event, 1)
  on conflict (day, event) do update
    set count = least(c.count + 1, 1000000);
end;
$$;

revoke execute on function public.track_analytics_event(text) from public, anon;
grant execute on function public.track_analytics_event(text) to authenticated;

create function public.admin_analytics_daily_counts(p_days integer default 30)
returns table (day date, event text, count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return query
  select c.day, c.event, c.count
  from public.analytics_daily_counts c
  where c.day > (now() at time zone 'utc')::date - greatest(1, least(coalesce(p_days, 30), 366))
  order by c.day desc, c.event;
end;
$$;

revoke execute on function public.admin_analytics_daily_counts(integer) from public, anon;
grant execute on function public.admin_analytics_daily_counts(integer) to authenticated;

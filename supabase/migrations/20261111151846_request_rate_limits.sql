-- Prepared only. Apply before deploying the five protected request handlers.
-- Central counters survive function replicas, deploys, IP changes and token refresh.
-- Two fixed windows anchored at the first admitted request. A boundary can allow
-- up to twice a window's quota in a short interval; this is not a sliding limit.
-- No request bodies, IP addresses, tokens or provider credentials are stored.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create schema if not exists private;
create table private.request_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in (
    'course-search', 'course-enrich', 'course-photos',
    'translate-caddie-analysis', 'chat-video'
  )),
  minute_started_at timestamptz not null,
  minute_used integer not null check (minute_used >= 0),
  day_started_at timestamptz not null,
  day_used integer not null check (day_used >= 0),
  primary key (user_id, action)
);
alter table private.request_rate_limits enable row level security;
revoke all on private.request_rate_limits from public, anon, authenticated, service_role;

-- The only exposed operation spends the caller's OWN budget. No caller-selected
-- user, limit, window, reset or refund is accepted. Definer rights are necessary
-- solely to update counters that callers must not be able to reset or read.
create function public.consume_request_budget(p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_minute_limit integer;
  v_day_limit integer;
  v_now timestamptz;
  v_row private.request_rate_limits%rowtype;
  v_retry integer := 0;
begin
  if v_user is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  case p_action
    when 'course-search' then v_minute_limit := 30; v_day_limit := 600;
    when 'course-enrich' then v_minute_limit := 10; v_day_limit := 40;
    when 'course-photos' then v_minute_limit := 120; v_day_limit := 3000;
    when 'translate-caddie-analysis' then v_minute_limit := 12; v_day_limit := 120;
    when 'chat-video' then v_minute_limit := 30; v_day_limit := 120;
    else raise exception 'unsupported_action' using errcode = '22023';
  end case;

  -- The unique-key insert and row lock serialize every replica for this account
  -- and action. Limits are all-or-nothing, so a blocked minute spends no day slot.
  v_now := clock_timestamp();
  insert into private.request_rate_limits
    (user_id, action, minute_started_at, minute_used, day_started_at, day_used)
  values (v_user, p_action, v_now, 0, v_now, 0)
  on conflict (user_id, action) do nothing;
  select * into strict v_row from private.request_rate_limits
    where user_id = v_user and action = p_action for update;
  v_now := clock_timestamp(); -- sample after any lock wait
  if v_now >= v_row.minute_started_at + interval '1 minute' then
    v_row.minute_started_at := v_now;
    v_row.minute_used := 0;
  end if;
  if v_now >= v_row.day_started_at + interval '24 hours' then
    v_row.day_started_at := v_now;
    v_row.day_used := 0;
  end if;
  if v_row.minute_used >= v_minute_limit then
    v_retry := greatest(v_retry, ceil(extract(epoch from
      v_row.minute_started_at + interval '1 minute' - v_now))::integer);
  end if;
  if v_row.day_used >= v_day_limit then
    v_retry := greatest(v_retry, ceil(extract(epoch from
      v_row.day_started_at + interval '24 hours' - v_now))::integer);
  end if;
  if v_retry > 0 then
    return jsonb_build_object('allowed', false, 'retry_after_seconds', v_retry);
  end if;
  update private.request_rate_limits set
    minute_started_at = v_row.minute_started_at,
    minute_used = v_row.minute_used + 1,
    day_started_at = v_row.day_started_at,
    day_used = v_row.day_used + 1
  where user_id = v_user and action = p_action;
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;
revoke all on function public.consume_request_budget(text) from public, anon, authenticated, service_role;
grant execute on function public.consume_request_budget(text) to authenticated;
comment on function public.consume_request_budget(text) is
  'Atomic own-account request budgets; fixed minute/day windows. Call before costly provider or transcoding work. Missing/error must fail closed.';
commit;

-- Admin dashboard: Caddie usage stats. Same private.has_role() admin gate
-- as every other admin RPC (see 20260818090000_add_admin_dashboard_rpcs.sql).
--
-- Note on scope: a failed analysis deletes its row rather than keeping it
-- as a visible 'failed' entry (see analyze-swing/index.ts's fail()) -- so
-- there is no queryable "failure rate" here, only what's left after
-- failures are cleaned up. That's an intentional product decision from
-- earlier in the project, not an oversight; tracking failure rate for
-- real would mean retaining failed rows (or a separate lightweight event
-- log), a deliberate follow-up if ever wanted, not bundled into this pass.
create function public.admin_caddie_stats()
returns table (
  total_analyses bigint,
  analyses_last_24h bigint,
  analyses_last_7d bigint,
  processing_now bigint,
  unique_users bigint,
  avg_score numeric,
  score_low_count bigint,
  score_mid_count bigint,
  score_high_count bigint
)
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
  select
    count(*) as total_analyses,
    count(*) filter (where a.created_at >= now() - interval '24 hours') as analyses_last_24h,
    count(*) filter (where a.created_at >= now() - interval '7 days') as analyses_last_7d,
    count(*) filter (where a.status = 'processing') as processing_now,
    count(distinct a.owner_id) as unique_users,
    round(avg(a.score) filter (where a.status = 'complete'), 1) as avg_score,
    count(*) filter (where a.status = 'complete' and a.score < 40) as score_low_count,
    count(*) filter (where a.status = 'complete' and a.score >= 40 and a.score < 70) as score_mid_count,
    count(*) filter (where a.status = 'complete' and a.score >= 70) as score_high_count
  from public.caddie_analyses a;
end;
$$;
revoke execute on function public.admin_caddie_stats() from public, anon;
grant execute on function public.admin_caddie_stats() to authenticated;

-- Recent analyses roster, newest first -- same "who/what/when" shape as
-- admin_list_users, scoped to Caddie specifically.
create function public.admin_list_caddie_analyses(p_limit integer default 50)
returns table (
  id uuid,
  owner_name text,
  owner_email text,
  swing_type text,
  status text,
  score smallint,
  created_at timestamptz
)
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
  select a.id, p.name, u.email::text, a.swing_type, a.status, a.score, a.created_at
  from public.caddie_analyses a
  join public.profiles p on p.id = a.owner_id
  join auth.users u on u.id = a.owner_id
  order by a.created_at desc
  limit least(coalesce(p_limit, 50), 200);
end;
$$;
revoke execute on function public.admin_list_caddie_analyses(integer) from public, anon;
grant execute on function public.admin_list_caddie_analyses(integer) to authenticated;

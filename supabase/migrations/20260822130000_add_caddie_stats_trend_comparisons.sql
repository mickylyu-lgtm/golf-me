drop function if exists public.admin_caddie_stats();

-- Adds prior-period comparisons so the dashboard can show growth/decline
-- arrows: last 24h vs the 24h before that, last 7d vs the 7d before that,
-- and average score over the last 7d vs the 7d before that (a genuinely
-- meaningful trend given tonight's scoring recalibration).
create function public.admin_caddie_stats()
returns table (
  total_analyses bigint,
  analyses_last_24h bigint,
  analyses_prev_24h bigint,
  analyses_last_7d bigint,
  analyses_prev_7d bigint,
  processing_now bigint,
  unique_users bigint,
  avg_score numeric,
  avg_score_prev_7d numeric,
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
    count(*) filter (where a.created_at >= now() - interval '48 hours' and a.created_at < now() - interval '24 hours') as analyses_prev_24h,
    count(*) filter (where a.created_at >= now() - interval '7 days') as analyses_last_7d,
    count(*) filter (where a.created_at >= now() - interval '14 days' and a.created_at < now() - interval '7 days') as analyses_prev_7d,
    count(*) filter (where a.status = 'processing') as processing_now,
    count(distinct a.owner_id) as unique_users,
    round(avg(a.score) filter (where a.status = 'complete'), 1) as avg_score,
    round(avg(a.score) filter (where a.status = 'complete' and a.created_at >= now() - interval '14 days' and a.created_at < now() - interval '7 days'), 1) as avg_score_prev_7d,
    count(*) filter (where a.status = 'complete' and a.score < 40) as score_low_count,
    count(*) filter (where a.status = 'complete' and a.score >= 40 and a.score < 70) as score_mid_count,
    count(*) filter (where a.status = 'complete' and a.score >= 70) as score_high_count
  from public.caddie_analyses a;
end;
$$;
revoke execute on function public.admin_caddie_stats() from public, anon;
grant execute on function public.admin_caddie_stats() to authenticated;

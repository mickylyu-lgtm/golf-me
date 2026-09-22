-- Admin platform-overview + domain stats for the pre-launch dashboard.
-- Same access model as every other admin RPC: private.has_role() check,
-- SECURITY DEFINER, revoked from public/anon, granted to authenticated.
-- All read-only (stable), no writes.

create function public.admin_platform_overview()
returns table (
  total_users bigint,
  onboarded_users bigint,
  golf_calls_total bigint,
  rounds_completed bigint,
  community_posts_total bigint,
  messages_total bigint,
  caddie_analyses_total bigint,
  push_tokens_registered bigint
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
    (select count(*) from public.profiles),
    (select count(*) from public.profiles where has_onboarded),
    (select count(*) from public.golf_calls),
    (select count(*) from public.golf_calls where status = 'completed'),
    (select count(*) from public.community_posts),
    (select count(*) from public.messages),
    (select count(*) from public.caddie_analyses),
    (select count(*) from public.device_push_tokens);
end;
$$;
revoke execute on function public.admin_platform_overview() from public, anon;
grant execute on function public.admin_platform_overview() to authenticated;


create function public.admin_golf_call_stats()
returns table (
  total bigint,
  open_count bigint,
  full_count bigint,
  completed_count bigint,
  cancelled_count bigint,
  avg_participants numeric,
  hosted_last_24h bigint,
  hosted_prev_24h bigint,
  hosted_last_7d bigint,
  hosted_prev_7d bigint
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
    count(*) as total,
    count(*) filter (where gc.status = 'open') as open_count,
    count(*) filter (where gc.status = 'full') as full_count,
    count(*) filter (where gc.status = 'completed') as completed_count,
    count(*) filter (where gc.status = 'cancelled') as cancelled_count,
    (
      select round(avg(joined_n), 1)
      from (
        select count(*) as joined_n
        from public.round_participants rp
        where rp.participant_status = 'joined'
        group by rp.round_id
      ) counts
    ) as avg_participants,
    count(*) filter (where gc.created_at >= now() - interval '24 hours') as hosted_last_24h,
    count(*) filter (where gc.created_at >= now() - interval '48 hours' and gc.created_at < now() - interval '24 hours') as hosted_prev_24h,
    count(*) filter (where gc.created_at >= now() - interval '7 days') as hosted_last_7d,
    count(*) filter (where gc.created_at >= now() - interval '14 days' and gc.created_at < now() - interval '7 days') as hosted_prev_7d
  from public.golf_calls gc;
end;
$$;
revoke execute on function public.admin_golf_call_stats() from public, anon;
grant execute on function public.admin_golf_call_stats() to authenticated;


create function public.admin_community_stats()
returns table (
  posts_total bigint,
  posts_text bigint,
  posts_photo bigint,
  posts_course bigint,
  posts_round bigint,
  posts_swing bigint,
  comments_total bigint,
  votes_total bigint,
  saved_total bigint,
  hidden_total bigint,
  posts_last_24h bigint,
  posts_prev_24h bigint,
  posts_last_7d bigint,
  posts_prev_7d bigint
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
    (select count(*) from public.community_posts),
    (select count(*) from public.community_posts where type = 'text'),
    (select count(*) from public.community_posts where type = 'photo'),
    (select count(*) from public.community_posts where type = 'course'),
    (select count(*) from public.community_posts where type = 'round'),
    (select count(*) from public.community_posts where type = 'swing'),
    (select count(*) from public.community_comments),
    (select count(*) from public.community_post_votes) + (select count(*) from public.community_comment_votes),
    (select count(*) from public.saved_posts),
    (select count(*) from public.hidden_posts),
    (select count(*) from public.community_posts where created_at >= now() - interval '24 hours'),
    (select count(*) from public.community_posts where created_at >= now() - interval '48 hours' and created_at < now() - interval '24 hours'),
    (select count(*) from public.community_posts where created_at >= now() - interval '7 days'),
    (select count(*) from public.community_posts where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days');
end;
$$;
revoke execute on function public.admin_community_stats() from public, anon;
grant execute on function public.admin_community_stats() to authenticated;


-- One row per real, onboarded user's current Reputation tier -- reuses
-- get_reputation_state() itself (the single source of truth for tier
-- computation) per user via a lateral join, rather than re-deriving the
-- tier thresholds/anti-farming logic a second time in a way that could
-- drift from the real one.
create function public.admin_reputation_distribution()
returns table (
  tier_key text,
  golfer_count bigint
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
  select s.tier_key, count(*) as golfer_count
  from public.profiles p
  cross join lateral public.get_reputation_state(p.id) s
  where p.has_onboarded
  group by s.tier_key;
end;
$$;
revoke execute on function public.admin_reputation_distribution() from public, anon;
grant execute on function public.admin_reputation_distribution() to authenticated;


create function public.admin_messaging_stats()
returns table (
  conversations_total bigint,
  messages_total bigint,
  messages_last_24h bigint,
  messages_prev_24h bigint,
  messages_last_7d bigint,
  messages_prev_7d bigint,
  notifications_total bigint,
  notifications_unread bigint
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
    (select count(*) from public.conversations),
    (select count(*) from public.messages),
    (select count(*) from public.messages where created_at >= now() - interval '24 hours'),
    (select count(*) from public.messages where created_at >= now() - interval '48 hours' and created_at < now() - interval '24 hours'),
    (select count(*) from public.messages where created_at >= now() - interval '7 days'),
    (select count(*) from public.messages where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
    (select count(*) from public.notifications),
    (select count(*) from public.notifications where not read);
end;
$$;
revoke execute on function public.admin_messaging_stats() from public, anon;
grant execute on function public.admin_messaging_stats() to authenticated;


create function public.admin_push_stats()
returns table (
  tokens_registered bigint,
  users_with_token bigint,
  push_enabled_count bigint,
  push_disabled_count bigint
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
    (select count(*) from public.device_push_tokens),
    (select count(distinct user_id) from public.device_push_tokens),
    (select count(*) from public.profiles where push_enabled),
    (select count(*) from public.profiles where not push_enabled);
end;
$$;
revoke execute on function public.admin_push_stats() from public, anon;
grant execute on function public.admin_push_stats() to authenticated;


-- Extends admin_caddie_stats() with real failure tracking -- now possible
-- since analyze-swing's fail() (see Phase 22) marks status='failed'
-- instead of deleting the row, so failed analyses are no longer
-- unknowable after the fact.
drop function if exists public.admin_caddie_stats();
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
  score_high_count bigint,
  failed_total bigint,
  failed_last_7d bigint
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
    count(*) filter (where a.status = 'complete' and a.score >= 70) as score_high_count,
    count(*) filter (where a.status = 'failed') as failed_total,
    count(*) filter (where a.status = 'failed' and a.created_at >= now() - interval '7 days') as failed_last_7d
  from public.caddie_analyses a;
end;
$$;
revoke execute on function public.admin_caddie_stats() from public, anon;
grant execute on function public.admin_caddie_stats() to authenticated;

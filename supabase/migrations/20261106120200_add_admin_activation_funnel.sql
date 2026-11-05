-- Admin activation funnel (2026-11-05). NOT APPLIED. Independent of the
-- directory migrations (can be applied alone, any order). Read-only.
--
-- admin_activation_funnel(p_since): of the real accounts that signed up on
-- or after p_since (default: 90 days ago), how many reached each stage.
-- Computed from source tables, not from analytics_daily_counts: those are
-- anonymous daily totals (no user id by design), so they can't exclude
-- anyone, can't be joined into a per-user funnel, and any signed-in client
-- can inflate them.
--
-- Cohort excludes: the founder account (holds 'admin'), every active
-- 'admin', and 'test' / 'app_reviewer' / 'bot' / 'seeded' accounts
-- (user_roles). 'pre_launch' accounts are real golfers and are counted.
-- Demo ("Try Demo Account") sessions never create server rows, so they
-- can't appear. An account marked after the fact is excluded retroactively.
--
-- Stages (each also requires the previous ones' cohort, not the previous
-- stage itself, so a golfer who joined a round without finishing a profile
-- step still counts where they really got):
--   signed_up        profiles row created in the window
--   onboarded        has_onboarded now (there is no onboarded_at column, so
--                    WHEN they onboarded isn't measurable)
--   followed         follows someone (the only server trace of discovery;
--                    browsing Golfers/rounds leaves none)
--   contacted        sent a DM in a conversation whose other participant is
--                    not the founder (the founder's welcome DM doesn't count,
--                    a reply to it doesn't either), OR joined a round someone
--                    else hosts (round_participants keeps the row after
--                    leaving, so "ever joined")
--   hosted           hosted any round that wasn't cancelled
--   completed_round  host or still-joined participant of a round the host
--                    marked completed. Host-marked only: no proof of play,
--                    and a round nobody marks never counts.
-- Not measurable server-side today: Discover/Golfers views, profile views,
-- search use, time-to-onboard, whether a completed round really happened.
--
-- ROLLBACK: drop function if exists public.admin_activation_funnel(date);

create function public.admin_activation_funnel(p_since date default null)
returns table (stage text, users bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_founder constant uuid := '11be6983-7cd6-434d-bb52-6bfaf1d6e309';
  v_since date := coalesce(p_since, ((now() at time zone 'utc')::date - 90));
begin
  if not private.has_role((select auth.uid()), 'admin') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return query
  with cohort as (
    select p.id, p.has_onboarded
    from public.profiles p
    where p.created_at >= v_since
      and p.id <> v_founder
      and not exists (
        select 1 from public.user_roles r
        where r.user_id = p.id and r.active
          and r.role in ('admin', 'test', 'app_reviewer', 'bot', 'seeded')
      )
  ), flags as (
    select
      c.id,
      c.has_onboarded,
      exists (select 1 from public.follows f where f.follower_id = c.id) as followed,
      (
        exists (
          select 1
          from public.messages m
          join public.conversation_participants other
            on other.conversation_id = m.conversation_id and other.user_id <> c.id
          where m.sender_id = c.id and other.user_id <> v_founder
        )
        or exists (
          select 1
          from public.round_participants rp
          join public.golf_calls g on g.id = rp.round_id
          where rp.user_id = c.id and g.host_user_id <> c.id
        )
      ) as contacted,
      exists (select 1 from public.golf_calls g where g.host_user_id = c.id and g.status <> 'cancelled') as hosted,
      (
        exists (select 1 from public.golf_calls g where g.host_user_id = c.id and g.status = 'completed')
        or exists (
          select 1
          from public.round_participants rp
          join public.golf_calls g on g.id = rp.round_id
          where rp.user_id = c.id and rp.participant_status = 'joined' and g.status = 'completed'
        )
      ) as completed
    from cohort c
  )
  select s.stage, s.users
  from (
    select 1 as ord, 'signed_up'::text as stage, count(*)::bigint as users from flags
    union all select 2, 'onboarded', count(*) filter (where has_onboarded) from flags
    union all select 3, 'followed', count(*) filter (where followed) from flags
    union all select 4, 'contacted', count(*) filter (where contacted) from flags
    union all select 5, 'hosted', count(*) filter (where hosted) from flags
    union all select 6, 'completed_round', count(*) filter (where completed) from flags
  ) s
  order by s.ord;
end;
$$;

comment on function public.admin_activation_funnel(date) is
  'Admin only. Per-stage counts for real accounts that signed up since p_since (default 90 days), excluding the founder, admins and test/app_reviewer/bot/seeded roles. Completed = host-marked.';

revoke execute on function public.admin_activation_funnel(date) from public, anon;
grant execute on function public.admin_activation_funnel(date) to authenticated;

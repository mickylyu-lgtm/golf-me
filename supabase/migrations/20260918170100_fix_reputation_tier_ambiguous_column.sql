-- Companion fix applied live in the same session as
-- 20260918170000_add_reputation_tier_system.sql: the first apply had an
-- ambiguous-column bug (bare "tier_key" collided with the RETURNS TABLE
-- out-parameter of the same name). Recorded here as its own migration so
-- local files match what was actually run against the remote project;
-- get_reputation_state()'s body already reflects the corrected,
-- fully-qualified version in the file above, so this is a no-op replace
-- on a fresh database.
create or replace function public.get_reputation_state(p_user_id uuid)
returns table (
  tier_key text,
  points int,
  qualifying_rounds int,
  hosted_rounds int,
  tenure_days int,
  next_tier_key text,
  points_to_next_tier int
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_points int := 0;
  v_qualifying int := 0;
  v_hosted int := 0;
  v_tenure_days int := 0;
  v_tier_key text;
  v_tier_order int;
  v_next_tier_key text;
  v_next_min_points int;
begin
  select coalesce(extract(day from now() - p.member_since)::int, 0)
  into v_tenure_days
  from public.profiles p
  where p.id = p_user_id;

  with joined_counts as (
    select round_id, count(*) as joined_n
    from public.round_participants
    where participant_status = 'joined'
    group by round_id
  ),
  qualifying_rounds as (
    select gc.id as round_id, gc.date_iso, gc.host_user_id, jc.joined_n
    from public.golf_calls gc
    join joined_counts jc on jc.round_id = gc.id
    join public.round_participants rp
      on rp.round_id = gc.id and rp.user_id = p_user_id and rp.participant_status = 'joined'
    where gc.status = 'completed' and jc.joined_n >= 2
  ),
  other_participant as (
    select
      qr.round_id, qr.date_iso, qr.host_user_id, qr.joined_n,
      (
        select rp2.user_id from public.round_participants rp2
        where rp2.round_id = qr.round_id and rp2.participant_status = 'joined' and rp2.user_id <> p_user_id
        limit 1
      ) as other_user_id
    from qualifying_rounds qr
  ),
  ranked as (
    select
      op.*,
      case when op.joined_n = 2
        then row_number() over (partition by op.other_user_id order by op.date_iso asc)
        else null
      end as partner_rank
    from other_participant op
  ),
  credited as (
    select * from ranked
    where joined_n > 2 or (joined_n = 2 and partner_rank <= 3)
  )
  select
    count(*)::int,
    count(*) filter (where host_user_id = p_user_id)::int,
    coalesce(sum(10 + case when host_user_id = p_user_id then 5 else 0 end), 0)::int
  into v_qualifying, v_hosted, v_points
  from credited;

  with tiers(tier_key, tier_order, min_points, min_tenure_days) as (
    values
      ('newcomer_1', 1, 0, 0),
      ('newcomer_2', 2, 5, 0),
      ('newcomer_3', 3, 15, 0),
      ('established_1', 4, 30, 14),
      ('established_2', 5, 50, 14),
      ('established_3', 6, 75, 14),
      ('trusted_1', 7, 100, 60),
      ('trusted_2', 8, 150, 60),
      ('trusted_3', 9, 200, 60),
      ('premier_1', 10, 260, 180),
      ('premier_2', 11, 340, 180),
      ('premier_3', 12, 420, 180),
      ('elite', 13, 500, 365)
  ),
  eligible as (
    select tiers.tier_key, tiers.tier_order, tiers.min_points
    from tiers
    where v_points >= tiers.min_points and v_tenure_days >= tiers.min_tenure_days
    order by tiers.tier_order desc
    limit 1
  )
  select eligible.tier_key, eligible.tier_order into v_tier_key, v_tier_order from eligible;

  select t.tier_key, t.min_points into v_next_tier_key, v_next_min_points
  from (
    values
      ('newcomer_1', 1, 0), ('newcomer_2', 2, 5), ('newcomer_3', 3, 15),
      ('established_1', 4, 30), ('established_2', 5, 50), ('established_3', 6, 75),
      ('trusted_1', 7, 100), ('trusted_2', 8, 150), ('trusted_3', 9, 200),
      ('premier_1', 10, 260), ('premier_2', 11, 340), ('premier_3', 12, 420),
      ('elite', 13, 500)
  ) as t(tier_key, tier_order, min_points)
  where t.tier_order = v_tier_order + 1;

  return query select
    v_tier_key,
    v_points,
    v_qualifying,
    v_hosted,
    v_tenure_days,
    v_next_tier_key,
    case when v_next_tier_key is null then null else greatest(v_next_min_points - v_points, 0) end;
end;
$$;

revoke execute on function public.get_reputation_state(uuid) from public, anon;
grant execute on function public.get_reputation_state(uuid) to authenticated;

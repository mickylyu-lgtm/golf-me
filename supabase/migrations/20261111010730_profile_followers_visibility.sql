-- Profile followers: REVIEW/STAGING ONLY. NOT APPLIED.
-- Requires public directory + moderation migrations. No existing table,
-- policy, privacy setting or public-profile function is changed.
-- This endpoint avoids NEW list/count exposure; the older broad follows
-- SELECT and supplied-id public-profile endpoint are outside this change.
-- A later, separately approved hardening should review those surfaces.
--
-- Discoverable=false is not made public by a third-party follower graph.
-- Direct here means an existing follow in EITHER direction with the caller.
-- Own profile is visible to self. Blocks, suspension, excluded roles and
-- incomplete profiles always win over these visibility exceptions.
-- DM/round-only contacts do not gain a new follower-list exception here.
--
-- Rollback (after shipping a client that handles unavailable):
-- drop function public.golfer_profile_followers(uuid, integer, integer);
-- drop function private.can_list_follower_profile(uuid, uuid);

do $$
begin
  if to_regprocedure('private.has_block_between(uuid,uuid)') is null
     or to_regprocedure('private.is_directory_excluded(uuid)') is null
     or to_regprocedure('private.is_suspended(uuid)') is null
     or to_regprocedure('public.golfer_public_profiles(uuid[])') is null then
    raise exception 'Profile followers requires the directory and moderation migrations. Nothing changed.';
  end if;
end;
$$;

-- Invoker helper: only the owning endpoint may call it. It never returns
-- suspension/role/block details and cannot be used as an existence probe.
create function private.can_list_follower_profile(p_viewer uuid, p_profile uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_viewer is not null
    and p_viewer = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = p_profile
        and p.has_onboarded
        and nullif(btrim(p.name), '') is not null
        and not private.is_directory_excluded(p.id)
        and not private.is_suspended(p.id)
        and not private.has_block_between(p_viewer, p.id)
        and (
          p.id = p_viewer
          or p.discoverable
          or exists (
            select 1 from public.follows direct
            where (direct.follower_id = p_viewer and direct.following_id = p.id)
               or (direct.follower_id = p.id and direct.following_id = p_viewer)
          )
        )
    );
$$;
revoke all on function private.can_list_follower_profile(uuid, uuid) from public, anon, authenticated, service_role;

-- SECURITY DEFINER is required to evaluate the private moderation/role
-- checks and read permitted public profiles after profiles becomes own-row
-- only. Explicit auth + target eligibility + every follower eligibility
-- check are mandatory below. Empty search_path; no dynamic SQL.
create function public.golfer_profile_followers(
  p_profile_id uuid,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := (select auth.uid());
  v_limit integer := coalesce(p_limit, 100);
  v_offset integer := coalesce(p_offset, 0);
  v_result jsonb;
begin
  if v_limit < 0 or v_limit > 100 or v_offset < 0 or v_offset > 100000 then
    raise exception 'Invalid follower page.' using errcode = '22023';
  end if;
  -- Same error for absent, hidden, blocked, suspended, excluded and invalid
  -- targets. No reason, status or raw relationship count leaves the server.
  if v_viewer is null or not private.can_list_follower_profile(v_viewer, p_profile_id) then
    raise exception 'Followers unavailable.' using errcode = '42501';
  end if;

  with eligible as materialized (
    select f.follower_id, f.created_at,
      exists (
        select 1 from public.follows mine
        where mine.follower_id = v_viewer and mine.following_id = f.follower_id
      ) as is_mutual
    from public.follows f
    where f.following_id = p_profile_id
      and private.can_list_follower_profile(v_viewer, f.follower_id)
      -- Blocking does not necessarily delete old follows. Do not surface
      -- those stale edges, including when the caller is a third party.
      and not private.has_block_between(p_profile_id, f.follower_id)
  ), page as (
    select * from eligible
    order by created_at desc, follower_id
    limit v_limit offset v_offset
  ), rows as (
    -- Reuse the existing narrow public field projection, but ONLY for ids
    -- already authorized by eligible, in the same statement snapshot.
    -- Never select profiles.* or return role/suspension/location coordinates.
    select to_jsonb(profile) || jsonb_build_object('is_mutual', page.is_mutual) as payload,
           page.created_at, page.follower_id
    from public.golfer_public_profiles(array(select follower_id from page)) profile
    join page on page.follower_id = profile.id
  )
  select jsonb_build_object(
    'version', 1,
    'total', (select count(*) from eligible),
    'mutual_total', (select count(*) from eligible where is_mutual),
    'followers', coalesce((select jsonb_agg(payload order by created_at desc, follower_id) from rows), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
comment on function public.golfer_profile_followers(uuid, integer, integer) is
  'Viewer-visible follower rows and counts from one filtered set. Authenticated only. No blocks, suspended/excluded/incomplete profiles. Hidden profiles require a direct follow relationship with the caller. p_limit=0 is count-only. No raw totals or hidden reasons.';
-- Supabase public-schema default ACLs also grant service_role. Clear all
-- application-role defaults, then expose this endpoint only to authenticated.
revoke all on function public.golfer_profile_followers(uuid, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.golfer_profile_followers(uuid, integer, integer) to authenticated;

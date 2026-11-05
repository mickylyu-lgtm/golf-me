-- Public golfer directory, phase 1 of 2 (2026-11-05). NOT APPLIED.
-- Supersedes the unapplied 20261104130000_add_profile_discoverable (branch
-- feat/discoverable): its column, filters and alert trigger are folded in
-- here, its discoverable_golfer_profiles() is replaced by golfer_directory().
-- Never apply both.
--
-- Why: the client used to download the whole profiles table (every column
-- of every account, coordinates included) and filter self/blocks in React.
-- profiles_select_authenticated (using (true)) lets any signed-in account do
-- the same through the REST API.
--
-- Phase 1 (this file, purely additive, safe before or after the client):
--   1. profiles.discoverable (Settings -> Privacy -> Discoverable), default
--      true for everyone (constant default: no rewrite, no UPDATE, nobody's
--      visibility changes).
--   2. public.golfer_directory(p_limit, p_offset): the Golfers list.
--      SECURITY DEFINER, explicit narrow column list, NO coordinates, a
--      coarse distance bucket instead. Enforced here, not in React:
--        - caller signed in (anon has no execute; null uid returns nothing)
--        - never the caller's own row
--        - has_onboarded and a non-blank name (a completed profile)
--        - discoverable
--        - no block either way (private.has_block_between)
--        - not a test / app-reviewer / bot / seeded account
--          (private.is_directory_excluded: active user_roles rows only;
--          'pre_launch', 'admin', 'coach_reviewer' never hide anyone, so the
--          founder, who holds 'admin', stays listed)
--      Nearest first (unknown distance last), then newest; max 100 per page.
--   3. public.golfer_public_profiles(p_ids uuid[]): look up people the
--      caller already has a reason to see (DM partner, round roster,
--      follower, notification actor, post/comment author, coach reviewer).
--      Same narrow columns plus gender (round-roster gender preference
--      matching needs it) and the distance bucket; max 200 ids; no
--      discoverability/onboarding filter (relationships outlive both, by
--      Micky's discoverable decision); blocked either way -> no row, except
--      the caller's own. It cannot list anyone: the caller must supply ids.
--   4. search_golfer_profiles / suggested_golfer_profiles: same signatures
--      and grants, plus discoverable, onboarded (search) and the
--      test/reviewer exclusion.
--   5. new_round_nearby alerts clear the actor when the host is hidden
--      (from 20261104130000, now SECURITY DEFINER so it fails closed).
--
-- Phase 2 (20261106120100, separate, apply ONLY after the phase-1 client is
-- live and verified): the profiles select policy becomes own-row only, so
-- the table can no longer bypass the rules above.
--
-- Distance buckets: both coarse points (profiles are already rounded to 2
-- decimals by profiles_coarsen_location) are snapped to the centre of a
-- 0.05 degree cell (~5.5 x 4.2 km at NYC) before the great-circle distance,
-- so even an account that keeps moving its own location to probe bucket
-- edges learns no more than which ~5 km cell someone is in (about what
-- area_label already says). Buckets: within_5, 5_to_10, 10_to_15, 15_to_25,
-- 25_to_50, over_50 (miles; edges match lib/compatibility distanceScore).
-- null when either side has no coordinates.
--
-- VERIFY: scripts/staging/public-directory-authz.sql (STAGING ONLY; it
-- refuses to run without the staging marker and rolls back).
--
-- ROLLBACK (exact; restores the two RPC bodies before dropping the column
-- they read; loses every golfer's saved Discoverable choice):
--   begin;
--   drop trigger if exists notifications_clear_hidden_round_alert_actor on public.notifications;
--   drop function if exists private.clear_hidden_round_alert_actor();
--   drop function if exists public.golfer_directory(integer, integer);
--   drop function if exists public.golfer_public_profiles(uuid[]);
--   -- then re-run the search_golfer_profiles and suggested_golfer_profiles
--   -- bodies from 20261006120000_add_founding_golfer_cohort.sql as
--   -- `create or replace function` (same signatures, so grants are kept)
--   drop function if exists private.golfer_distance_bucket(double precision, double precision, double precision, double precision);
--   drop function if exists private.is_directory_excluded(uuid);
--   alter table public.profiles drop column if exists discoverable;
--   commit;
-- The web client keeps working after a rollback (it feature-detects both
-- RPCs and falls back to the old table reads, and hides the switch).

-- ---------------------------------------------------------------------------
-- 1. The setting.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column discoverable boolean not null default true;

comment on column public.profiles.discoverable is
  'Settings -> Privacy -> Discoverable. false = left out of golfer_directory(), search_golfer_profiles(), suggested_golfer_profiles(), and no actor on new_round_nearby alerts. Not a private profile: golfer_public_profiles() still resolves the id for existing relationships. Written by the owner only (profiles_update_own).';

-- ---------------------------------------------------------------------------
-- 2. Helpers (private schema: never exposed as /rest/v1/rpc endpoints).
-- ---------------------------------------------------------------------------
-- Accounts marked test / app_reviewer / bot / seeded (user_roles, the same
-- roles the Founding Golfer exclusions use). 'pre_launch' means "real
-- golfer, no Founding number" and must never hide anyone (20261006120000).
create function private.is_directory_excluded(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = p_user_id
      and r.active
      and r.role in ('test', 'app_reviewer', 'bot', 'seeded')
  );
$$;
revoke execute on function private.is_directory_excluded(uuid) from public, anon, authenticated;

create function private.golfer_distance_bucket(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision
)
returns text
language sql
immutable
set search_path = ''
as $$
  with snapped as (
    select
      radians(floor(p_lat1 / 0.05) * 0.05 + 0.025) as a_lat,
      radians(floor(p_lng1 / 0.05) * 0.05 + 0.025) as a_lng,
      radians(floor(p_lat2 / 0.05) * 0.05 + 0.025) as b_lat,
      radians(floor(p_lng2 / 0.05) * 0.05 + 0.025) as b_lng
  ), d as (
    select 2 * 3958.8 * asin(least(1, sqrt(
      power(sin((b_lat - a_lat) / 2), 2) + cos(a_lat) * cos(b_lat) * power(sin((b_lng - a_lng) / 2), 2)
    ))) as miles
    from snapped
  )
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    when miles <= 5 then 'within_5'
    when miles <= 10 then '5_to_10'
    when miles <= 15 then '10_to_15'
    when miles <= 25 then '15_to_25'
    when miles <= 50 then '25_to_50'
    else 'over_50'
  end
  from d;
$$;
revoke execute on function private.golfer_distance_bucket(double precision, double precision, double precision, double precision) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The Golfers directory.
-- ---------------------------------------------------------------------------
create function public.golfer_directory(p_limit integer default 50, p_offset integer default 0)
returns table (
  id uuid,
  name text,
  username text,
  avatar_color text,
  avatar_initials text,
  photo_url text,
  age_range text,
  bio text,
  area_label text,
  handicap integer,
  skill_level text,
  favorite_courses text[],
  walk_or_cart text,
  vibes text[],
  budget_min integer,
  budget_max integer,
  no_budget_preference boolean,
  availability text[],
  verified_golfer boolean,
  completed_rounds integer,
  show_up_rate_pct integer,
  would_play_again_pct integer,
  on_time_pct integer,
  respectful_pct integer,
  good_pace_pct integer,
  circle_size integer,
  member_since timestamptz,
  founding_member_number integer,
  distance_bucket text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid, m.playing_area_lat as lat, m.playing_area_lng as lng
    from (select 1) one
    left join public.profiles m on m.id = (select auth.uid())
  ), ranked as (
    select
      p.*,
      case
        when me.lat is null or me.lng is null or p.playing_area_lat is null or p.playing_area_lng is null then null
        else point(floor(p.playing_area_lng / 0.05), floor(p.playing_area_lat / 0.05)) <-> point(floor(me.lng / 0.05), floor(me.lat / 0.05))
      end as cell_distance,
      private.golfer_distance_bucket(me.lat, me.lng, p.playing_area_lat, p.playing_area_lng) as bucket
    from public.profiles p, me
    where me.uid is not null
      and p.id <> me.uid
      and p.has_onboarded
      and nullif(trim(p.name), '') is not null
      and p.discoverable
      and not private.has_block_between(me.uid, p.id)
      and not private.is_directory_excluded(p.id)
  )
  select r.id, r.name, r.username, r.avatar_color, r.avatar_initials, r.photo_url, r.age_range, r.bio, r.area_label,
         r.handicap, r.skill_level, r.favorite_courses, r.walk_or_cart, r.vibes, r.budget_min, r.budget_max,
         r.no_budget_preference, r.availability, r.verified_golfer, r.completed_rounds, r.show_up_rate_pct,
         r.would_play_again_pct, r.on_time_pct, r.respectful_pct, r.good_pace_pct, r.circle_size, r.member_since,
         case when r.founding_golfer then r.founding_member_number end,
         r.bucket
  from ranked r
  order by r.cell_distance asc nulls last, r.created_at desc, r.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

comment on function public.golfer_directory(integer, integer) is
  'Golfers tab / invite list. Onboarded, named, discoverable, unblocked either way, not test/app_reviewer/bot/seeded, never the caller. Narrow columns, no coordinates, coarse distance bucket. Max 100 per page.';

revoke execute on function public.golfer_directory(integer, integer) from public, anon;
grant execute on function public.golfer_directory(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Known people by id.
-- ---------------------------------------------------------------------------
create function public.golfer_public_profiles(p_ids uuid[])
returns table (
  id uuid,
  name text,
  username text,
  avatar_color text,
  avatar_initials text,
  photo_url text,
  age_range text,
  gender text,
  bio text,
  area_label text,
  handicap integer,
  skill_level text,
  favorite_courses text[],
  walk_or_cart text,
  vibes text[],
  budget_min integer,
  budget_max integer,
  no_budget_preference boolean,
  availability text[],
  verified_golfer boolean,
  completed_rounds integer,
  show_up_rate_pct integer,
  would_play_again_pct integer,
  on_time_pct integer,
  respectful_pct integer,
  good_pace_pct integer,
  circle_size integer,
  member_since timestamptz,
  founding_member_number integer,
  distance_bucket text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid, m.playing_area_lat as lat, m.playing_area_lng as lng
    from (select 1) one
    left join public.profiles m on m.id = (select auth.uid())
  ), wanted as (
    select distinct w.id from unnest((coalesce(p_ids, '{}'::uuid[]))[1:200]) as w(id)
  )
  select p.id, p.name, p.username, p.avatar_color, p.avatar_initials, p.photo_url, p.age_range, p.gender, p.bio,
         p.area_label, p.handicap, p.skill_level, p.favorite_courses, p.walk_or_cart, p.vibes, p.budget_min,
         p.budget_max, p.no_budget_preference, p.availability, p.verified_golfer, p.completed_rounds,
         p.show_up_rate_pct, p.would_play_again_pct, p.on_time_pct, p.respectful_pct, p.good_pace_pct,
         p.circle_size, p.member_since,
         case when p.founding_golfer then p.founding_member_number end,
         case when p.id = me.uid then null
              else private.golfer_distance_bucket(me.lat, me.lng, p.playing_area_lat, p.playing_area_lng) end
  from public.profiles p
  join wanted w on w.id = p.id
  cross join me
  where me.uid is not null
    and (p.id = me.uid or not private.has_block_between(me.uid, p.id));
$$;

comment on function public.golfer_public_profiles(uuid[]) is
  'Public profile fields for up to 200 ids the caller already knows (rounds, chats, follows, notifications, posts). Blocked either way -> no row (own row always). Never lists; no coordinates; coarse distance bucket.';

revoke execute on function public.golfer_public_profiles(uuid[]) from public, anon;
grant execute on function public.golfer_public_profiles(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Find Golfers search: the current body (20261006120000, which added
--    founding_member_number; the unapplied 20261104130000 restated the
--    older 20260822110000 shape and would have failed with "cannot change
--    return type") + discoverable, onboarded, test/reviewer exclusion.
-- ---------------------------------------------------------------------------
create or replace function public.search_golfer_profiles(p_query text, p_limit integer default 10)
returns table (id uuid, name text, username text, avatar_color text, avatar_initials text, photo_url text, handicap integer, area_label text, completed_rounds integer, would_play_again_pct integer, founding_member_number integer)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.id, p.name, p.username, p.avatar_color, p.avatar_initials, p.photo_url, p.handicap, p.area_label, p.completed_rounds, p.would_play_again_pct, p.founding_member_number
  from public.profiles p
  where p.id <> (select auth.uid())
    and p.has_onboarded
    and p.discoverable
    and not private.is_directory_excluded(p.id)
    and trim(coalesce(p_query, '')) <> ''
    and (p.username ilike '%' || trim(p_query) || '%' or p.name ilike '%' || trim(p_query) || '%')
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = (select auth.uid()))
    )
  order by
    case
      when lower(p.username) = lower(trim(p_query)) then 0
      when p.username ilike trim(p_query) || '%' then 1
      when lower(p.name) = lower(trim(p_query)) then 2
      when p.name ilike trim(p_query) || '%' then 3
      else 4
    end,
    p.name
  limit least(coalesce(p_limit, 10), 25);
$function$;

revoke execute on function public.search_golfer_profiles(text, integer) from public, anon;
grant execute on function public.search_golfer_profiles(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Suggested golfers: body from 20261006120000 + discoverable and the
--    test/reviewer exclusion. Same return type, so grants are kept.
-- ---------------------------------------------------------------------------
create or replace function public.suggested_golfer_profiles(p_limit integer default 6)
returns table (id uuid, name text, username text, avatar_color text, avatar_initials text, photo_url text, handicap integer, area_label text, completed_rounds integer, would_play_again_pct integer, founding_member_number integer)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select handicap, vibes, playing_area_lat, playing_area_lng
    from public.profiles
    where id = (select auth.uid())
  )
  select p.id, p.name, p.username, p.avatar_color, p.avatar_initials, p.photo_url, p.handicap, p.area_label, p.completed_rounds, p.would_play_again_pct, p.founding_member_number
  from public.profiles p, me
  where p.id <> (select auth.uid())
    and p.has_onboarded
    and p.discoverable
    and not private.is_directory_excluded(p.id)
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = (select auth.uid()))
    )
    and not exists (
      select 1 from public.follows f
      where f.follower_id = (select auth.uid()) and f.following_id = p.id
    )
  order by
    (
      greatest(0, 20 - coalesce(abs(p.handicap - me.handicap), 20))
      + cardinality(array(select unnest(p.vibes) intersect select unnest(me.vibes))) * 5
      + (
          case
            when me.playing_area_lat is not null and me.playing_area_lng is not null
             and p.playing_area_lat is not null and p.playing_area_lng is not null
            then greatest(0, 20 - (point(p.playing_area_lng, p.playing_area_lat) <-> point(me.playing_area_lng, me.playing_area_lat)) * 20)
            else 0
          end
        )
    ) desc,
    p.created_at desc
  limit least(coalesce(p_limit, 6), 12);
$$;

revoke execute on function public.suggested_golfer_profiles(integer) from public, anon;
grant execute on function public.suggested_golfer_profiles(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. New-round alerts don't name a hidden host (BEFORE INSERT, only
--    new_round_nearby rows with an actor; claim_notification_fanout and its
--    ledger are untouched). DEFINER so the check still sees the host's row
--    once phase 2 makes the table own-row only.
-- ---------------------------------------------------------------------------
create function private.clear_hidden_round_alert_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.actor_id and not p.discoverable) then
    new.actor_id := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.clear_hidden_round_alert_actor() from public, anon, authenticated;

create trigger notifications_clear_hidden_round_alert_actor
  before insert on public.notifications
  for each row
  when (new.type = 'new_round_nearby' and new.actor_id is not null)
  execute function private.clear_hidden_round_alert_actor();

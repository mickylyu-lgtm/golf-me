-- Golfer directory from a search area (2026-11-05). NOT APPLIED.
-- Requires 20261106120000 (live). Independent of 20261106130000.
--
-- Why: golfer_directory() computes distance buckets from the caller's SAVED
-- playing area. Auto-Match's "Playing Somewhere Else?" area is a temporary,
-- URL-only search area, so with a NYC home and an LA search the NYC golfers
-- read "within 5 mi" and the LA golfers "50+ mi": exactly backwards.
--
-- What changes:
--   1. private.golfer_directory_rows(uid, origin_lat, origin_lng, limit,
--      offset): the directory rules + bucket maths, moved here verbatim from
--      golfer_directory() so both entry points below share ONE copy of the
--      rules. Not callable by any app role (it takes a uid).
--   2. public.golfer_directory(p_limit, p_offset): same signature, same
--      grants, same result; now a one-line call to the core with the
--      caller's saved area. (create or replace, so nothing that calls it
--      changes, and 20261106120100's guard still finds it.)
--   3. public.golfer_directory_from(p_origin_lat, p_origin_lng, p_limit,
--      p_offset): the same rows and columns, buckets measured from the
--      given origin. The origin is never trusted precisely: it is snapped
--      to the centre of its 0.05-degree cell (~5 km) before use, exactly
--      like the target side, so the answer depends only on (origin cell,
--      golfer cell) and probing with many origins can learn no more than
--      which ~5 km cell a golfer is in (the same limit as moving one's own
--      saved area, and about what area_label already says). Both values
--      are required and range-checked (22023 otherwise). Signed in only.
--      No coordinates in the response, and the origin is not stored.
-- Directory rules (onboarded, named, Discoverable, blocks either way,
-- test/reviewer exclusion, never the caller), caps and ordering unchanged.
--
-- ROLLBACK (exact; see the paste file, which restores golfer_directory's
-- body verbatim from 20261106120000):
--   begin;
--   drop function if exists public.golfer_directory_from(double precision, double precision, integer, integer);
--   create or replace function public.golfer_directory(...) -- body from 20261106120000
--   drop function if exists private.golfer_directory_rows(uuid, double precision, double precision, integer, integer);
--   commit;

create function private.golfer_directory_rows(
  p_uid uuid,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_limit integer,
  p_offset integer
)
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
    select p_uid as uid, p_origin_lat as lat, p_origin_lng as lng
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

revoke execute on function private.golfer_directory_rows(uuid, double precision, double precision, integer, integer) from public, anon, authenticated;

create or replace function public.golfer_directory(p_limit integer default 50, p_offset integer default 0)
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
  select d.*
  from (select 1) one
  left join public.profiles m on m.id = (select auth.uid())
  cross join lateral private.golfer_directory_rows((select auth.uid()), m.playing_area_lat, m.playing_area_lng, p_limit, p_offset) d;
$$;

create function public.golfer_directory_from(
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_limit integer default 50,
  p_offset integer default 0
)
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
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_origin_lat is null or p_origin_lng is null
     or p_origin_lat = 'NaN'::double precision or p_origin_lng = 'NaN'::double precision
     or p_origin_lat < -90 or p_origin_lat > 90 or p_origin_lng < -180 or p_origin_lng > 180 then
    raise exception 'A search area needs a valid latitude and longitude.' using errcode = '22023';
  end if;
  return query
  select d.*
  from private.golfer_directory_rows(
    (select auth.uid()),
    -- snapped to its ~5 km cell centre: never used more precisely than that
    floor(p_origin_lat / 0.05) * 0.05 + 0.025,
    floor(p_origin_lng / 0.05) * 0.05 + 0.025,
    p_limit,
    p_offset
  ) d;
end;
$$;

comment on function public.golfer_directory_from(double precision, double precision, integer, integer) is
  'golfer_directory() rows with distance buckets measured from a search area instead of the saved one. Origin snapped to its 0.05-degree cell; never stored; no coordinates returned. Signed in only.';

revoke execute on function public.golfer_directory_from(double precision, double precision, integer, integer) from public, anon;
grant execute on function public.golfer_directory_from(double precision, double precision, integer, integer) to authenticated;

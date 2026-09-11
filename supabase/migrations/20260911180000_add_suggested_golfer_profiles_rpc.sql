-- "Suggested for you" on the Find Golfers page needs a candidate list before
-- the golfer has typed anything, so it can't reuse search_golfer_profiles()
-- (that function requires a non-empty p_query by design). Mirrors that
-- function's privacy stance instead of falling back to a plain client-side
-- `profiles` select: same narrow field list (no exact
-- playing_area_lat/lng -- those stay server-side, used only to rank, never
-- returned), and the same mutual-block exclusion.
--
-- Ranking is a simple, explainable weighted score, not ML: closer handicap,
-- shared vibes, and closer (approximate, ordering-only -- not real mileage)
-- location each add points; a golfer with none of those signals still shows
-- up, ordered by most-recently-joined, which doubles as the "not enough
-- data to rank" fallback the product spec asked for.
create or replace function public.suggested_golfer_profiles(p_limit integer default 6)
returns table (
  id uuid,
  name text,
  username text,
  avatar_color text,
  avatar_initials text,
  photo_url text,
  handicap integer,
  area_label text,
  completed_rounds integer,
  would_play_again_pct integer
)
language sql
stable
security definer
set search_path = ''
as $function$
  with me as (
    select handicap, vibes, playing_area_lat, playing_area_lng
    from public.profiles
    where id = (select auth.uid())
  )
  select p.id, p.name, p.username, p.avatar_color, p.avatar_initials, p.photo_url, p.handicap, p.area_label, p.completed_rounds, p.would_play_again_pct
  from public.profiles p, me
  where p.id <> (select auth.uid())
    and p.has_onboarded
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = (select auth.uid()))
    )
    -- Already-followed golfers aren't a "discover someone new" suggestion.
    and not exists (
      select 1 from public.follows f
      where f.follower_id = (select auth.uid()) and f.following_id = p.id
    )
  order by
    (
      -- Closer handicap = more points; missing data on either side scores 0
      -- rather than excluding the candidate.
      greatest(0, 20 - coalesce(abs(p.handicap - me.handicap), 20))
      -- Each shared vibe adds points.
      + cardinality(array(select unnest(p.vibes) intersect select unnest(me.vibes))) * 5
      -- Coarse "closer is better" location signal for ordering only -- the
      -- underlying coordinates are never selected into the result.
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
$function$;

revoke execute on function public.suggested_golfer_profiles(integer) from public, anon;
grant execute on function public.suggested_golfer_profiles(integer) to authenticated;

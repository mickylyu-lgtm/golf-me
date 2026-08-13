-- The host occupies one of total_spots, same as the existing mock's
-- joinedGolferIds (host at index 0) — so the host must have a
-- round_participants row too, not just a golf_calls.host_user_id reference,
-- or join_golf_call()'s "joined count >= total_spots" check would undercount
-- by one and let a full round accept one extra player. round_participants
-- has no direct client insert policy at all (see the previous migration), so
-- creating the round and seating the host has to happen atomically here,
-- in one function, rather than as two separate client round-trips where the
-- second could fail and leave an inconsistent round behind.
create function public.host_golf_call(
  p_course_id uuid,
  p_course_name text,
  p_course_area_label text,
  p_course_lat double precision,
  p_course_lng double precision,
  p_date_iso timestamptz,
  p_tee_time_label text,
  p_holes int,
  p_game_format text,
  p_estimated_price_per_person numeric,
  p_total_spots int,
  p_skill_level text,
  p_vibe text,
  p_walk_or_cart text,
  p_notes text
)
returns public.golf_calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.golf_calls%rowtype;
begin
  insert into public.golf_calls (
    host_user_id, course_id, course_name, course_area_label, course_lat, course_lng,
    date_iso, tee_time_label, holes, game_format, estimated_price_per_person, total_spots,
    skill_level, vibe, walk_or_cart, notes
  ) values (
    (select auth.uid()), p_course_id, p_course_name, p_course_area_label, p_course_lat, p_course_lng,
    p_date_iso, p_tee_time_label, p_holes, p_game_format, p_estimated_price_per_person, p_total_spots,
    p_skill_level, p_vibe, p_walk_or_cart, p_notes
  )
  returning * into v_round;

  insert into public.round_participants (round_id, user_id, participant_status, joined_at)
  values (v_round.id, (select auth.uid()), 'joined', now());

  return v_round;
end;
$$;

revoke execute on function public.host_golf_call(
  uuid, text, text, double precision, double precision, timestamptz, text, int, text, numeric, int, text, text, text, text
) from public, anon;
grant execute on function public.host_golf_call(
  uuid, text, text, double precision, double precision, timestamptz, text, int, text, numeric, int, text, text, text, text
) to authenticated;

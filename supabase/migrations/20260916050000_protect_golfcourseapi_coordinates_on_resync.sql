-- course-enrich prefers GolfCourseAPI's own coordinates over Geoapify's
-- once a confident name-match is found (course-enrich/index.ts), on the
-- reasoning that they're course-specific rather than a general places-API
-- geocode. That preference wasn't durable: upsert_external_course() is
-- called by every ordinary Geoapify search/re-search (course-search),
-- always via `latitude = coalesce(p_latitude, latitude)` -- since Geoapify
-- always supplies a non-null p_latitude, a ROUTINE re-search for a course
-- that had already been GolfCourseAPI-enriched would silently overwrite
-- its coordinate back to Geoapify's own value again. Confirmed live:
-- enriched Liberty National Golf Club, then a plain course-search autocomplete
-- re-query for the same course a few seconds later re-synced its Geoapify
-- mapping (unrelated, expected) and, as a side effect, reset lat/lng too.
--
-- Fix: once a course has a course_external_ids row for provider
-- 'golfcourseapi' (meaning course-enrich has actually attached a match --
-- not merely "checked," which also happens on a no-match), lat/lng stop
-- being touched by upsert_external_course()'s own coalesce -- a plain
-- Geoapify re-sync still refreshes name/city/region/address/holes as
-- before, just never overwrites a coordinate GolfCourseAPI already
-- confirmed. No new column: reuses the existing course_external_ids
-- mapping table as the signal, exactly per "prefer the simpler approach if
-- it can be consumed without persistence" from the original design
-- discussion -- this is still that same minimal approach, just closing a
-- gap in it rather than adding the coordinate_source column that was
-- explicitly deferred.
create or replace function public.upsert_external_course(
  p_provider text,
  p_external_id text,
  p_name text,
  p_normalized_name text,
  p_city text,
  p_region text,
  p_country text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_holes integer default null
)
returns public.courses
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_speculative_course_id uuid;
  v_course_id uuid;
  v_course public.courses%rowtype;
  v_has_golfcourseapi_coords boolean;
begin
  insert into public.courses (name, normalized_name, city, region, country, address, latitude, longitude, holes)
  values (p_name, p_normalized_name, p_city, p_region, p_country, p_address, p_latitude, p_longitude, p_holes)
  returning id into v_speculative_course_id;

  insert into public.course_external_ids (course_id, provider, external_id)
  values (v_speculative_course_id, p_provider, p_external_id)
  on conflict (provider, external_id) do update set last_synced_at = now()
  returning course_id into v_course_id;

  if v_course_id <> v_speculative_course_id then
    -- A mapping already existed for this (provider, external_id) -- discard
    -- the speculative course row, refresh the pre-existing canonical one.
    delete from public.courses where id = v_speculative_course_id;

    select exists (
      select 1 from public.course_external_ids
      where course_id = v_course_id and provider = 'golfcourseapi'
    ) into v_has_golfcourseapi_coords;

    update public.courses set
      name = coalesce(p_name, name),
      normalized_name = coalesce(p_normalized_name, normalized_name),
      city = coalesce(p_city, city),
      region = coalesce(p_region, region),
      country = coalesce(p_country, country),
      address = coalesce(p_address, address),
      latitude = case when v_has_golfcourseapi_coords then latitude else coalesce(p_latitude, latitude) end,
      longitude = case when v_has_golfcourseapi_coords then longitude else coalesce(p_longitude, longitude) end,
      holes = coalesce(p_holes, holes),
      updated_at = now()
    where id = v_course_id
    returning * into v_course;
  else
    select * into v_course from public.courses where id = v_speculative_course_id;
  end if;

  return v_course;
end;
$function$;

revoke execute on function public.upsert_external_course(text, text, text, text, text, text, text, text, double precision, double precision, integer) from public, anon;
grant execute on function public.upsert_external_course(text, text, text, text, text, text, text, text, double precision, double precision, integer) to authenticated;

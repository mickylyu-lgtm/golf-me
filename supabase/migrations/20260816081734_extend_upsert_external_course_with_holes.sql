-- course-enrich (GolfCourseAPI, on-demand name-based lookup) needs to fill
-- in `holes` without also overwriting the name/city/region/lat/lng that
-- Geoapify already reliably provided -- GolfCourseAPI's club_name+course_name
-- split often reads worse as a single display name ("Bethpage State Park" +
-- "Yellow" vs Geoapify's "Bethpage Yellow"), so enrichment should only add
-- what Geoapify didn't have, never rewrite what it did.
--
-- golfcourseapi_checked_at tracks whether enrichment has ever been attempted
-- for a course (match found or not) so course-enrich never re-calls
-- GolfCourseAPI for the same course twice -- the free tier is 50
-- requests/day, and repeat checks would burn through that fast with no
-- benefit once a course has already been checked once.
alter table public.courses add column if not exists golfcourseapi_checked_at timestamptz;

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
    update public.courses set
      name = coalesce(p_name, name),
      normalized_name = coalesce(p_normalized_name, normalized_name),
      city = coalesce(p_city, city),
      region = coalesce(p_region, region),
      country = coalesce(p_country, country),
      address = coalesce(p_address, address),
      latitude = coalesce(p_latitude, latitude),
      longitude = coalesce(p_longitude, longitude),
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

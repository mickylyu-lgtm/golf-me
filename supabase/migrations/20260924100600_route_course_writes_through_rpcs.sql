-- Health audit Batch C, P2-4: any signed-in user could insert or update any
-- public.courses row directly (courses_insert_authenticated /
-- courses_update_authenticated, 20260812210000, both `true`), e.g. rename a
-- course or move its coordinates for everyone.
--
-- Every legitimate writer already goes through a SECURITY DEFINER RPC
-- except one: course-search uses upsert_external_course(), course-enrich
-- uses attach_external_course_mapping() / mark_course_enrichment_checked(),
-- and the client never writes courses at all (realCourseSearch.ts only
-- selects). The one exception was course-enrich's follow-up
-- `from("courses").update({latitude, longitude})` for GolfCourseAPI
-- coordinates -- so that write moves into attach_external_course_mapping()
-- itself (two new optional params), and the direct write policies/grants
-- are removed.
--
-- Deploy order: apply this migration, then deploy the updated course-enrich
-- Edge Function. In between, the currently deployed course-enrich still
-- works: its 4-arg named call resolves to the new function via the
-- defaults, and its direct coordinate update simply matches zero rows under
-- RLS (no error) -- so the only effect of the gap is GolfCourseAPI
-- coordinates not overriding Geoapify's for courses enriched in that window.
--
-- Not changed here (reported as residual risk): the RPCs themselves are
-- still callable by any authenticated user with caller-supplied values,
-- because both Edge Functions call them with the caller's forwarded JWT.
-- Restricting them to service_role needs the Edge Functions switched to a
-- service-role client and a coordinated deploy.

drop policy courses_insert_authenticated on public.courses;
drop policy courses_update_authenticated on public.courses;
revoke insert, update, delete, truncate on public.courses from anon, authenticated;

-- Signature change (two new trailing params), so drop + recreate rather
-- than create or replace. Body is unchanged apart from the coordinate
-- block at the end.
drop function public.attach_external_course_mapping(uuid, text, text, integer);

create function public.attach_external_course_mapping(
  p_course_id uuid,
  p_provider text,
  p_external_id text,
  p_holes integer default null,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns public.courses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_course_id uuid;
  v_course public.courses%rowtype;
begin
  if not exists (select 1 from public.courses where id = p_course_id) then
    raise exception 'Course not found.';
  end if;

  insert into public.course_external_ids (course_id, provider, external_id)
  values (p_course_id, p_provider, p_external_id)
  on conflict (provider, external_id) do update set last_synced_at = now()
  returning course_id into v_existing_course_id;

  if v_existing_course_id = p_course_id then
    update public.courses set
      holes = coalesce(p_holes, holes),
      updated_at = now()
    where id = p_course_id
    returning * into v_course;
  else
    -- Already mapped to a different canonical course -- leave it alone,
    -- return that course's current row so the caller can see what's there.
    select * into v_course from public.courses where id = v_existing_course_id;
  end if;

  -- golfcourseapi_checked_at is set on the CALLER's course_id regardless of
  -- which course the mapping actually landed on, so course-enrich never
  -- retries this course again even in the "mapped elsewhere" branch above.
  update public.courses set golfcourseapi_checked_at = now() where id = p_course_id;

  -- GolfCourseAPI coordinates (previously a direct client-JWT update in
  -- course-enrich) -- applied to whichever course the mapping actually
  -- landed on, only as a valid pair, only for the golfcourseapi provider.
  -- Anything missing or out of range leaves the existing coordinates alone.
  if p_provider = 'golfcourseapi'
     and p_latitude is not null and p_longitude is not null
     and p_latitude between -90 and 90 and p_longitude between -180 and 180
     and not (p_latitude = 0 and p_longitude = 0) then
    update public.courses set latitude = p_latitude, longitude = p_longitude, updated_at = now()
    where id = v_course.id
    returning * into v_course;
  end if;

  return v_course;
end;
$$;

revoke execute on function public.attach_external_course_mapping(uuid, text, text, integer, double precision, double precision) from public, anon;
grant execute on function public.attach_external_course_mapping(uuid, text, text, integer, double precision, double precision) to authenticated, service_role;

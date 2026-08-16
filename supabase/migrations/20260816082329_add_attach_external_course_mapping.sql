-- upsert_external_course() answers "find-or-create a course, starting from
-- one provider's result." Enrichment is the opposite shape: we already know
-- the canonical course_id (a course course-search already found via
-- Geoapify) and want to attach a *second* provider's mapping (GolfCourseAPI,
-- found by name search) to that same course, plus fill in a couple of
-- fields Geoapify never had (holes). Reusing upsert_external_course here
-- would risk creating a second, wrong canonical course instead of attaching
-- to the one the caller already has.
--
-- If the (provider, external_id) pair is already mapped to a *different*
-- course_id (the same GolfCourseAPI course independently matched against
-- two different Geoapify entries -- possible if Geoapify itself has near-
-- duplicate places for one physical course), this deliberately does not
-- merge the two canonical courses -- that's a real data-quality problem but
-- merging two courses' existing round/review history is out of scope for
-- this pass. It just leaves the existing mapping alone and reports which
-- course_id actually ended up attached, so the caller can tell whether its
-- own course_id was the one that won.
create or replace function public.attach_external_course_mapping(
  p_course_id uuid,
  p_provider text,
  p_external_id text,
  p_holes integer default null
)
returns public.courses
language plpgsql
security definer
set search_path = ''
as $function$
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

  return v_course;
end;
$function$;

revoke execute on function public.attach_external_course_mapping(uuid, text, text, integer) from public, anon;
grant execute on function public.attach_external_course_mapping(uuid, text, text, integer) to authenticated;

-- Mark "checked, no match found" too -- attach_external_course_mapping()
-- above only runs when a match WAS found. course-enrich needs a way to
-- record a negative result too, so it never re-spends API quota re-checking
-- a course that genuinely isn't in GolfCourseAPI's ~30k-course coverage.
create or replace function public.mark_course_enrichment_checked(p_course_id uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.courses set golfcourseapi_checked_at = now() where id = p_course_id;
$function$;

revoke execute on function public.mark_course_enrichment_checked(uuid) from public, anon;
grant execute on function public.mark_course_enrichment_checked(uuid) to authenticated;

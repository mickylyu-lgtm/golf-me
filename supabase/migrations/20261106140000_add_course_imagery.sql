-- Course imagery cache + provider call caps (Micky, 2026-11-05: show what
-- the actual course looks like; a real photo of that course first,
-- satellite only as the last resort).
--
-- Written only by the course-photos Edge Function with the service-role key.
-- Clients never read or write these tables directly (RLS on, no policies,
-- no grants): they get photos through the function, which applies the
-- provider rules below.
--
-- What is stored, and why it's allowed:
--   * google_place_id: Google's Places policies exempt place IDs from the
--     caching restrictions. Nothing else from Google is stored: no photo
--     names (Google: "You cannot cache a photo name"), no photo URLs, no
--     place names, no coordinates. Photos are fetched fresh per request.
--   * Wikimedia Commons: the chosen file's URL, page, author and license.
--     Freely licensed; image bytes are never stored (hotlinked).
--   * outline_*: the course's OpenStreetMap outline as a bounding box
--     (ODbL; credited "© OpenStreetMap contributors").
--   * provided_*: an image the course itself gave GolfMe, entered by an
--     admin in the SQL editor. Nothing reads it yet: it is the source for
--     the AI preview clips, parked for now (Higgsfield phase 2, kept as a
--     separate patch).
--
-- course_imagery_usage + course_imagery_take_quota(): a hard daily cap per
-- provider, checked atomically before every billable call.
--
-- Rollback: drop function public.course_imagery_take_quota(text, integer, integer);
--           drop table public.course_imagery_usage; drop table public.course_imagery;

create table public.course_imagery (
  course_id uuid primary key references public.courses (id) on delete cascade,

  -- Google Places (New): the matched place, or null after a lookup that
  -- found no match (google_checked_at set either way).
  google_place_id text,
  google_match_distance_m integer,
  google_checked_at timestamptz,

  -- Wikimedia Commons: the matched file, or nulls after a lookup that found
  -- none (wikimedia_checked_at set either way).
  wikimedia_file text,
  wikimedia_url text,
  wikimedia_thumb_url text,
  wikimedia_page_url text,
  wikimedia_artist text,
  wikimedia_license text,
  wikimedia_license_class text check (wikimedia_license_class in ('cc0', 'pd', 'cc-by', 'cc-by-sa', 'gfdl')),
  wikimedia_checked_at timestamptz,

  -- The course's outline (bounding box of its OpenStreetMap
  -- leisure=golf_course feature, via Geoapify Place Details or Overpass),
  -- so satellite views frame the holes, not our single point. Nulls after
  -- a lookup that found none (outline_checked_at set either way). OSM data,
  -- ODbL: the "© OpenStreetMap contributors" credit is shown with it.
  outline_south double precision,
  outline_west double precision,
  outline_north double precision,
  outline_east double precision,
  outline_source text check (outline_source in ('geoapify', 'osm')),
  outline_checked_at timestamptz,
  constraint course_imagery_outline_valid check (
    (outline_south is null and outline_west is null and outline_north is null and outline_east is null)
    -- All four set (a NULL comparison would otherwise pass the check).
    or (num_nonnulls(outline_south, outline_west, outline_north, outline_east) = 4
        and outline_south between -90 and 90 and outline_north between -90 and 90 and outline_south < outline_north
        and outline_west between -180 and 180 and outline_east between -180 and 180 and outline_west < outline_east)
  ),

  -- A photo the course provided, with rights confirmed by an admin.
  provided_image_url text check (provided_image_url is null or provided_image_url ~ '^https://'),
  provided_image_credit text,
  provided_by uuid references auth.users (id) on delete set null,
  provided_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.course_imagery is
  'Per-course photo lookups for course-photos (service role only). Stores the Google place id (exempt from Google caching limits) and the Wikimedia file + license; never Google photo names/URLs or image bytes.';

create trigger set_course_imagery_updated_at
  before update on public.course_imagery
  for each row execute function public.set_updated_at();

alter table public.course_imagery enable row level security;
revoke all on public.course_imagery from anon, authenticated;
grant select, insert, update, delete on public.course_imagery to service_role;

create table public.course_imagery_usage (
  day date not null,
  provider text not null check (provider ~ '^[a-z0-9_]{1,40}$'),
  calls integer not null default 0 check (calls >= 0),
  primary key (day, provider)
);

comment on table public.course_imagery_usage is
  'Billable imagery calls per UTC day and provider; course_imagery_take_quota() refuses a call once the cap is reached. Service role only.';

alter table public.course_imagery_usage enable row level security;
revoke all on public.course_imagery_usage from anon, authenticated;
grant select, insert, update, delete on public.course_imagery_usage to service_role;

-- Takes p_cost units of today's (UTC) budget for p_provider if that keeps
-- the day at or under p_cap; true when taken. One statement, so concurrent
-- callers can't both take the last unit.
create function public.course_imagery_take_quota(p_provider text, p_cap integer, p_cost integer default 1)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taken integer;
begin
  if p_cap is null or p_cap <= 0 or p_cost is null or p_cost <= 0 or p_cost > p_cap then
    return false;
  end if;
  insert into public.course_imagery_usage as u (day, provider, calls)
  values ((now() at time zone 'utc')::date, p_provider, p_cost)
  on conflict (day, provider) do update
    set calls = u.calls + excluded.calls
    where u.calls + excluded.calls <= p_cap
  returning u.calls into v_taken;
  return v_taken is not null;
end;
$$;

revoke execute on function public.course_imagery_take_quota(text, integer, integer) from public, anon, authenticated;
grant execute on function public.course_imagery_take_quota(text, integer, integer) to service_role;

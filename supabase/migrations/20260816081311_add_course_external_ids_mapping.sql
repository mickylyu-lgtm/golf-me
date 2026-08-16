-- Redesigns public.courses so a canonical GolfMe course is no longer tied
-- 1:1 to a single (provider, external_id) pair. Previously Phase 3 baked
-- provider/external_id directly onto the courses row, which meant the same
-- physical course discovered through two different providers (e.g. Geoapify
-- for location-based discovery, GolfCourseAPI for name-based detail
-- enrichment) would create two duplicate course rows instead of one
-- canonical course with two mappings. Table has 0 rows in production as of
-- this migration, so this is a straight redesign, not a data migration.
alter table public.courses drop constraint if exists courses_provider_external_id_key;
alter table public.courses drop column if exists provider;
alter table public.courses drop column if exists external_id;
alter table public.courses drop column if exists fetched_at;

alter table public.courses add column if not exists normalized_name text;
alter table public.courses add column if not exists address text;
alter table public.courses add column if not exists holes integer;
alter table public.courses add column if not exists course_type text;
alter table public.courses add column if not exists website text;
alter table public.courses add column if not exists phone text;
alter table public.courses add column if not exists description text;
-- address already existed as a column from Phase 3 in some environments;
-- add if not exists is defensive, not a sign it's expected to already be there.

create table public.course_external_ids (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  provider text not null,
  external_id text not null,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, external_id)
);
comment on table public.course_external_ids is 'Maps a canonical GolfMe course to its id in each external provider (geoapify for location discovery, golfcourseapi for name-based detail enrichment, future providers later) so the same physical course never gets duplicated across providers.';

create index course_external_ids_course_id_idx on public.course_external_ids (course_id);

alter table public.course_external_ids enable row level security;

-- Read-only for clients, same reasoning as round_participants: every write
-- must go through upsert_external_course() below (SECURITY DEFINER), never
-- a direct client insert/update, so the dedup-by-(provider,external_id)
-- check and the write happen atomically in one transaction.
create policy course_external_ids_select_authenticated on public.course_external_ids
  for select to authenticated
  using (true);

-- Atomic find-or-create: the only sanctioned way any (provider, external_id)
-- pair gets attached to a course. Uses an "insert speculatively, reconcile
-- on conflict" pattern rather than a plain check-then-insert, so two
-- concurrent upserts for the same external id can never create two
-- canonical course rows for the same physical course -- the unique
-- constraint on course_external_ids(provider, external_id) is the actual
-- concurrency guard, same role the row lock plays in join_golf_call().
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
  p_longitude double precision
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
  insert into public.courses (name, normalized_name, city, region, country, address, latitude, longitude)
  values (p_name, p_normalized_name, p_city, p_region, p_country, p_address, p_latitude, p_longitude)
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
      updated_at = now()
    where id = v_course_id
    returning * into v_course;
  else
    select * into v_course from public.courses where id = v_speculative_course_id;
  end if;

  return v_course;
end;
$function$;

revoke execute on function public.upsert_external_course(text, text, text, text, text, text, text, text, double precision, double precision) from public;
grant execute on function public.upsert_external_course(text, text, text, text, text, text, text, text, double precision, double precision) to authenticated;

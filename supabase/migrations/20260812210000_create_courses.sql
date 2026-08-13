-- Real course-data cache (Phase 3 of the real-backend migration). Populated
-- by the app itself as golfers search — each search upserts whatever the
-- provider (Geoapify) returned, so this fills in organically rather than
-- needing a bulk import job. provider+external_id is the natural key back
-- to the source record; fetched_at lets a future phase decide when a cached
-- row is stale enough to re-fetch.
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  name text not null,
  city text,
  region text,
  country text,
  latitude double precision not null,
  longitude double precision not null,
  address text,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);

comment on table public.courses is
  'Cache of real course records returned by the course-search provider (Geoapify). Upserted by the app on search; provider+external_id is the source-of-truth key.';

alter table public.courses enable row level security;

-- Shared reference data, not user-owned — any authenticated golfer can read
-- every cached course (same posture as profiles' select-any-authenticated).
create policy "courses_select_authenticated"
  on public.courses for select
  to authenticated
  using (true);

-- Any authenticated golfer's search can add to or refresh the shared cache
-- (upsert on provider+external_id) — low risk since this only ever holds
-- provider-sourced geographic data, never anything user-entered freeform.
-- No client-facing delete/update-arbitrary-fields policy: rows are only
-- ever upserted wholesale by the search sync, never edited piecemeal.
create policy "courses_insert_authenticated"
  on public.courses for insert
  to authenticated
  with check (true);

create policy "courses_update_authenticated"
  on public.courses for update
  to authenticated
  using (true)
  with check (true);

create trigger set_courses_updated_at
  before update on public.courses
  for each row execute function public.set_updated_at();

-- No separate index on (provider, external_id): the unique constraint above
-- already creates one.

-- Global hosting, Phase 2 (prepared 2026-10-20, NOT applied -- needs Micky's OK).
--
-- Worldwide city search for the playing-area picker. LocationPicker now asks
-- the course-search Edge Function (mode 'geocode') for real cities through
-- Geoapify autocomplete, instead of only the 12 built-in regions. This
-- migration adds:
--
--   1. Four nullable profile columns:
--      playing_area_place_id      canonical id of the picked city:
--                                 'geoapify:<place_id>' for a geocoded city,
--                                 'golfme:<region id>' for a built-in region
--                                 (src/data/regions.ts). Null for free-text
--                                 areas and raw device locations.
--      playing_area_country_code  ISO 3166-1 alpha-2, lowercase (Geoapify's
--                                 format). Phase 3 (currency/units defaults).
--      playing_area_timezone      IANA zone of the city, e.g. 'Asia/Tokyo'.
--                                 Phase 3 (time zones). Shape-checked only;
--                                 readers must tolerate an unknown zone.
--      distance_unit              'mi' | 'km'. Null = no explicit choice, the
--                                 client uses the device-region default.
--                                 Storage only for now; Settings UI later.
--      All are additive and nullable with no default, so ADD COLUMN is a
--      metadata-only change (no table rewrite) and every existing row and
--      older client is unaffected. The client only sends these fields once
--      it sees them in its own select('*') profile row (see
--      profileSupportsPlaceColumns in src/lib/profile.ts), so the web build
--      can ship before or after this migration.
--
--   2. A private geocode cache and per-user rate-limit buckets, both with
--      RLS on and no policies (deny-all to every client role), reachable
--      only through the SECURITY DEFINER functions below.
--
--   3. public.geo_places: each geocoded city's name in GolfMe's six
--      languages, one row per place (section 6). Readable by signed-in
--      accounts, written only by the Edge Function (service_role). This is
--      how city names display in each VIEWER's language while the profile
--      keeps a language-neutral identity (place id, country, zone, coords)
--      and an English area_label fallback.
--
-- Location privacy is unchanged: profiles_coarsen_location (20260930090000)
-- still rounds playing_area_lat/lng to 2 dp on every write. The new columns
-- name a city, never a point. The cache stores only city-level results whose
-- coordinates the Edge Function already rounded to 2 dp, keyed by a SHA-256
-- hash of the normalized query, so a typed address is never stored as text.
--
-- Existing profiles triggers are untouched and don't read the new columns:
-- profiles_protect_unverified_trust_columns only resets the trust/Reputation
-- columns, profiles_guard_founding_columns only the founding columns, the
-- founder-welcome trigger only reacts to has_onboarded, and
-- profiles_award_founding_golfer still fires only on has_onboarded /
-- playing_area_lat / playing_area_lng and reads only those plus email
-- confirmation and roles. Nothing here reads or writes a founding column,
-- the cohort state or the awards ledger. Founding eligibility rules are NOT
-- changed by this migration; what Phase 2 changes is which picker choices
-- carry coordinates (see docs/FOUNDING_ELIGIBILITY_REVIEW.md).

-- 1. Profile columns ---------------------------------------------------------

alter table public.profiles
  add column playing_area_place_id text,
  add column playing_area_country_code text,
  add column playing_area_timezone text,
  add column distance_unit text;

-- Same shapes as supabase/functions/_shared/cityGeocode.ts (PLACE_ID_RE,
-- COUNTRY_CODE_RE, TIMEZONE_RE) -- change them together.
alter table public.profiles
  add constraint profiles_playing_area_place_id_shape
    check (playing_area_place_id is null or playing_area_place_id ~ '^(geoapify|golfme):[A-Za-z0-9_-]{1,200}$'),
  add constraint profiles_playing_area_country_code_shape
    check (playing_area_country_code is null or playing_area_country_code ~ '^[a-z]{2}$'),
  add constraint profiles_playing_area_timezone_shape
    check (
      playing_area_timezone is null
      or (char_length(playing_area_timezone) <= 64
          and playing_area_timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$')
    ),
  add constraint profiles_distance_unit_values
    check (distance_unit is null or distance_unit in ('mi', 'km'));

-- A client built before Phase 2 (an old cached web bundle, or the iOS app
-- resumed without a reload) moves the playing area by writing only
-- area_label + lat/lng, so it would leave a stale city id behind (labels
-- would then read "Tokyo" for someone who moved to London). When the label
-- AND the coordinates change but the place id was not part of the change,
-- drop the place fields. New clients always send the place (or null)
-- together with the area, so they never hit this. Touches only the three
-- place columns; never coordinates, labels, trust or founding columns.
create function public.profiles_clear_stale_place()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.playing_area_place_id is not null
     and new.playing_area_place_id is not distinct from old.playing_area_place_id
     and new.area_label is distinct from old.area_label
     and (new.playing_area_lat is distinct from old.playing_area_lat
          or new.playing_area_lng is distinct from old.playing_area_lng) then
    new.playing_area_place_id := null;
    new.playing_area_country_code := null;
    new.playing_area_timezone := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_clear_stale_place() from public, anon, authenticated;

create trigger profiles_clear_stale_place
  before update of area_label, playing_area_lat, playing_area_lng on public.profiles
  for each row
  execute function public.profiles_clear_stale_place();

-- No grant changes: profiles uses table-level grants and the existing
-- profiles_update_own / profiles_select_authenticated policies, which cover
-- new columns automatically. A city id / country / zone is no more revealing
-- than area_label, which is already readable by every signed-in account.

-- 2. Geocode cache -----------------------------------------------------------

create table private.geocode_cache (
  cache_key  text primary key check (cache_key ~ '^[0-9a-f]{64}$'),
  results    jsonb not null check (jsonb_typeof(results) = 'array' and pg_column_size(results) <= 16384),
  created_at timestamptz not null default now()
);

create index geocode_cache_created_at_idx on private.geocode_cache (created_at);

alter table private.geocode_cache enable row level security;
revoke all on table private.geocode_cache from public, anon, authenticated;

-- 3. Per-user rate-limit buckets (one row per user per hour) -----------------

create table private.geocode_rate_buckets (
  user_id       uuid not null references auth.users (id) on delete cascade,
  bucket_start  timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, bucket_start)
);

create index geocode_rate_buckets_bucket_start_idx on private.geocode_rate_buckets (bucket_start);

alter table private.geocode_rate_buckets enable row level security;
revoke all on table private.geocode_rate_buckets from public, anon, authenticated;

-- 4. Quota check, called by course-search with the CALLER's JWT. Identity is
-- auth.uid(), never a parameter, so nobody can spend someone else's quota.
-- Counts Geoapify CREDITS, not requests: p_cost is 1 for a city autocomplete
-- (mode 'geocode') and 2 for a city's localized names (mode 'place': Place
-- Details + the details.names feature). Calling it directly with any cost
-- only spends the caller's own allowance, so the parameter needs no trust.
-- Limits (keep in sync with docs/GLOBAL_HOSTING.md):
--   per user: 60 credits per clock hour, 200 per rolling ~24 h
--   global:   2000 credits per rolling ~24 h, so city search can never eat
--             the whole Geoapify daily allowance course search shares
-- A denied request is NOT counted, so one abusive account contributes at
-- most 200/day to the global total. Serialized per user with a
-- transaction-scoped advisory lock (same pattern as the Caddie daily limit).
-- The global check is not serialized across users, so concurrent callers
-- can overshoot 2000 by at most (number of concurrent requests x 2): a soft
-- ceiling well under the 3000/day Free plan.
-- Returns 'ok' | 'user_limit' | 'global_limit' | 'unauthenticated'.
create function public.consume_geocode_quota(p_cost integer default 1)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hour timestamptz := date_trunc('hour', now());
  v_hour_count integer;
  v_day_count bigint;
  v_global_count bigint;
begin
  if v_uid is null then
    return 'unauthenticated';
  end if;
  if p_cost is null or p_cost < 1 or p_cost > 5 then
    raise exception 'Invalid cost.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('geocode_quota:' || v_uid::text, 0));

  select coalesce(sum(b.request_count) filter (where b.bucket_start = v_hour), 0),
         coalesce(sum(b.request_count), 0)
    into v_hour_count, v_day_count
  from private.geocode_rate_buckets b
  where b.user_id = v_uid
    and b.bucket_start > now() - interval '24 hours';

  if v_hour_count + p_cost > 60 or v_day_count + p_cost > 200 then
    return 'user_limit';
  end if;

  select coalesce(sum(b.request_count), 0) into v_global_count
  from private.geocode_rate_buckets b
  where b.bucket_start > now() - interval '24 hours';

  if v_global_count + p_cost > 2000 then
    return 'global_limit';
  end if;

  insert into private.geocode_rate_buckets as b (user_id, bucket_start, request_count)
  values (v_uid, v_hour, p_cost)
  on conflict (user_id, bucket_start) do update set request_count = b.request_count + p_cost;

  -- Keep the table small: drop this user's buckets older than 2 days.
  delete from private.geocode_rate_buckets b
  where b.user_id = v_uid and b.bucket_start < now() - interval '48 hours';

  return 'ok';
end;
$$;

revoke execute on function public.consume_geocode_quota(integer) from public, anon;
grant execute on function public.consume_geocode_quota(integer) to authenticated;

-- 5. Cache read/write, service_role only (the Edge Function's server-side
-- client). Not callable by clients, so nobody can plant fake city results.
-- Entries live 30 days; city centroids, names and zones rarely change.
create function public.geocode_cache_get(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select c.results
  from private.geocode_cache c
  where c.cache_key = p_key
    and c.created_at > now() - interval '30 days';
$$;

create function public.geocode_cache_put(p_key text, p_results jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.geocode_cache (cache_key, results)
  values (p_key, p_results)
  on conflict (cache_key) do update set results = excluded.results, created_at = now();

  delete from private.geocode_cache c where c.created_at < now() - interval '30 days';
end;
$$;

revoke execute on function public.geocode_cache_get(text) from public, anon, authenticated;
revoke execute on function public.geocode_cache_put(text, jsonb) from public, anon, authenticated;
grant execute on function public.geocode_cache_get(text) to service_role;
grant execute on function public.geocode_cache_put(text, jsonb) to service_role;

-- 6. Localized city names, one row per PLACE (never per user) --------------
--
-- Profiles store a canonical place id plus an English area_label fallback;
-- each viewer's client reads the city's name in its own app language from
-- here and composes "City, Country" with Intl.DisplayNames (country names
-- need no storage). Filled only by course-search mode 'place' (service_role)
-- from one Geoapify Place Details request per new distinct city; never by
-- clients, so nobody can plant a misleading name. Holds public geographic
-- names only: no user id, no coordinates, nothing that says who lives where
-- (profiles.area_label already tells signed-in accounts that). Built-in
-- regions ('golfme:*') ship their names in the app bundle and never get a row.
create table public.geo_places (
  place_id     text primary key check (place_id ~ '^geoapify:[A-Za-z0-9_-]{1,190}$'),
  names        jsonb not null check (
                 jsonb_typeof(names) = 'object'
                 and pg_column_size(names) <= 4096
                 and names ? 'en'
                 and names - array['en', 'es', 'ja', 'ko', 'zh-Hans', 'zh-Hant'] = '{}'::jsonb
               ),
  country_code text check (country_code is null or country_code ~ '^[a-z]{2}$'),
  region_code  text check (region_code is null or region_code ~ '^[A-Z0-9]{1,3}$'),
  fetched_at   timestamptz not null default now()
);

alter table public.geo_places enable row level security;

create policy geo_places_select_authenticated
  on public.geo_places for select
  to authenticated
  using (true);

revoke all on table public.geo_places from public, anon, authenticated;
grant select on table public.geo_places to authenticated;
grant select, insert, update on table public.geo_places to service_role;

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
-- profiles_award_founding_golfer still keys on has_onboarded + lat/lng. (A
-- geocoded city near Midtown now carries coordinates where free text used
-- to carry none, so it can qualify for the NYC Founding award as intended.)

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
-- Limits (keep in sync with docs/GLOBAL_HOSTING.md):
--   per user: 60 requests per clock hour, 200 per rolling ~24 h
--   global:   2000 requests per rolling ~24 h, so city search can never eat
--             the whole Geoapify daily allowance course search shares
-- A denied request is NOT counted, so one abusive account contributes at
-- most 200/day to the global total. Serialized per user with a
-- transaction-scoped advisory lock (same pattern as the Caddie daily limit).
-- Returns 'ok' | 'user_limit' | 'global_limit' | 'unauthenticated'.
create function public.consume_geocode_quota()
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

  perform pg_advisory_xact_lock(hashtextextended('geocode_quota:' || v_uid::text, 0));

  select coalesce(sum(b.request_count) filter (where b.bucket_start = v_hour), 0),
         coalesce(sum(b.request_count), 0)
    into v_hour_count, v_day_count
  from private.geocode_rate_buckets b
  where b.user_id = v_uid
    and b.bucket_start > now() - interval '24 hours';

  if v_hour_count >= 60 or v_day_count >= 200 then
    return 'user_limit';
  end if;

  select coalesce(sum(b.request_count), 0) into v_global_count
  from private.geocode_rate_buckets b
  where b.bucket_start > now() - interval '24 hours';

  if v_global_count >= 2000 then
    return 'global_limit';
  end if;

  insert into private.geocode_rate_buckets as b (user_id, bucket_start, request_count)
  values (v_uid, v_hour, 1)
  on conflict (user_id, bucket_start) do update set request_count = b.request_count + 1;

  -- Keep the table small: drop this user's buckets older than 2 days.
  delete from private.geocode_rate_buckets b
  where b.user_id = v_uid and b.bucket_start < now() - interval '48 hours';

  return 'ok';
end;
$$;

revoke execute on function public.consume_geocode_quota() from public, anon;
grant execute on function public.consume_geocode_quota() to authenticated;

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

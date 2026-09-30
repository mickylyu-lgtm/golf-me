-- Location privacy fix (launch blocker), 2026-09-30.
--
-- profiles.playing_area_lat/lng is readable by every signed-in account:
-- profiles_select_authenticated is using (true) and authenticated holds
-- column SELECT on both columns, and signup is open. That's deliberate --
-- golfer distance / discovery (P2-1, Batch E) is computed client-side from
-- other golfers' coordinates, so the columns must stay readable. What was
-- NOT intended: LocationPicker's "Use My Current Location" saved the raw
-- navigator.geolocation fix (12-13 decimal places, i.e. sub-metre), so any
-- account could read another golfer's near-exact position -- often their
-- home.
--
-- Fix: the playing area is only ever a general area. Both columns are
-- rounded to 2 decimal places (~1.1 km of latitude) on every insert and
-- update, whatever the client sends. The client now coarsens too
-- (src/lib/coarseLocation.ts, same half-away-from-zero rounding) so nothing
-- precise leaves the device, but this trigger is the enforcement -- an old
-- cached client, a stale onboarding draft in localStorage, or a direct REST
-- call can't store a precise point.
--
-- Columns are double precision, so round via numeric: round(x::numeric, 2)
-- is exact decimal rounding (round(double precision) has no scale argument),
-- and casting the 2-decimal numeric back to double precision stores the
-- nearest double, which Postgres/PostgREST render as exactly 2 decimals.
--
-- SECURITY INVOKER is enough -- it only rewrites NEW, touching no other
-- table (same as set_updated_at).
create function public.coarsen_profile_location()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.playing_area_lat is not null then
    new.playing_area_lat := round(new.playing_area_lat::numeric, 2)::double precision;
  end if;
  if new.playing_area_lng is not null then
    new.playing_area_lng := round(new.playing_area_lng::numeric, 2)::double precision;
  end if;
  return new;
end;
$$;

-- Trigger functions default to PUBLIC execute; revoke the direct-RPC
-- surface like the other trigger functions (trigger firing isn't gated by
-- this grant).
revoke execute on function public.coarsen_profile_location() from public, anon, authenticated;

create trigger profiles_coarsen_location
  before insert or update on public.profiles
  for each row execute function public.coarsen_profile_location();

-- One-time backfill of rows already holding more than 2 decimals.
--
-- Interaction with the other profiles triggers (verified live 2026-09-29,
-- only these three exist besides the new one):
--   profiles_protect_unverified_trust_columns (BEFORE UPDATE) -- resets the
--     verification/reputation-input columns to their OLD values. This
--     update doesn't touch them, so it's a no-op here; it neither blocks the
--     backfill nor changes any trust/Reputation data. Left enabled.
--   trg_notify_founder_welcome (AFTER UPDATE) -- only acts on a
--     has_onboarded false -> true transition (column is NOT NULL). This
--     update leaves has_onboarded unchanged, so it returns immediately; no
--     welcome DM is sent. Left enabled.
--   set_profiles_updated_at (BEFORE UPDATE) -- stamps updated_at = now() on
--     the backfilled rows. Deliberately left enabled: nothing in the app or
--     any database function reads profiles.updated_at, and toggling the
--     trigger (ALTER TABLE ... DISABLE TRIGGER) would take an exclusive table
--     lock and depend on table ownership for no real benefit.
-- The new profiles_coarsen_location trigger also fires on this update and
-- rounds the same values again -- idempotent.
update public.profiles
set
  playing_area_lat = round(playing_area_lat::numeric, 2)::double precision,
  playing_area_lng = round(playing_area_lng::numeric, 2)::double precision
where (playing_area_lat is not null and playing_area_lat::numeric <> round(playing_area_lat::numeric, 2))
   or (playing_area_lng is not null and playing_area_lng::numeric <> round(playing_area_lng::numeric, 2));

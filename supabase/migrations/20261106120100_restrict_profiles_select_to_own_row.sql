-- Public golfer directory, phase 2 of 2 (2026-11-05). NOT APPLIED.
--
-- DO NOT APPLY (and do not `supabase db push`) until ALL of these hold:
--   1. 20261106120000_add_public_golfer_directory is applied and its staging
--      checks passed (scripts/staging/public-directory-authz.sql).
--   2. The client that reads other golfers ONLY through golfer_directory()
--      and golfer_public_profiles() (src/lib/publicDirectory.ts) is live on
--      golfme.app, and a two-account check passed on web and iOS: Golfers
--      list, a golfer's profile page, DM inbox + thread names, round rosters,
--      Community authors, Coach Review reviewer names, notifications.
--   3. Long enough has passed that no device still runs an older bundle
--      (the iOS shell keeps a loaded page in memory until it is killed;
--      suggest >= 7 days, or ask testers to force-quit).
-- An older bundle after this file reads only its own row: the Golfers list
-- goes empty and DM threads whose partner can't be resolved drop out of the
-- inbox. Nothing is deleted; it recovers on reload into the new bundle.
--
-- What it does: replaces profiles_select_authenticated (using (true)) with
-- an own-row policy. Every other golfer's row is then reachable only
-- through the SECURITY DEFINER RPCs, which return a narrow column list
-- without coordinates and enforce onboarding / Discoverable / blocks /
-- test-account exclusion server-side. Own-row read and update are
-- unchanged (profiles_update_own, profiles_insert_own untouched). Every
-- server function that reads other golfers' rows (notification triggers,
-- fan-out, admin RPCs, reputation, founding) is SECURITY DEFINER and
-- unaffected; Edge Functions use the service role.
--
-- ROLLBACK (exact, instant, no data involved):
--   begin;
--   drop policy if exists profiles_select_own on public.profiles;
--   create policy "profiles_select_authenticated" on public.profiles
--     for select to authenticated using (true);
--   commit;

do $$
begin
  if to_regprocedure('public.golfer_directory(integer, integer)') is null
     or to_regprocedure('public.golfer_public_profiles(uuid[])') is null then
    raise exception 'Apply 20261106120000_add_public_golfer_directory first (and ship its client). Nothing was changed.';
  end if;
end;
$$;

drop policy "profiles_select_authenticated" on public.profiles;

create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

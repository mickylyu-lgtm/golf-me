# Global hosting

GolfMe is usable anywhere it's available. NYC is the founding community, not an access gate. This file tracks the global-hosting work on the `global-hosting` branch.

## Phase status

| Phase | What | Status |
|---|---|---|
| 1 | Remote-city distance uses the round's course coordinates; NYC-only Founding copy; "Open rounds" heading; translated location picker | Committed on branch (client only) |
| 2 | Worldwide city autocomplete and geocoding; canonical place id, country and time zone on profiles; `distance_unit` storage | **Prepared, not applied or deployed** (this doc) |
| 3 | Time zones on rounds, currency, km/mi display and a Settings toggle | Not started. Will read `playing_area_timezone`, `playing_area_country_code` and `distance_unit` |

## Phase 2: what's on the branch

- **Migration** `supabase/migrations/20261021120000_profiles_playing_area_place_and_geocode.sql`. **Not applied.**
  - Adds 4 nullable profile columns: `playing_area_place_id`, `playing_area_country_code`, `playing_area_timezone` and `distance_unit` (`'mi'`/`'km'`; null means the device-region default). Each has a shape CHECK.
  - Adds `private.geocode_cache` and `private.geocode_rate_buckets`. Both have RLS on with no policies and no client grants.
  - Adds 3 functions:
    - `consume_geocode_quota()`: authenticated users, keyed on `auth.uid()`.
    - `geocode_cache_get()` / `geocode_cache_put()`: `service_role` only.
  - It is additive only. No existing column, trigger or policy changes, and no backfill.
- **Edge Function** `course-search`, new `mode: "geocode"`, with pure helpers in `supabase/functions/_shared/cityGeocode.ts`. **Not deployed.** A request goes through these steps in order:
  1. Validate the input: at least 3 characters (2 for CJK/Hangul), at most 80, and a language from an allow-list.
  2. Check the per-user quota. This fails closed.
  3. Check the per-isolate memo.
  4. Check the 30-day DB cache.
  5. Call Geoapify Address Autocomplete with `type=city`.

  Privacy rules in the function:
  - Coordinates are rounded to 2 dp on the server.
  - The ranking bias is rounded to whole degrees.
  - Cache keys are SHA-256 hashes, so typed text is never stored.
  - Nothing logs the query or coordinates.
  - Provider error bodies are never sent back to the client.
- **Client.**
  - `LocationPicker` debounces input (350 ms) and calls the geocoder for real accounts only. Demo mode never calls it.
  - The built-in 12 regions are always shown first, and they are the whole list in demo mode, offline, or after any geocode failure. Free text still works.
  - Geoapify/OpenStreetMap attribution is shown with geocoded results, which the free plan requires.
  - Picked cities save place id, country and zone next to the coarse coordinates.
  - Logic is in `src/lib/cityGeocode.ts` and `src/lib/useCityLookup.ts`.
- **Tests.** `npx vitest run` runs `src/lib/cityGeocode.test.ts` with synthetic fixtures for NYC, Hong Kong, Tokyo, Seoul, London and Auckland. No network.

### Safe before or after the migration and the deploy

The web build can ship first:

- **Column writes.** The client sends the new columns only when its own `select('*')` profile row already contains them (`profileSupportsPlaceColumns`, `src/lib/profile.ts`). Before the migration the key is absent, so no update ever names a missing column. Values are re-checked against the DB CHECK shapes before writing, and a bad value becomes null instead of failing the save.
- **Old function.** If the deployed function is still the old one, `mode: "geocode"` returns 400. The picker switches to the built-in list for that session.
- **Function before migration.** If the function is deployed before the migration, the quota RPC is missing, so the function returns 503 and the picker uses the same fallback.

## Needs Micky's approval, in this order

1. **Check the Geoapify plan** in the Geoapify dashboard (see cost notes below). Confirm the daily credit limit and that current course-search usage leaves room.
2. **Apply the migration** to `golfme-dev`. Then:
   - Run the Supabase security and performance advisors.
   - Run role-simulated checks: `anon` gets `unauthenticated` from `consume_geocode_quota()`. `authenticated` cannot call `geocode_cache_get/put` or read `private.*`.
   - Check that a profile update with a valid place succeeds and an invalid place id is rejected.
3. **Deploy `course-search`.** `supabase functions deploy course-search`, with `verify_jwt` left on (the default; never `--no-verify-jwt`). The deploy must bundle `supabase/functions/_shared/`, which the CLI does automatically for relative imports.
   - Smoke test with a signed-in token: `{"mode":"geocode","query":"Tokyo"}` returns cities with 2-dp coordinates.
   - No auth returns 401. A 2-character Latin query returns 400.
   - Existing `search` and `nearby` modes still work.
4. **Ship the web build** (Vercel). iOS picks it up because it loads the live site. No App Store build is needed.
5. **Verify in preview or production.** Use two real accounts. Pick Tokyo, Seoul and Auckland, then confirm the profile row holds the place id, `jp`/`kr`/`nz`, the IANA zone, and 2-dp coordinates. Also check Hong Kong and Singapore (see open item below).

## Rollback

- **Client.** Revert the LocationPicker commit, or just leave it. With the function or migration missing it falls back to the old built-in-list behaviour by itself.
- **Edge Function.** Redeploy the previous `course-search` from `main`. Clients fall back automatically.
- **Migration.** Additive, so a rollback is only needed if something is badly wrong. Run it in one transaction:
  ```sql
  drop function if exists public.geocode_cache_put(text, jsonb);
  drop function if exists public.geocode_cache_get(text);
  drop function if exists public.consume_geocode_quota();
  drop table if exists private.geocode_rate_buckets;
  drop table if exists private.geocode_cache;
  alter table public.profiles
    drop column if exists distance_unit,
    drop column if exists playing_area_timezone,
    drop column if exists playing_area_country_code,
    drop column if exists playing_area_place_id;
  ```
  Dropping the columns loses saved place ids, zones and unit choices, but nothing else. Coordinates and labels are untouched. Roll back the function first, or it will return 503 and clients will fall back.

## Geoapify cost, quota and caching

**Pricing, from geoapify.com/pricing on 2026-10-20.** Verify this against Micky's own dashboard.

- The Free plan gives 3,000 credits per day and up to 5 requests per second.
- One Address Autocomplete request costs 1 credit. Course search (Places API) also costs 1 credit per request, from the same allowance.
- Limits are soft: Geoapify emails before blocking.
- The free plan requires Geoapify and OpenStreetMap attribution.
- The terms say nothing about caching geocoding results. The DB cache keeps only city-level results for 30 days.

**Expected volume.**

- One picker session is about 1 to 3 requests: debounce, at least 3 characters, an in-session memo, and the first failure stops further requests.
- At 300 location picks a day that's roughly 300 to 900 requests before cache hits, and common cities get cached quickly.

**Hard ceilings in `consume_geocode_quota()`.**

- **Per user:** 60 requests per hour and 200 per day.
- **Global:** 2,000 requests per day. This leaves at least 1,000 credits a day for course search on the Free plan.
- Denied requests are not counted, so one abusive account can use at most 200 of the global budget.
- Every request that reaches the quota check counts, including cache hits. That's conservative: real Geoapify spend is at most the counted number.
- To change a limit, edit the function and this doc together.

## Open items

- **City-states.** Hong Kong and Singapore with `type=city` haven't been verified live, because the brief allowed no real Geoapify calls. Geoapify may classify them as a country or state and filter them out. Both are in the built-in list, so they always resolve. If the live check shows they're missing, consider `type=locality` (cities, districts, counties and states; more results, more noise).
- **`place_id`.** It's used as the canonical id. It's returned by the live API (course search already stores it), but it isn't listed on the autocomplete docs page.
- **Device location.** Saves a place only when the fix is within 60 miles of a built-in region. Otherwise there's no place, zone or country, and Phase 3 should fall back to the device zone or the course's zone.
- **Privacy Policy.** It names Geoapify for course search only. City search also sends the typed city text to Geoapify, so a one-line copy update is suggested.
- **Founding Golfer.** A geocoded city near Midtown now has coordinates where free text had none, so it can qualify for the NYC Founding award. This is the intended zone rule, but it is a change.

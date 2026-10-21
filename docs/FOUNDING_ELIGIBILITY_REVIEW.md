# Founding Golfer eligibility review (global hosting Phase 2)

Status: **proposal only.** Nothing in this file has been implemented. Award behaviour is unchanged on every branch. Micky decides before any change (Phase 2 decisions, items 6 to 8).

## How the award works today (verified against the applied migrations)

Source: `supabase/migrations/20261006120000_add_founding_golfer_cohort.sql`, applied to production 2026-10-18.

- **Trigger.** `profiles_award_founding_golfer` is an `AFTER INSERT OR UPDATE OF has_onboarded, playing_area_lat, playing_area_lng` trigger on `public.profiles`. It fires only when the row is onboarded, has no number yet, and both coordinates are non-null.
- **Eligibility.** `private.award_founding_golfer()` (SECURITY DEFINER, not callable by clients) awards the next number only if all of these hold:
  - the email is confirmed;
  - `has_onboarded` is true;
  - `private.in_founding_zone(lat, lng)` is true: haversine distance of at most 30 miles from Midtown (40.7549, -73.9840), using the 2-dp coordinates the coarsening trigger already stored;
  - the account has no active `admin`, `test`, `app_reviewer`, `seeded` or `bot` role;
  - the cohort `nyc_2026` is open and below its cap of 250;
  - the account has never had a ledger row (row-locked, so concurrent saves can't double-award).
- **What it never reads.** It never reads `area_label` or any other text. The Phase 2 columns (`playing_area_place_id`, `_country_code`, `_timezone`, `distance_unit`) are not in the trigger's column list and are not read by the award function.
- **Permanence.** Awards are permanent. Moving away later doesn't revoke them. Only an admin can revoke, and a revoked number is never reused or re-awarded.
- **Where the zone is shown.** The client mirror `isInFoundingZone()` (`src/lib/founder.ts`) only decides whether onboarding shows the "NYC Founding Golfer spots remaining" line. The server alone awards.

## Which location choices carry coordinates

Only a location with coordinates can ever be awarded.

| How the golfer sets a location | Before Phase 2 | With Phase 2 (this branch) |
|---|---|---|
| Built-in list pick, e.g. "New York, NY" | Coordinates (centroid 40.71, -74.01, 3.4 mi from Midtown). **Could qualify.** | Same, plus place id `golfme:nyc` |
| "Use My Current Location" | Coarsened device fix (2 dp). Qualifies if inside the zone. | Same |
| Typed free text, e.g. "Brooklyn" | **No coordinates. Could never qualify.** | Same, unless the golfer picks a search result instead |
| Search result for an NYC-area city | Not possible | **Coordinates of that city's centroid. Qualifies if inside 30 mi.** |

Example search results (city centroid to Midtown):

| City | Distance | Inside the 30 mi zone? |
|---|---|---|
| Jersey City | 5.3 mi | Yes |
| Brooklyn | 7.5 mi | Yes |
| Newark | 9.8 mi | Yes |
| Queens | 10.3 mi | Yes |
| Yonkers | 12.9 mi | Yes |
| Staten Island | 14.9 mi | Yes |
| Paterson | 15.0 mi | Yes |
| Hempstead | 19.3 mi | Yes |
| White Plains | 22.3 mi | Yes |
| Morristown | 26.1 mi | Yes |
| Huntington NY | 30.0 mi | Boundary: depends on the exact 2-dp centroid |
| New Brunswick | 30.5 mi | No |
| Stamford CT | 30.9 mi | No |

### Searching vs. saving

- **Searching or browsing a city never writes the profile** (item 5). It doesn't matter where the search happens: "Playing somewhere else?", Nearby Courses, or the round list. This is proven by `src/lib/globalHosting.matrix.test.ts`.
- **The deliberate actions that write a location** are onboarding (`ProfileSetup`), Match Preferences → Change playing area, and "Set as my default" after a travel search (`FindRoundModal`).
- **So searching NYC alone can't award anything** (item 7 holds).

### Later edits

A location can be edited at any time. The award trigger fires on any change to `playing_area_lat/lng`. So an already-onboarded golfer anywhere in the world can switch their home area to an NYC-area city, or tap "Set as my default" after browsing NYC, and get the next number on that save if spots remain. **This is true today, before Phase 2,** through the built-in "New York, NY" pick.

## Finding: Phase 2 doesn't widen what an abuser can do, but more people will qualify

- **Nothing new for an abuser.** Anyone could already pick "New York, NY" from the built-in list and qualify, with no proof of residence. Geocoding adds more in-zone cities to choose from, not a new way in. The guards (confirmed email, role exclusions, one award per account, cap, admin revoke) are unchanged.
- **More genuine NYC-area golfers will qualify.** Someone who used to type "Brooklyn" or "Hoboken" as free text got no coordinates and so no number. They now pick the search result and qualify. That's arguably the intended zone rule working, but it does change who gets awarded.
- **Minimal guard, only if Micky wants to freeze the current population before deciding.** Don't deploy the web build (or the `course-search` geocode mode) until the decision is made. Applying the migration alone changes nothing, because no client writes the new columns until the new web build ships. A server-side guard is possible: award only when `playing_area_place_id` is null or `golfme:nyc`. But it would mean editing `private.award_founding_golfer`, which is itself a change to award behaviour. **Not recommended and not prepared.**

## Proposals (choose one, or combine)

### A. Keep as-is: declared home area, any time

- **Rule.** Unchanged.
- **Pros.**
  - Simple, with no new code.
  - Most privacy-respecting: no extra location data.
  - Inclusive for golfers who fix a wrong area later.
- **Cons.**
  - Self-declared, so a non-NYC golfer can claim a scarce number by picking NYC.
  - Existing remote accounts can "move" to NYC at any time while spots remain.
- **Abuse analysis.**
  - **Cost to abuse:** trivial (one tap).
  - **Scale:** limited by one award per account, a confirmed email per account, and the 250 cap.
  - **Detection:** admins can see the area and the award time and can revoke.
  - **Risk:** acceptable while the cohort fills slowly. Rises if Founding becomes visibly valuable.

### B. Award only at or near onboarding (recommended)

- **Rule.** Award only on the save that first sets `has_onboarded = true`, or within a short window after it (for example 14 days, so a golfer can correct a wrong area). Location edits after the window never award. Implemented by reading `profiles.created_at` (or the onboarding time) inside `private.award_founding_golfer`.
- **Pros.**
  - Closes the "existing remote account moves to NYC" path.
  - No new data collected.
  - Still a declared home area, which matches how the rest of GolfMe treats location.
- **Cons.**
  - A genuine golfer who moves to NYC after the window is not eligible.
  - Changes the award function (needs a reviewed migration and Micky's sign-off).
  - The backfill semantics for future cohorts must state the window.
- **Abuse analysis.**
  - **What remains:** a new account that declares NYC at signup still works. Each one needs a new confirmed email, and admin revoke still applies.
  - **What's removed:** silent conversion of the existing global user base.

### C. Optional one-time coarse device-location confirmation

- **Rule.** Keep the declared area. The badge is awarded only once the golfer has, at least once, used "Use My Current Location" and the coarsened (2 dp) fix fell inside the zone. Store only a timestamp flag such as `founding_location_confirmed_at`, never the fix itself.
- **Pros.**
  - Raises the bar for casual remote claims.
  - Still coarse.
  - Opt-in: a golfer can decline and simply not get the badge.
- **Cons.**
  - **Not verifiable.** The browser or WebView reports the fix, so it is client-attested and can be spoofed with devtools or a direct API call. It only adds friction.
  - Asks for location permission for a marketing badge, which is a privacy cost and a possible App Review question.
  - Excludes golfers who deny location.
  - Needs a new column, a client flow and award-function changes.
- **Abuse analysis.**
  - **Casual claims:** blocked, because they need a device in the zone.
  - **Motivated abusers:** still get through by spoofing.
  - **Risk to genuine users:** may wrongly exclude legitimate golfers whose device fix is poor or who deny permission.

### Not proposed

- **IP geolocation.** Imprecise, privacy-invasive, and wrong for VPN and mobile-carrier users.
- **Address or ID proof.** Disproportionate for a badge.

### Recommendation

Use B (onboarding-time award with a short correction window). If remote claims are seen in practice, add C as an optional extra signal. Until Micky decides, keep A unchanged. If the larger qualifying population matters before the decision, hold the Phase 2 web deploy.

## Item 6: NYC messaging only where NYC is relevant

- **Onboarding.** The spots line already shows only when the chosen area is inside the zone (`FoundingSpotsNote enabled={isInFoundingZone(playingAreaCoords)}`). So a Tokyo or London pick shows nothing, and an NYC-area pick shows it.
- **Copy.** The strings say "NYC Founding Golfer" in every language (`founding.spotsRemaining` / `founding.spotsClaimed`).
- **Open point for Micky: the landing hero.** The public landing hero (`Welcome.tsx`) shows the NYC spots line to every visitor, wherever they are. It is labelled NYC and NYC is the launch market, so it reads as launch marketing, not a promise to non-NYC visitors. Whether it should stay global is a marketing call. Not changed.

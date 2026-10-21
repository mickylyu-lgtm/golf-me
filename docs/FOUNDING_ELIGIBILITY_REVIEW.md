# Founding Golfer eligibility review (global hosting Phase 2)

Status: **Micky chose B on 2026-10-21** (award at onboarding, 14-day correction window with automatic award, manual admin review after that). Implemented on branch `global-hosting` as migration `20261022120000_founding_onboarding_window.sql`, **not applied**. Production still runs the rules in "How the award works today" until Micky approves applying it (`docs/GLOBAL_HOSTING_ROLLOUT.md`, step 2a). The analysis and proposals below are kept as the decision record.

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

## Decision B, as implemented (`20261022120000`, not applied)

### Rules

1. **Qualifying onboarding is unchanged.** The save that first sets `has_onboarded = true` calls `private.award_founding_golfer()` exactly as before: confirmed email, saved coordinates within 30 mi of Midtown, no excluded role, cohort open, never held a number.
2. **Correction window: 14 days from onboarding, automatic.** If a later save moves the saved coordinates into the zone within 14 days of onboarding, the server awards automatically through the same function. Typical cases: a wrong city at signup, or a typed free-text area (no coordinates) later replaced by a search result. Every such award is also written to `public.founding_eligibility_reviews` with status `auto_awarded` and its flags, so an admin can review it and, if needed, revoke it with the existing `admin_revoke_founding_award()`.
3. **Outside the window: never automatic.** A move into the zone creates one pending review per golfer (later moves refresh it). On the admin dashboard an admin either approves, which awards through the same function and only if the golfer is eligible at that moment (saved area in the zone, confirmed email, no exclusion, never held a number, cohort open), or dismisses. A dismissed golfer who later moves into the zone again gets a new pending review.
4. **Only saved coordinates count.** The trigger still fires only on `has_onboarded` / `playing_area_lat` / `playing_area_lng`. A save whose coordinates didn't actually change (label, bio, place id, country, time zone, unit, or re-sending the same area) makes **0 award calls and creates no review**. City searches never write the profile.

### Thresholds (constants in `private.founding_on_location_change`)

| Check | Value | Effect |
|---|---|---|
| Window | 14 days from `profiles.onboarded_at` | Inside: automatic. Outside: manual review. |
| Move cap | 3 coordinate changes after onboarding | Changes 1 to 3 that land in the zone auto-award. A 4th or later change that lands in the zone goes to manual review (`correction_over_cap`, flag `move_cap_exceeded`). |
| `rapid_moves` flag | 3 or more coordinate changes within 24 hours | Recorded only. |
| `far_jump` flag | Previous saved area more than 500 mi from Midtown | Recorded only, because a wrong-city pick is exactly what the window is for. |
| `no_previous_coordinates` flag | Previous area was free text (no coordinates) | Recorded only. |

Only the move cap blocks an automatic award. The flags make suspicious awards easy to spot on the dashboard. Changing any value needs a new migration.

Why this is enough: inside the window, abusing the correction path is no easier than declaring NYC at signup, which a new account can always do (one confirmed email per account, one award per account, cap 250, admin revoke). The real risk, existing worldwide accounts "moving" to NYC later, now always needs an admin.

### Transition rule for existing accounts

- `profiles.onboarded_at` is new. It is stamped by the server on the first `has_onboarded` transition, and clients can't write it.
- Accounts that onboarded before the migration keep `onboarded_at = NULL`. Their window is measured from `profiles.created_at` (signup). Signup always comes before onboarding, so this can only make the window shorter, never longer.
- An account that signed up **less than 14 days before the migration is applied** keeps the rest of its window. An older account goes to manual review.
- Applying the migration awards nobody, revokes nothing and updates no row. All existing numbers stay exactly as they are.
- Edge case: a pre-migration account that an admin resets with the test tool (`admin_reset_test_account_onboarding`) is treated as onboarding again, as it was before this migration. Accounts onboarded after the migration keep their first `onboarded_at` through a reset.

### What stays the same

The cap of 250, the append-only ledger and its guards, numbers never reused (a revoked number stays consumed and that account is never re-awarded or put up for review), the exclusion roles, the confirmed-email rule, the zone, and a failing check never breaking a profile save.

### Proof (PGlite, `scripts/migration-checks/founding-onboarding-window.mjs`, 22/22 pass)

Onboarding in the zone awards. A Tokyo → NYC correction within 14 days awards (flag `far_jump`). Free text → Brooklyn within 14 days awards. A correction after 14 days creates a review and no award. A client can't rewrite `onboarded_at`. A pre-migration account 30 days old goes to review and one 5 days old auto-awards. A 4th move goes to review. Place-only, label, bio and same-coordinate saves make 0 award calls. Excluded and unconfirmed accounts get no award and no review. A revoked number isn't reused or re-awarded. Non-admins can't read or write reviews or call the RPCs, and nobody can read the move log. Approve awards the next number, and a repeat approve fails. Approve refuses when the golfer left the zone; dismiss works. The cap of 250 closes the cohort, after which nothing more is awarded. Rollback keeps the ledger identical.

### Admin UI

The admin dashboard (`/admin/dashboard`) has a "Founding Golfer reviews" section: pending reviews with from/to areas (label + miles from Midtown, never coordinates), the current area and whether it's in the zone, flags, moves counted, plus approve/dismiss buttons and a list of recent auto-awarded corrections. It shows "Unavailable" until the migration is applied.

## Item 6: NYC messaging only where NYC is relevant

- **Onboarding.** The spots line already shows only when the chosen area is inside the zone (`FoundingSpotsNote enabled={isInFoundingZone(playingAreaCoords)}`). So a Tokyo or London pick shows nothing, and an NYC-area pick shows it.
- **Copy.** The strings say "NYC Founding Golfer" in every language (`founding.spotsRemaining` / `founding.spotsClaimed`).
- **Landing page (decided 2026-10-21, on the branch).** The hero no longer shows the NYC spots line to every visitor. It now says rounds can be hosted anywhere in the world. The NYC offer lives in its own clearly NYC-labelled section ("Golfing in the New York area?"), with the live count from `get_founding_cohort_status()`. The whole section is hidden while loading, on error, before the cohort opens or after an early close, so a stale or guessed number never shows. All 6 locales.
- **In the app** the line appears only in onboarding, once the chosen area is inside the zone (demo accounts never fetch it). Nowhere else in the app shows the offer.

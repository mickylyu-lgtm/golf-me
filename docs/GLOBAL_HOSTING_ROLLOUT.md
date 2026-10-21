# Global hosting Phase 2: rollout readiness (item 10)

**Status (2026-10-21):** prepared on branch `global-hosting`. Nothing has been applied, deployed or pushed. `golfme-dev` is the **live production database**. Every step below that touches it, a Supabase project, Geoapify, Vercel or the App Store needs Micky's explicit approval.

**Legend.**

- **[done]** done and verified on the branch, with no production access.
- **[Micky]** needs Micky: a dashboard, credentials or approval.
- **[staging]** needs the isolated environment in section d.

---

## a. Geoapify: verify in the dashboard before activation [Micky]

Figures from Geoapify's public pages, read 2026-10-20/21. The dashboard is the source of truth.

| Fact | Source | Value |
|---|---|---|
| Free plan allowance | geoapify.com/pricing | 3,000 credits/day, "up to 5 requests/second"; "In general, we do not throttle when you go over the limits" |
| Address Autocomplete (city search) | geoapify.com/pricing-details | "1 Address Autocomplete API request costs 1 credit" |
| Places API (existing course search) | pricing-details | 1 credit per request of up to 20 places; +1 credit per further 20. course-search asks for at most 20 (`limit ≤ 20`) → 1 credit |
| Place Details (new `mode: "place"`) | pricing-details + apidocs place-details | "1 credit plus requested features"; `details.names` "+1 credit" → **2 credits per new city** |
| Caching or storing results | geoapify.com/term-and-conditions, pricing-details | **Not addressed** in the terms. Free plan: "Geoapify attribution is mandatory" and OpenStreetMap attribution always (already shown under city results). Names are OpenStreetMap data (ODbL); a small per-city name cache with attribution is the normal pattern, but this is not legal advice |

**Checklist for Micky** (Geoapify dashboard → Projects → API keys / Usage):

1. **Plan.** Which plan the `GEOAPIFY_API_KEY` used by Supabase belongs to: Free, or a paid tier and its daily credits.
2. **Recent usage.** Daily credits for the last 30 days, and the peak day, from course search alone. Phase 2 shares the same key.
3. **Monthly totals.** Whether any monthly cap or overage billing applies to the plan.
4. **Per-key restrictions.** Any referrer or IP limits on the key. The Edge Function calls from Supabase's servers, so referrer limits would break it.
5. **Costs.** Confirm that Address Autocomplete and Place Details show as 1 and 2 credits on the usage page after the staging smoke test (section f). Don't assume.
6. **Separate key for staging.** Optionally create a second free-plan key for the staging project, so tests never spend production credits.

**Budget with the server-side ceilings.**

`consume_geocode_quota` counts **credits**:

| Limit | Value |
|---|---|
| Per user, per hour | 60 credits |
| Per user, per day | 200 credits |
| Global, per day | 2,000 credits, a soft ceiling: concurrent callers can overshoot by about 2 credits each |

So city search can't take more than about 2,000 of a 3,000/day Free plan. At least about 1,000/day are always left for course search.

**Expected spend.**

- A picker session costs about 1 to 3 autocomplete credits, plus 2 credits the first time anyone ever picks a given city.
- At 300 picks/day that's about 300 to 900 credits/day before cache hits, and it falls as the caches warm up.

**[done] Code-side discipline** (tested):

- Debounce of 350 ms, and a minimum of 3 characters (2 for CJK).
- In-session memo, a 30-day shared cache, and a per-isolate memo.
- The first failure stops further calls in that session.
- Viewers never trigger provider calls for other people's cities.

## b. Backup: confirm a recent restorable backup [Micky]

Supabase docs (supabase.com/docs/guides/platform/backups, read 2026-10-21):

- Daily backups exist **only on Pro, Team and Enterprise** (7, 14 and up to 30 days of retention).
- **Free projects have no automatic backups.** Supabase recommends a regular `supabase db dump`.
- PITR is a paid add-on and needs at least Small compute. Enabling it replaces daily backups.
- A restore makes the project **inaccessible for its duration**.
- **Storage objects are not in backups.** Caddie videos and avatars are not restored by a DB restore.

**Checklist for Micky** (Supabase dashboard → `golfme-dev`):

1. **Plan tier.** Settings → Billing.
2. **If Pro or higher:**
   - Database → Backups: confirm a daily backup from the last 24 h with status Completed.
   - Note whether PITR is enabled, and the earliest restore point.
3. **If Free (no automatic backup), or as a belt-and-braces step anyway:** take a logical dump right before the migration, from Micky's Mac with the DB password (never pasted into chat):
   ```sh
   supabase db dump --db-url "$PROD_DB_URL" -f golfme-pre-phase2-schema.sql
   supabase db dump --db-url "$PROD_DB_URL" --data-only -f golfme-pre-phase2-data.sql
   ```
   Keep both files off-repo (they contain user data). Check that both are non-empty and that `grep -c "CREATE TABLE"` looks sane.
4. **Write down the time** the migration is applied. A PITR restore would target just before it.

**Recovery steps, in order of preference:**

1. **Targeted rollback (section c).** No downtime, and loses only Phase 2 data. Almost always the right answer, because the migration is additive.
2. **Daily backup or PITR restore** (Database → Backups or Point in Time → Restore).
   - It loses **every** write since that point: rounds, messages, sign-ups.
   - The project is down for the duration.
   - Announce it first, and re-apply anything lost by hand if possible.
3. **Free plan: restore from the dump.** Use a new project or an emptied schema and `psql -f`. This is a last resort and needs a careful replay order and auth data; get the architect involved.

## c. Migration review: `20261021120000_profiles_playing_area_place_and_geocode.sql` [done]

The checks are automated in two places:

- `src/lib/globalHosting.matrix.test.ts`, which does static checks.
- `scripts/migration-checks/global-hosting-phase2.mjs`, which runs the real SQL in PGlite with Supabase-style roles, default privileges and RLS. 17/17 checks pass.

| Topic | Finding |
|---|---|
| Additive only | Yes. It adds 4 nullable columns, 4 CHECKs and 1 BEFORE UPDATE trigger on `profiles`. It adds the new tables `private.geocode_cache`, `private.geocode_rate_buckets` and `public.geo_places`, plus 4 functions. There is no DROP, ALTER COLUMN, RENAME, UPDATE or DELETE of existing data, and no backfill. It touches no founding, award, Reputation or `user_roles` object (test-enforced). |
| Defaults | The new columns have no default. ADD COLUMN of a nullable column with no default is **metadata-only** in Postgres 11+, so there's no table rewrite. |
| Locks | `ALTER TABLE profiles` takes an ACCESS EXCLUSIVE lock for the transaction. The 4 CHECKs are validated by scanning `profiles` under that lock, which is trivially true because every value is null. That's milliseconds at current size (hundreds of rows). `CREATE TRIGGER` takes SHARE ROW EXCLUSIVE. Risk: if a long transaction holds a lock on `profiles`, the ALTER queues and blocks every later profile read and write behind it. **Mitigation: start the apply with `set local lock_timeout = '5s';`** (see h), so it fails fast and can be retried. |
| Existing data | Untouched. Existing rows read null for the new columns. Labels that exactly match a built-in city are localized for display only, without being rewritten. |
| New trigger `profiles_clear_stale_place` | Clears only the 3 place columns. It fires only when the label **and** the coordinates change while the place id is not part of the update, which is the signature of a pre-Phase-2 client. It never changes coordinates, labels, trust or founding columns. PGlite verified the cases: an old-client move clears it; new-client picks, relabels, device fixes and unrelated updates keep it. |
| Founding | `profiles_award_founding_golfer` fires on `has_onboarded/lat/lng` only. PGlite verified that a place-only update fires 0 award calls and a lat change still fires (unchanged). See `docs/FOUNDING_ELIGIBILITY_REVIEW.md`. |
| RLS / grants | **Private tables:** RLS on, no policies, all privileges revoked from public, anon and authenticated. **`public.geo_places`:** RLS on; a SELECT policy and grant for `authenticated` only; anon gets nothing; writes are service_role only. **`consume_geocode_quota(int)`:** authenticated only, identity from `auth.uid()`, cost 1 to 5. **`geocode_cache_get/put`:** service_role only. **Profile columns:** covered by the existing `profiles_update_own` and `profiles_select_authenticated` policies, and PGlite verified user A can't write user B. |
| Supabase advisors | To run after staging apply [staging]: security and performance advisors. Expected: no new warnings. Every function has `set search_path = ''` and every table has RLS. |
| Migration history | Production versions don't match file names (LAUNCH_CHECKLIST: applied via MCP/SQL editor, matched by name). **Never `supabase db push`.** Apply via the SQL editor in one transaction, as with Founding. |

**Rollback SQL** (one transaction; roll back `course-search` first, or it returns 503 and clients fall back by themselves):

```sql
begin;
set local lock_timeout = '5s';
drop trigger if exists profiles_clear_stale_place on public.profiles;
drop function if exists public.profiles_clear_stale_place();
drop table if exists public.geo_places;
drop function if exists public.geocode_cache_put(text, jsonb);
drop function if exists public.geocode_cache_get(text);
drop function if exists public.consume_geocode_quota(integer);
drop table if exists private.geocode_rate_buckets;
drop table if exists private.geocode_cache;
alter table public.profiles
  drop column if exists distance_unit,
  drop column if exists playing_area_timezone,
  drop column if exists playing_area_country_code,
  drop column if exists playing_area_place_id;
commit;
```

**Effect of the rollback.**

- Saved place ids, zones, unit choices and localized names are lost.
- Coordinates and labels are untouched. Labels are English, so display is unaffected apart from localization.
- PGlite verified it runs cleanly and keeps every profile row.

## c2. Migration review: `20261022120000_founding_onboarding_window.sql` (Founding decision B) [done, not applied]

What it does, how it decides and the thresholds: `docs/FOUNDING_ELIGIBILITY_REVIEW.md` ("Decision B, as implemented"). In short: the award at onboarding is unchanged; a move of the saved coordinates into the zone within 14 days of onboarding auto-awards; after that it opens an admin review.

| Check | Result |
|---|---|
| Independent of Phase 2 | It neither reads nor needs the place columns. It can be applied before or after `20261021120000`. **Apply it before the Phase 2 web deploy (step 4)**, because Phase 2 lets more people pick an NYC-area city later. |
| Changes on apply | None to data. It adds `profiles.onboarded_at` (nullable, no default, metadata-only), one BEFORE trigger, `private.founding_location_moves`, `public.founding_eligibility_reviews` (RLS on, admin-only SELECT, no client writes), 2 private functions and 3 admin RPCs. It replaces the body of `award_founding_golfer_on_profile_change()`; the trigger's column list and WHEN clause are unchanged. No UPDATE of any row (so no `updated_at` bump). |
| Untouched | `private.award_founding_golfer()`, `private.in_founding_zone()`, cap 250, the ledger and its guards, numbers never reused, exclusion roles, confirmed-email rule. Existing awards, the counter and every profile row are unchanged (PGlite-verified). |
| PGlite | `scripts/migration-checks/founding-onboarding-window.mjs` runs the real `20261006120000`, a stand-in for `20261006120100`, the real `20261021120000`, then this file: **22/22 pass** (2026-10-21). |
| Locks | `ALTER TABLE profiles ADD COLUMN` and `CREATE TRIGGER` take a brief ACCESS EXCLUSIVE / SHARE ROW EXCLUSIVE lock on `profiles`. Use `set local lock_timeout = '5s'`. |
| Admin access | The RPCs check `private.has_role(auth.uid(), 'admin')`, so they work from the app (admin dashboard section, ships with the web deploy), not from the SQL editor (no `auth.uid()` there). Before the web deploy, read `public.founding_eligibility_reviews` directly in the SQL editor. |

**Rollback SQL** (one transaction). It restores the original trigger body verbatim, so any-time awards resume. Awards made under the new rules stay in the ledger (never silently revoked); review records are dropped.

```sql
begin;
set local lock_timeout = '5s';
create or replace function public.award_founding_golfer_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.award_founding_golfer(new.id);
  exception when others then
    raise warning 'award_founding_golfer failed for %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end;
$$;
revoke execute on function public.award_founding_golfer_on_profile_change() from public, anon, authenticated;
drop function if exists public.admin_dismiss_founding_review(bigint, text);
drop function if exists public.admin_approve_founding_review(bigint, text);
drop function if exists public.admin_list_founding_reviews(text, integer);
drop function if exists private.founding_on_location_change(uuid, boolean, boolean, double precision, double precision, text);
drop function if exists private.founding_zone_distance_mi(double precision, double precision);
drop table if exists public.founding_eligibility_reviews;
drop table if exists private.founding_location_moves;
drop trigger if exists profiles_stamp_onboarded_at on public.profiles;
drop function if exists public.profiles_stamp_onboarded_at();
alter table public.profiles drop column if exists onboarded_at;
commit;
```

PGlite verified that this runs cleanly and leaves the ledger identical. If the review rows matter, export `public.founding_eligibility_reviews` first.

## d. Isolated non-production environment [Micky to choose; nothing created]

**Read-only check on this machine (2026-10-21):** none of Docker, the Supabase CLI, Deno or psql is installed. `npx supabase` isn't cached either. The local PGlite harness above is the only thing that ran here.

| Option | Cost | Fidelity | Notes |
|---|---|---|---|
| 1. Local Supabase (`supabase start`, Docker) | Free | High for SQL, RLS, functions (`supabase functions serve`) | Needs Docker and the CLI on Micky's Mac. Replaying all 84 repo migrations from zero hasn't been proven to work, so seed from a schema-only dump instead (see recommendation). |
| 2. Supabase Branching | **May cost money** (branch compute is billed; pricing not stated on the docs page) → **billing approval** | High | Dashboard branches build from production's migration history; GitHub branches replay repo migrations. Both are affected by the history mismatch. |
| 3. Separate free Supabase project (e.g. `golfme-staging`) | Free, if the org still has a free-project slot (check the dashboard) | High: the real platform, Edge runtime, JWT and RLS | Needs its own Geoapify key secret (a secret in a non-prod project, but still Micky's call). No production data. |

**Recommendation: option 3.**

1. Micky creates a free `golfme-staging` project.
2. On Micky's Mac, `supabase db dump --db-url "$PROD_DB_URL" --schema-only` from production, and apply it to staging. That gives an exact schema copy with no user data.
3. Apply this migration in staging.
4. Deploy `course-search` to staging with a staging-only Geoapify key.
5. Point a local `npm run dev` at staging, setting `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Micky's own `.env.local`, and run section f with two staging accounts.

Option 1 is equally good if Docker is preferred.

## e. Released iOS app compatibility [done: analysis; Micky: device check]

The App Store app loads `https://golfme.app` live (`capacitor.config.ts` `server.url`). It bundles no app JS, and there's no service worker, so iOS always runs whatever web build is deployed. The one exception is a WebView that was resumed from the background without reloading. That keeps running the previous bundle until it reloads.

| State | Released iOS app / any client | Why safe |
|---|---|---|
| Migration applied, old function, old web | Unchanged | Old web never sends the new columns. They're nullable. `select("*")` returns extra keys, which old code ignores. The award trigger is unchanged. |
| New function deployed, old web | Unchanged | Old web never sends `mode: geocode` or `place`. The `search` and `nearby` modes are byte-for-byte the same code path. |
| New web, migration not applied | City search falls back to the 12 built-in cities | Quota RPC missing → 503 → built-in list. `geo_places` read error → labels show `area_label`. The place columns are never sent (`profileSupportsPlaceColumns`). |
| New web, old function | Same fallback | `mode: geocode` or `place` → 400 → fallback. |
| Everything new, but a resumed WebView on the old bundle | Works | That old bundle saves label and coordinates without a place. The new `profiles_clear_stale_place` trigger drops the stale place so labels stay right. Reloading picks up the new bundle. |

**No App Store build is needed.**

**[Micky] Device check.**

1. **Before the migration:** on the released iOS app, open Profile, Match Preferences → Change area, Find a Round → Playing somewhere else, Nearby Courses, a DM, and a Caddie result. Take screenshots as the baseline.
2. **Repeat after each deploy step in h.**
3. **Background test:** leave the app backgrounded across the web deploy, resume it, change the area once on the old bundle, reload, and confirm the label is still right.

## f/g. Test matrix: NYC, Hong Kong, Tokyo, Seoul, London, Auckland

### Automated now (synthetic, no network) [done]

`npx vitest run`: 71 tests. PGlite: 17 checks.

| Area | Covered by |
|---|---|
| Distance from the **searched** city (~10 km round is near; a NYC round from a Tokyo search is >2,000 mi, not the stale 3 mi) | `globalHosting.matrix.test.ts` "10f" (6 cities) |
| Localized labels, 6 cities × 6 languages, English fallback (sparse Auckland, London without zh-Hant), city-states, US "City, ST" | `placeNames.test.ts` |
| Built-in regions localized offline; legacy label match; free text never rewritten | `placeNames.test.ts` |
| Selection: geocoded result → 2-dp coords + place id, country and zone; dedupe against built-ins; English canonical label | `cityGeocode.test.ts`, `placeNames.test.ts` |
| Cache: deterministic hashed key; in-session memo; place-names DTO re-validated; DB cache service_role only | `cityGeocode.test.ts`, PGlite |
| Quota: 60/h, 200/day, 2,000/day global, credit-weighted, denied not counted, anon denied | PGlite (behaviour), matrix (constants) |
| Offline/error fallback: built-ins for NYC, HK and London; free text for Tokyo, Seoul and Auckland; first 429 stops further calls | matrix "10f" |
| Item 5: browsing never writes the profile (pure functions plus a source audit of every profile-location writer) | matrix "item 5" |
| Geo-privacy: every picked or URL coordinate is ≤ 2 dp; names DTO carries no coordinates; cache key never contains the query | matrix "10g", `placeNames.test.ts`, `cityGeocode.test.ts` |
| Cross-user: user A can't write B's place (RLS); label lookup only reads the area's own place id; `geo_places` holds no user id | PGlite, `placeNames.test.ts` |
| Server-side authorization: the quota keys on `auth.uid()`, never a parameter; cache writes are service_role; the Edge Function never touches `profiles` | PGlite, matrix |

### Manual staging checklist [staging]

Use two staging accounts, A and B, with different app languages (for example A = 日本語 and B = English).

**1. Function smoke** (signed-in curl or app):

- `{"mode":"geocode","query":"Tokyo"}` returns 2-dp coordinates, `jp` and `Asia/Tokyo`.
- With no auth it returns 401.
- `"To"` (2 Latin characters) returns 400.
- `"東京"` is OK.
- `search` and `nearby` are unchanged.

**2. Per city** (NYC, Hong Kong, Tokyo, Seoul, London, Auckland), as A:

- [ ] Search in Match Preferences → pick the city → Save.
- [ ] Profile row: place id, country (`us`/`hk`/`jp`/`kr`/`gb`/`nz`), IANA zone, 2-dp coordinates, **English** `area_label`.
- [ ] `geo_places` has a row with `names.en` and the other languages.
- [ ] Geoapify usage rose by 1 per typed query and 2 for the first pick of the city only. A second pick of the same city costs 0 credits for names.
- [ ] As B (English): A's card and profile show the English label. Switch B to 한국어 / 中文 (繁體) / Español and the label follows B's language.
- [ ] Find a Round → Playing somewhere else → the city → Browse rounds. Distances are measured from the searched city: create a staging round near it to check. **The profile row is unchanged** (check updated_at too).
- [ ] Nearby Courses with the searched city leaves the profile unchanged.

**3. Hong Kong and Singapore with `type=city` live** (open item):

- Do they appear?
- If not, note it. The built-ins cover them.

**4. Quota:**

- Spend 60 credits in an hour as A. The next request is 429, the picker shows the built-in list, and B is unaffected.
- Set the global count near 2,000 via SQL in staging. Then everyone gets 429 and course search still works.

**5. Offline:**

- Airplane mode in the picker shows the built-in list and free text, with no errors.
- Labels show the stored English.

**6. Pre-migration web on staging:**

- Deploy the web against staging before applying the migration and confirm the fallbacks.
- Apply the migration and confirm the features turn on with no reload issues.

**7. Old-client move:**

- Use a build from `main` against staging after A picked Tokyo, and move A to London.
- `playing_area_place_id` is cleared, and B sees "London".

**8. Founding (staging cohort, with `20261022120000` applied):**

- Search NYC without saving → no award, no review row.
- Onboard with Brooklyn (search result) on a fresh confirmed account → awarded, the same as picking "New York, NY" today.
- Free-text "Brooklyn" at onboarding → no award. Then pick the Brooklyn search result within 14 days → awarded, plus an `auto_awarded` review row flagged `no_previous_coordinates`.
- Onboard with Tokyo, then save New York → awarded, flagged `far_jump`.
- An account older than 14 days moves to New York → no award, one pending review on the admin dashboard; approve → next number; dismiss on another → closed.
- The record matches `docs/FOUNDING_ELIGIBILITY_REVIEW.md`.

**9. Advisors:** run the security and performance advisors on staging.

## h. Stepwise deploy and rollback plan (for approval) [Micky]

Each step needs its own OK. Stop on any failure. Every step has its own rollback.

| # | Step | Verify | Rollback |
|---|---|---|---|
| 0 | Founding decision B and the NYC copy are decided (2026-10-21) and implemented on the branch; Micky reviews the thresholds. Complete a and b. Run the staging matrix (d, f). | All boxes ticked | — |
| 1 | `git push origin global-hosting` (branch only; approved in the decisions file, but this session didn't push) | Remote hash matches local | Delete the remote branch |
| 2a | Apply the Founding migration `20261022120000` to `golfme-dev` in the SQL editor the same way (`begin; set local lock_timeout = '5s';` + file + `commit;`). Independent of step 2; do it first or right after, but before step 4. | Advisors are clean. `select count(*) from public.founding_golfer_awards` and `founding_cohort_state.next_number` are unchanged. Role-simulated SQL: authenticated non-admin reads 0 rows from `founding_eligibility_reviews`, can't insert/update it, can't read `private.founding_location_moves`; anon is denied. | Rollback SQL (c2) |
| 2 | Apply the migration to `golfme-dev` in the SQL editor: `begin; set local lock_timeout = '5s';` + the file contents + `commit;`. Then record the version name the same way as the Founding migrations. | Advisors are clean. Role-simulated SQL: anon → permission denied on `consume_geocode_quota`; authenticated can't read `private.*` or write `geo_places`. A valid place update works and an invalid one is rejected. The **released iOS app** is unchanged (e). | Rollback SQL (c) |
| 3 | Set the `GEOAPIFY_API_KEY` secret if a new key was chosen (otherwise none), then `supabase functions deploy course-search` from Micky's Mac, keeping verify_jwt on. Never `--no-verify-jwt`. | Smoke test (f.1) against production with Micky's own account, including `mode: "place"` once. Geoapify usage +1 and +2. `search`/`nearby` unchanged. | Redeploy `course-search` from `main` (clients fall back by themselves) |
| 4 | Merge `global-hosting` → `main` and deploy to Vercel production | golfme.app: pick a city in each test language. Two real accounts see each other's label in their own language. The iOS app picks it up on reload. | Vercel "Promote" the previous deployment (instant), or revert the merge |
| 5 | Watch for 48 h: Geoapify daily usage under budget, the `geocode_rate_buckets` sum per day, Edge Function 4xx/5xx, any Founding awards for searched NYC-area cities, and the pending / auto-awarded Founding reviews on the admin dashboard | Numbers in DEVELOPMENT_STATUS | Steps 4 → 3 → 2 → 2a rollbacks, in that order (2a only if the Founding rules themselves are the problem) |

Privacy Policy one-liner (city text is sent to Geoapify) ships with step 4 if Micky approves the copy.

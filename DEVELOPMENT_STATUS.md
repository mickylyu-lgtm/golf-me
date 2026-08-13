# GolfMe — Development Status

> Read this file first in any new session (laptop or claude.ai/code on mobile) before making changes. Update it in the same commit as any milestone — new feature, schema change, or architectural decision — so the next session (possibly on another device) has zero context loss.

Last updated: 2026-08-13

## Current phase

Phases 1-4 of the real-backend migration are implemented. Phase 1: real Supabase Auth. Phase 2: real profile/preferences/avatar/location persistence. Phase 3: real course search/discovery (Geoapify, via a Supabase Edge Function) — code-complete but still needs `GEOAPIFY_API_KEY` set as an Edge Function secret before it returns real results (Micky has the key, hasn't set it in the dashboard yet). Phase 4: real multiplayer Golf Calls — **fully implemented AND verified live** with two real accounts across two browser sessions (host, join, leave, rejoin, cancel, cross-account visibility, all with zero console errors). Community/DMs remain 100% mock/localStorage-backed for every account, real or demo — entity-by-entity migration continues in later phases.

## Completed work

- Core product surface: onboarding/auth flow, round-first discovery, Fill My Foursome, Golf Circle, GolfMe Credibility, Auto-Match, avatar uploads, course/age/gender preferences, Match Preference sliders, emoji chat, presentation mode, location selection with regional course recommendations, notification bell.
- 6-language localization (`src/i18n`).
- Playwright added for UI regression checks (not yet wired into CI).
- `src/lib/supabase.ts` client created, reading `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from env; throws loudly if unset.
- `.env.example` documents the anon-key-only pattern; `.env.local` is gitignored and holds real `golfme-dev` values locally.
- Vercel deployment configured (`vercel.json` SPA rewrite); production site is currently 100% localStorage-backed, so no Supabase secrets are exposed by the live deploy.
- **`public.profiles` table live on `golfme-dev`**, 1:1 with `auth.users`, modeled on `GolferProfile` in `src/types/index.ts` (all match-preference fields, verification, reputation counters, `has_onboarded` lifecycle flag). RLS enabled: any authenticated user can `select` all profiles (mirrors `visibleGolfers()`); `insert`/`update` restricted to own row via `auth.uid()`.
- `handle_new_user()` trigger auto-inserts a stub profile row on `auth.users` signup (`SECURITY DEFINER`, `search_path = ''`, direct-RPC-call surface closed off by revoking `EXECUTE` from `public`/`anon`/`authenticated` in a follow-up migration). Verified clean on both security and performance advisors.
- Both migrations reconciled into `supabase/migrations/` in this session (they existed on the remote DB but not in this repo — see "Remote/local sync note" below).
- **Phase 1 real auth, implemented and applied to `golfme-dev`:**
  - `20260812180000_add_profile_skill_level_and_language` migration — adds nullable `skill_level` (Beginner/Intermediate/Advanced check constraint) and `language` columns to `public.profiles`, applied via the Supabase MCP `apply_migration` tool and reconciled into this repo. Advisors re-checked clean (0 security lints) after.
  - `src/context/AuthContext.tsx` (new) — owns the real Supabase session lifecycle (`getSession` + `onAuthStateChange`), fetches/holds the caller's `profiles` row, exposes `signInWithGoogle`, `signInWithEmailOtp` (magic link — chosen over password auth to avoid building password storage/reset UI this phase), `signOut`, `saveProfile`, and a separate `isDemo` flag (persisted in localStorage under a different key than the mock `AppData` blob) that the demo path flips independently of any real Supabase state.
  - `src/lib/profile.ts` (new) — maps a real `profiles` row onto the existing `GolferProfile` type (zeroed reputation/verification for a fresh real account — real zeros, not fabricated numbers) so every existing component keeps working unchanged; also a placeholder-profile helper for the brief window before a brand-new session's stub row has loaded.
  - `src/context/DataContext.tsx` — `session`/`currentUser`/`logIn`/`logOut` now branch on `AuthContext`'s `isDemo`: demo keeps 100% of today's mock behavior; real accounts source identity from the real `profiles` row instead of the shared mock `golfers` array. All mock CRUD (golf calls, community, reviews, etc.) untouched — that array stays the same shared demo world every account still sees this phase.
  - `src/App.tsx` — `AuthProvider` added to the tree; `AuthedLayout`/`GuestOnly` route guards now branch on three states, not two (no session -> Welcome; session but not onboarded -> forced to `/profile-setup`; session + onboarded -> the app); `AppGate`'s loading gate now also blocks on real session restore, reusing the existing `GolfMeLoader`.
  - `src/pages/Auth.tsx` — the old fake "pick a mock account" login picker is gone. Google button calls real OAuth; Email button collects an address and sends a real magic link with a "check your email" confirmation state; Apple button removed (out of scope this phase, was never real); "Try Demo Account" unchanged.
  - `src/pages/ProfileSetup.tsx` — same 4-step wizard UI, but the final-step submit branches: demo path still calls the existing mock `signUpNewGolfer`; real path writes into the caller's already-existing real `profiles` row (the auth identity exists before this wizard can even be reached) and flips `has_onboarded`. Avatar upload isn't wired to Supabase Storage yet — `photoUrl` stays local-only for real accounts this phase, never written as a data-URL/base64 into the database.
  - `src/pages/Settings.tsx` — the "Prototype tools" panel (preview-as-demo-golfer, reset demo data, reset onboarding) is now gated behind `isDemo`; real accounts no longer see it.

- **Phase 2, implemented and applied to `golfme-dev`:**
  - `20260812200000_add_avatars_storage_bucket` migration — public `avatars` Storage bucket, one object per golfer at `<user-id>/avatar.jpg` (upsert on replace), 4 RLS policies on `storage.objects` (public read; insert/update/delete restricted to the caller's own folder via `(storage.foldername(name))[1] = auth.uid()::text`). Advisors clean.
  - `src/lib/profile.ts` — added `golferPatchToProfileRow()`, the inverse of Phase 1's row->GolferProfile mapper: turns any `Partial<GolferProfile>` patch into real column names, touching only the keys actually present in the patch. Deliberately excludes client-writable-never fields (reputation counters, circleSize, memberSince, id, distanceMiles).
  - `src/context/DataContext.tsx` — `updateCurrentUserProfile`/`setPhoneVerified`/`setEmailVerified`/`requestVerifiedGolfer` now branch demo (unchanged mock) vs. real (writes through `AuthContext.saveProfile`). Every existing caller — Profile page edit, Match Preferences (location change, availability, all match-preference sliders/pills), AutoMatch's quick-set buttons — got real persistence with no changes to their own code, confirmed by review of every call site.
  - `src/components/profile/AvatarUpload.tsx` — real accounts now resize-and-upload the actual image bytes to the `avatars` Storage bucket (never a data-URL/base64 string into the database) and save the public URL (cache-busted on replace); demo accounts keep the original local data-URL behavior unchanged. "Remove" deletes the Storage object for real accounts before clearing `photo_url`.
  - `src/context/AuthContext.tsx` / `src/App.tsx` — added a best-effort two-way sync between the device-local language setting and `profiles.language` for real accounts only (pull once per login if the profile has a saved language and the device doesn't; push on every explicit change after that). Demo accounts untouched.
  - Real location (D) and "no fake stats" (F) needed no new code: `LocationPicker`'s "Use My Current Location" / manual region search was already real (not mocked) and already flows through `updateCurrentUserProfile`, so it's been real end-to-end since the `updateCurrentUserProfile` branch above landed; Phase 1's real-account mapping already returns real zeros (not fabricated numbers) for reputation, which was already true before Phase 2 started.
  - Deviated from the Phase 2 spec's literal "new `user_preferences` table" ask (A): kept preferences as columns on `profiles`, consistent with Phase 1's own schema decision — flagged to Micky before building, not silently.

- **Phase 3, implemented and applied to `golfme-dev`:**
  - `20260812210000_create_courses` migration — new `public.courses` cache table (provider, external_id, name, city, region, country, lat/lng, address, fetched_at), unique on (provider, external_id), RLS: any authenticated golfer can select/insert/update (shared reference cache, no per-user ownership; no client-facing delete). Advisors clean.
  - `supabase/functions/course-search/index.ts` — new Edge Function, deployed and ACTIVE. Calls Geoapify's Places API (`categories=sport.golf`) server-side using a `GEOAPIFY_API_KEY` secret that never reaches the browser bundle (chosen over a client-side-with-referrer-restriction key, per Micky's call). Uses the caller's own forwarded JWT (not a service-role key) to upsert results into `courses`, so writes still go through that table's normal RLS. Returns a clear JSON error (never fake data) if the key is missing, the provider errors, or the request is malformed — verified live via direct curl (missing-key case returns exactly the intended message; a request with no Authorization header is correctly rejected with 401 by Supabase's own JWT gate before the function code even runs).
  - `src/lib/realCourseSearch.ts` (new) — real accounts' implementation of the same conceptual surface as the existing mock `courseSearch.ts` (search/nearby/getById/recommended), calling the Edge Function + `courses` table instead of the static fixture. `courseSearch.ts` itself is untouched — it's now explicitly demo mode's implementation (and still separately powers Golf Calls' distance display for existing mock round data, unrelated to this phase).
  - `src/lib/useCourseSearch.ts` (new) — two hooks (`useNearbyCourses`, `useCourseTextSearch`) that branch demo (synchronous fixture) vs. real (async, debounced 300ms on text search, loading/error state) so the three consumer components didn't need to duplicate that logic.
  - `src/components/ui/CourseSearchStatus.tsx` (new) — shared loading spinner / error+retry row, used by all three consumers. Real-mode-only; demo's search is synchronous and never errors, so this never renders for demo accounts.
  - `src/components/profile/CoursePicker.tsx`, `src/components/golfcall/CourseAutocomplete.tsx`, `src/pages/ProfileSetup.tsx` (onboarding's nearby-courses step) — all three switched from the old synchronous mock-only calls to the new hooks; demo mode's visible behavior is unchanged (confirmed by a Playwright regression pass — search, pick, add-to-preferred all still work, zero Edge Function calls fire in demo mode).
  - Location-aware ranking (New York + "Eisenhower" ranks the nearby course first) is handled by Geoapify's own `bias=proximity:lon,lat` parameter server-side, with a client-side haversine re-sort on top as a second pass — not purely trusting the provider's own ordering.
  - `src/data/regions.ts` and `src/lib/courses.ts` (the old 13-course NY-only fixture) are untouched — still demo mode's data, and still what Golf Calls' distance display uses for existing mock round data.

- **Phase 4, implemented, applied to `golfme-dev`, AND verified live with two real accounts:**
  - `20260813050000_create_golf_calls_and_participants` migration — new `public.golf_calls` (course snapshot: `course_id` FK to Phase 3's `courses` cache + `course_name`/`course_area_label`/`course_lat`/`course_lng` copied onto the round; `tee_time_source`/`tee_time_provider`/`external_tee_time_id` columns present but locked to `'user_entered'` — future tee-time-provider integration needs no schema change) and `public.round_participants` (unique on `(round_id, user_id)`, no client-facing insert/update policy at all). Both tables added to the `supabase_realtime` publication.
  - `join_golf_call()`/`leave_golf_call()` — SECURITY DEFINER functions, the *only* way membership changes: `join_golf_call` row-locks the round (`for update`) before counting joined participants against `total_spots`, so two golfers hitting "join" on the last spot at the same instant are serialized by Postgres itself rather than racing. This is the actual database-side atomic solution the phase asked for, not a frontend check — see live test results below for verification.
  - `20260813051500_add_host_golf_call_function` migration — `host_golf_call()`, a second SECURITY DEFINER function that atomically creates the round *and* seats the host as a `round_participants` row in one transaction (the host occupies one of `total_spots`, same as the existing mock's `joinedGolferIds` having the host at index 0 — this was a correctness gap caught and fixed *before* it ever shipped: without it, `join_golf_call`'s fullness check would have undercounted by one and let a full round accept one extra player).
  - `src/lib/golfCall.ts` (new) — maps a real round + its participants onto the existing (mock-shaped) `GolfCall` type, the same trick as Phase 1's profile mapper. This is why so little UI needed to change: `GolfCallCard`, `GolfCallDetail`, `MyRounds`, `GolfCalls` (Find/browse), compatibility scoring, and round filters all work unchanged for real rounds — they just consume whatever `golfCalls` the branch below hands them.
  - `src/context/RealRoundsContext.tsx` (new) — fetches all real rounds + participants + resolves participant profiles (batch query against `profiles`), exposes `hostRound`/`joinRound`/`leaveRound`/`cancelRound`, and holds one global Realtime subscription (`postgres_changes` on both tables) that triggers a refetch on any change — satisfies "membership changes appear across devices without restarting" without per-route subscription lifecycle management.
  - `src/context/DataContext.tsx` — `golfCalls`, `getGolfCall`, `getGolfer` now branch demo vs. real (real participant ids resolve against `RealRoundsContext`'s profile cache, not the shared mock `golfers` array); `joinGolfCall`/`leaveGolfCall`/`cancelGolfCall` are now `Promise`-returning and branch the same way, surfacing real atomic-join failures (e.g. "This round is full.") to the UI instead of silently no-op'ing.
  - `src/pages/CreateGolfCall.tsx` — real hosting is "Starting Fresh" only (Fill My Foursome's friend-invite needs a real Golf Circle/Following that doesn't exist yet — approved scope trim) and instant-join only (request-to-join's approval flow deferred — also approved). Real course picks now carry the picked course's `courses.id`/lat/lng through to the host call, not just its name.
  - `src/pages/GolfCallDetail.tsx`, `src/components/golfcall/GolfCallCard.tsx` — join/leave/cancel now `await` and show a toast on failure instead of assuming success; the "🧪 Simulate round completion" prototype button is now demo-only (no real "round is over" detection exists yet for real rounds, out of scope this phase).
  - Chat and reviews on real rounds are explicitly out of scope this phase (not in the phase brief) — a real round's chat tab is a local, non-synced mock thread; `isCompleted` never becomes true for a real round, so the review flow never triggers. Flagged before building, not silently skipped.

## In progress

- Nothing actively mid-change. Phases 1-4 are all implemented, typechecked, built, and linted clean. Phase 3 specifically still needs its Geoapify key set as an Edge Function secret before it does anything real — see "Manual configuration required" below. See "Phase 1/2/3/4 test results" for what's been verified live vs. not.

## Phase 1 test results (2026-08-12)

Automated (Playwright against a local `vite dev` server + the real `golfme-dev` project):
- Cold load, no session -> lands on Welcome. Pass.
- Try Demo Account -> logs in, lands on Home. Pass.
- Refresh while in demo session -> stays logged in (no flicker to Welcome). Pass.
- Log out (demo) -> back to Welcome; refresh after logout -> stays logged out. Pass.
- Apple button removed; Google + Email buttons present. Pass.
- Google OAuth click -> real request to Supabase's `/auth/v1/authorize`, correctly returns 400 (Google provider not yet enabled in the dashboard — expected until the manual config below is done, not a code issue).
- Email magic link -> real request to `/auth/v1/otp`, 200, "check your email" screen shown; a real magic-link email was received (via a disposable test inbox) and following it established a real session and correctly routed straight to `/profile-setup` (authenticated-but-not-onboarded state working as designed) with zero console errors.
- Confirmed via direct DB query: `handle_new_user()` auto-created a real stub `profiles` row (`has_onboarded: false`) for that new auth identity.
- `npx tsc -b`, `npm run build`, `npm run lint` all clean (zero new errors; pre-existing warnings unrelated to this change).

Not yet verified live: the ProfileSetup wizard's real-account write-back path (ProfileSetup -> `saveProfile` -> `has_onboarded: true`) was code- and column-name-reviewed against the migration but not click-tested end-to-end — Supabase's default email rate limit was hit before a second full run could complete. Also not verified: a real second account (Account B) staying fully isolated from Account A, and Google OAuth's full round trip (blocked on the manual provider config below).

## Phase 2 test results (2026-08-12)

- `npx tsc -b`, `npm run build`, `npm run lint`: all clean, zero new errors/warnings.
- Demo-mode regression check (Playwright): Try Demo login, Profile edit modal open/fill/save with zero console errors, "Prototype tools" still visible in demo, and confirmed zero Storage API calls fire in demo mode (avatar path correctly stayed on the local data-URL branch). Pass.
- DB-level verification (direct SQL against `golfme-dev`, not through the app): `avatars` bucket exists with `public: true`; all 4 expected `storage.objects` RLS policies exist with correct commands/roles (public SELECT; authenticated-only INSERT/UPDATE/DELETE); `profiles.skill_level` and `profiles.language` both nullable as intended. Pass.
- **Not verified live**: real-account avatar upload, real-account profile/preferences/location edit-and-persist, the language pull/push sync, and Account A/Account B isolation. Supabase's default built-in email service hit a project-wide rate limit (confirmed project-wide, not per-recipient, by testing two different addresses) partway through Phase 1 testing and never freed up during this session — every code path here was written and reviewed against the exact same patterns already proven live in Phase 1 (same `saveProfile`/RLS mechanism, same column-name cross-checking discipline), but "reviewed" is not "tested," flagging honestly rather than claiming a live pass. Worth setting up a custom SMTP provider in Supabase's dashboard if repeated real-auth testing during development is going to be routine — the built-in one is meant for low-volume/production, not iterative testing.

## Phase 3 test results (2026-08-12)

- `npx tsc -b`, `npm run build`, `npm run lint`: all clean, zero new errors/warnings.
- Demo-mode regression check (Playwright): Match Preferences page's Preferred Courses picker — search "Bethpage", pick a result, confirm it's added — still works exactly as before, zero console errors, zero calls to the `course-search` Edge Function (confirms the isDemo branch is correctly routing demo accounts to the static fixture, never the network).
- Edge Function reachability/auth-gate verified live via direct curl against the deployed function (not through the app): a request with no `Authorization` header is correctly rejected with 401 before any function code runs (Supabase's own `verify_jwt` gate); a request with a valid bearer token but no `GEOAPIFY_API_KEY` secret set returns exactly the intended honest error (`"Course search isn't configured yet (missing GEOAPIFY_API_KEY)."}`), confirming the "never silently fall back to fake data" requirement is actually implemented, not just intended.
- **Not verified live**: any real Geoapify results at all (New York/Miami/Las Vegas nearby search, partial-name search, location-aware ranking) — blocked entirely on the `GEOAPIFY_API_KEY` secret, which Micky has the key for but hasn't set in the dashboard yet as of this session ending. Also not verified: the three consumer components' real-mode UI (loading spinner, error+retry row) actually rendering correctly in a browser — reviewed against the code, not click-tested, since there's no real key to trigger a real request with yet.

## Phase 4 test results (2026-08-13)

Fully live-tested this time — the email rate limit that blocked live testing in earlier phases had cleared, so this ran against two real, separate authenticated accounts (two Playwright browser contexts, two real Supabase sessions) rather than code review alone.

- `npx tsc -b`, `npm run build`, `npm run lint`: all clean.
- Demo-mode regression (Playwright): host-a-round wizard completed end to end on the mock path, round appears in My Golf's Upcoming section, zero calls to any real Supabase `golf_calls`/`rpc`/realtime endpoint fired. Pass.
- **Real two-account test, the actual point of this phase:**
  1. Account A hosted a round at "Pebble Beach Golf Links" (a real Geoapify result, correctly snapshotted with `course_id`/coords) with `total_spots: 2`. Confirmed via direct DB query: `host_golf_call()` created the round *and* seated Account A as a `round_participants` row in the same call.
  2. Account B saw the round in Find (cross-account visibility, real query, no page reload needed between accounts). Pass.
  3. Account B joined via the real UI (Join Round -> confirm modal -> real `join_golf_call` RPC call) — round correctly flipped to "Full," B's page correctly showed "Leave round." Pass.
  4. **Overfill prevention, tested directly against the live function**: with the round already full, a second join attempt (Account B calling the RPC again after a session refresh) was correctly rejected — `{"message":"This round is no longer open to join."}`, HTTP 400 — not a silent no-op, not a generic error, the actual intended message. This is the deterministic half of requirement E (does the guard reject a full round); the race-both-clicking-simultaneously half is covered by code review of the `for update` row-lock pattern (a standard, well-understood Postgres idiom for exactly this problem), not by literally firing two simultaneous requests, since only two real accounts were available to test with.
  5. Account A refreshed and saw Account B in the roster and the round marked Full. Pass.
  6. Account B left the round — Account A's next refresh correctly showed B removed from the roster. Pass.
  7. Account B rejoined successfully (proves `join_golf_call`'s `on conflict ... do update` correctly handles the "previously left, now rejoining" case, not just a fresh join). Pass.
  8. Account A cancelled the round — both Account A's and Account B's next page load showed the "Cancelled" state. Pass.
  - Zero console/page errors across the entire sequence, on either account.
- One unrelated finding along the way: a background language-preference sync call (Phase 2 feature) hit a transient `"JWT issued at future"` error once, tied to a momentary clock-skew between Supabase's Auth and Database services — not something in this codebase, self-resolved on retry, did not affect anything in this phase's test.
- Test data (one cancelled test round, two test profiles named "Account A Test"/"Account B Test") is sitting in `golfme-dev` from this run — harmless, but worth clearing if you want a clean dev database before real usage.

## Remote/local sync note (2026-08-12)

The `create_profiles` and `lock_down_handle_new_user_execute` migrations were applied straight to `golfme-dev` in an earlier session (likely mobile/claude.ai/code — "remote control"), without a corresponding local commit. This session discovered the drift via `list_tables`/`list_migrations` against the live project, and wrote matching files into `supabase/migrations/` so the repo is reproducible again. **Lesson: always check `list_migrations` against the remote project at the start of a Supabase-touching session, don't trust local `supabase/migrations/` alone to reflect DB state**, since this project has no CLI-linked local Postgres to diff against.

## Remaining / next up

1. **Set `GEOAPIFY_API_KEY` as an Edge Function secret** — Micky has the key, just hasn't set it yet. No MCP tool can do this remotely; it's a dashboard/CLI step. See "Manual configuration required" below for exactly where.
2. **Manual config required before real auth actually works end-to-end for Google** — see "Manual configuration required" below. Not something a session can do unsupervised (needs Google Cloud Console + Supabase dashboard access).
3. Live-test everything still flagged "not verified live" in the Phase 1/2 test-results sections — blocked on Supabase's default email rate limit at the time, which has since cleared (Phase 4's live test got through fine), so these are likely just waiting for someone to run them, not actually blocked anymore.
4. Once real courses are flowing: revisit whether `favoriteCourses`/`preferredCourses` (profiles) and the real Golf Call course picker should store a stable course id instead of a free-text name — deliberately kept as plain name strings through Phase 4 to avoid touching existing storage shapes, but a nationwide real course list makes name collisions more likely than the old 13-course NY fixture ever had.
5. Phase 4 scope trims to revisit later: request-to-join (host approval) for real rounds, Fill My Foursome for real hosts (needs real Golf Circle/Following first), real "round is completed" detection + reviews for real rounds, real chat for real rounds.
6. True concurrent-race testing of `join_golf_call()` (two *simultaneous* requests hitting the last spot at once) — the deterministic half (does a full round correctly reject) is verified live; the row-lock's behavior under genuine simultaneity is verified by code review of a standard Postgres pattern, not by literally firing two parallel requests, since only two real test accounts were available.
7. Wire Playwright into a CI check (GitHub Actions) so regressions surface on push, not just locally.
8. Decide on production Supabase project (separate from `golfme-dev`) before any real user data is stored — worth doing before Phase 4's real multiplayer data starts accumulating for real.

## Manual configuration required

Not done by any session — needs dashboard/browser/third-party-account access this environment doesn't have:

- **Supabase (`golfme-dev`, ref `adokdenbmpshqgjbzshb`) > Edge Functions > `course-search` (or the project-wide Edge Functions secrets page) > Secrets**: add `GEOAPIFY_API_KEY`. Or via CLI: `supabase secrets set GEOAPIFY_API_KEY=<key> --project-ref adokdenbmpshqgjbzshb`. Nothing else needed on the Geoapify side — free tier, one key covers the Places API this function calls.
- **Supabase > Authentication > Providers > Google**: enable, needs a Client ID + Secret from Google Cloud Console.
- **Supabase > Authentication > Providers > Email**: enable (magic link, not password).
- **Supabase > Authentication > URL Configuration**: add Site URL + redirect URLs for `http://localhost:5173/**` (Vite's default dev port, confirmed unmodified in `vite.config.ts`) and the Vercel production domain.
- **Google Cloud Console**: OAuth consent screen (External is fine for now) + an OAuth 2.0 Client ID. Authorized redirect URI is Supabase's fixed callback — `https://adokdenbmpshqgjbzshb.supabase.co/auth/v1/callback` — not the app's own URL. Authorized JS origins: localhost dev + Vercel prod origins.
- **Vercel**: add `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as env vars (Production + Preview) — currently only in local `.env.local`.

## Known bugs

- None currently tracked. (Add entries here as they're found — include repro steps and the commit/date discovered.)

## Architectural decisions

- **Mocked-first, Supabase-second**: UI and product flows were built against a localStorage mock so product iteration wasn't blocked on backend design. Migration to Supabase happens entity-by-entity now that the shape of the data model is proven out by the mock.
- **Anon key only in the frontend, ever**: `VITE_`-prefixed env vars are inlined into the shipped bundle by Vite. The service_role/secret key must never be referenced in frontend code or committed anywhere — RLS policies are the access-control boundary, not key secrecy. See the comment header in `src/lib/supabase.ts` and `.env.example`.
- **Single repo, single `main` branch, GitHub as source of truth**: no long-lived feature branches; small commits with clear messages so any session (laptop or claude.ai/code mobile) can `git log`/`git pull` and immediately understand recent history. Push and Vercel deploy always require explicit confirmation from Micky before happening.
- **No unattended/scheduled agents**: development sessions are always actively driven (by Micky, from the laptop or from claude.ai/code in a mobile browser) — no cron-triggered or background cloud agents are configured to push commits unsupervised.
- **Reputation counters stay denormalized on `profiles` for now**: `completed_rounds`, `show_up_rate_pct`, etc. live directly on the row (same shape as the old mock) rather than being computed from a `reviews` table, since `reviews` doesn't exist yet. Revisit once reviews are migrated — likely becomes a computed/aggregated value at that point.

## Database migrations completed

- `20260811163457_create_profiles` — creates `public.profiles`, enables RLS + 3 policies (select-any-authenticated, insert-own, update-own), `set_updated_at()` trigger, `handle_new_user()` signup trigger.
- `20260811163630_lock_down_handle_new_user_execute` — revokes public `EXECUTE` on `handle_new_user()` to close the direct-RPC-call privilege-escalation surface (SECURITY DEFINER functions in `public` are otherwise callable by anon/authenticated by default).
- `20260812180000_add_profile_skill_level_and_language` — adds nullable `skill_level` (check-constrained to Beginner/Intermediate/Advanced) and `language` columns to `public.profiles`, needed by Phase 1's real onboarding write-back. Applied directly to `golfme-dev` via the Supabase MCP and reconciled into this file. Advisors clean after.
- `20260812200000_add_avatars_storage_bucket` — public `avatars` Storage bucket + 4 RLS policies on `storage.objects` (public read, own-folder-only insert/update/delete), needed by Phase 2's real avatar upload. Applied via the Supabase MCP, reconciled into this file. Advisors clean after (aside from one pre-existing, unrelated dashboard-level warning about leaked-password protection — irrelevant since this project uses magic-link, not password, auth).
- `20260812210000_create_courses` — new `public.courses` real-course-data cache table + RLS (any authenticated golfer can select/insert/update, no client delete), needed by Phase 3's real course search. Applied via the Supabase MCP, reconciled into this file. Advisors clean after.
- `20260813050000_create_golf_calls_and_participants` — new `public.golf_calls` + `public.round_participants`, RLS, `join_golf_call()`/`leave_golf_call()` SECURITY DEFINER functions, both tables added to the `supabase_realtime` publication. Needed by Phase 4's real multiplayer rounds. Applied via the Supabase MCP, reconciled into this file. Advisors clean after (aside from the two expected SECURITY DEFINER warnings for the new functions — intentional, signed-in users are exactly who should call them, see the code comments).
- `20260813051500_add_host_golf_call_function` — `host_golf_call()`, a third SECURITY DEFINER function that atomically creates a round and seats the host as a participant in one transaction (fixes a correctness gap: without this, the host wouldn't occupy a `round_participants` row, and `join_golf_call()`'s fullness check would undercount by one). Applied via the Supabase MCP, reconciled into this file. Advisors clean after.

## Supabase configuration status

- Project: `golfme-dev` (dev-only, no production project yet), ref `adokdenbmpshqgjbzshb`.
- Client wiring: done (`src/lib/supabase.ts`), and now live — real auth (Google OAuth + email magic link) and real profile read/write both run through it for non-demo accounts. Demo accounts still never touch it.
- Secrets: anon key lives in `.env.local` (gitignored, not committed); not yet set in Vercel (app isn't deployed with real auth yet — see "Manual configuration required"). Service-role key has never been used in this codebase and should stay that way for client code.
- RLS: enabled on `profiles`, verified via advisors (0 security/performance lints as of 2026-08-12, re-checked after this session's migration).
- Auth providers: Google and Email are NOT yet enabled in the Supabase dashboard — that's manual, external config (see above), not something done from a session.
- Edge Functions: `course-search` deployed and ACTIVE, but non-functional until `GEOAPIFY_API_KEY` is set as a secret (see "Manual configuration required").
- Realtime: enabled on `golf_calls` and `round_participants` (via the `supabase_realtime` publication) — live-verified working across two real accounts in Phase 4's test (see below).
- Two real test accounts now exist in `golfme-dev` from Phase 4's live test (`golfme-phase1-smoketest@mailinator.com`, `golfme-phase4-accountb@mailinator.com`), plus one cancelled test round — harmless leftover test data, clear it if you want a clean dev DB.

## Exact next recommended action

Set `GEOAPIFY_API_KEY` (fastest to unblock, Micky already has the key) — Phase 3 is otherwise done and waiting on exactly that one step. Then the remaining Google OAuth / redirect-URL / Vercel-env-var config from Phase 1 whenever real production auth matters. Phase 4 (real multiplayer rounds) is done and live-verified — no further action needed to consider it closed, though the concurrent-race edge case (two genuinely simultaneous join attempts) is verified by code review of the row-lock pattern rather than literal parallel requests, worth keeping in mind. Next phase after this: not yet scoped, needs a phase brief from Micky first — Community and tee-time-provider integration remain the two biggest still-mock surfaces.

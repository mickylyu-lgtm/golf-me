# Founding B: staging test plan (separate Supabase project)

Status: **plan only.** Nothing has been created. Creating the staging project, its keys/secrets and auth settings are infrastructure changes that need Micky's approval first (see section 0). Production (`golfme-dev`, the LIVE database) is never touched by anything in this plan.

Covers migration `20261022120000_founding_onboarding_window.sql` (decision B, thresholds approved 2026-10-21) on top of `20261021120000_profiles_playing_area_place_and_geocode.sql`. The local PGlite check (`scripts/migration-checks/founding-onboarding-window.mjs`, 22/22) already proves the logic in one connection; staging adds what PGlite can't: the real Supabase platform (roles, JWT, PostgREST, RLS through the API), **real concurrency** across connections, the web app's admin section and landing copy, and a rehearsal of the production apply and rollback.

Related: `docs/GLOBAL_HOSTING_ROLLOUT.md` (section d: staging options, section c2: migration review and rollback SQL, section h: deploy plan), `docs/FOUNDING_ELIGIBILITY_REVIEW.md` (rules, thresholds, transition rule).

## 0. Approvals needed before starting [Micky]

1. Create a free Supabase project, e.g. `golfme-staging` (check the org has a free slot; if it would be billed, stop and ask).
2. Staging-only settings: its own anon key in Micky's local `.env.local` (never committed, never a `VITE_` service key), auth Site URL `http://localhost:5173`, email confirmation on, no Google OAuth needed (magic link is enough), no APNs/Gemini/Roboflow secrets.
3. Take the schema-only dump of production on Micky's Mac (read-only against production: `supabase db dump --schema-only`). **No data dump**: no profiles, chats, rounds or swing videos leave production.

## 1. Build the staging database

1. Apply the schema-only dump to staging. It has the tables, functions, triggers and policies but **no rows**, including no `founding_cohort_state` row.
2. Seed fixtures only (SQL editor, staging):
   - the cohort row exactly as the original Founding migration inserts it (`nyc_2026`, cap 250, `next_number` 1), then open it the way `20261006120100` did;
   - an `admin` role row for the staging admin test account (created in step 3).
3. Create test accounts with addresses Micky controls (e.g. plus-aliases of one inbox) or create users in the staging dashboard and confirm them there. Fixture names only (`Staging A`…), no real people.
4. Record the "before" state: `select * from founding_cohort_state`, `select count(*), max(member_number) from founding_golfer_awards`.
5. Create the **legacy** accounts (section 3) now, *before* the migration, so they really have no `onboarded_at`.
6. Apply `20261021120000` then `20261022120000` exactly as production will (one transaction each, `set local lock_timeout = '5s'` first; never `supabase db push`, see rollout section c). Time each apply.
7. Confirm the "after" state matches "before": same awards, same counter, `onboarded_at` NULL on every pre-existing row, 0 review rows. Run the Supabase security and performance advisors and note anything new.

Time travel: windows depend on `now()`. To test "older than 14 days", backdate in the staging SQL editor (runs as `postgres`, which the stamp trigger allows), e.g. `update public.profiles set onboarded_at = now() - interval '15 days' where id = …`, and for legacy accounts `created_at` on both `auth.users` and `public.profiles`. Never run these on production.

## 2. Web app against staging

Run `npm run dev` from the `global-hosting` branch with Micky's local `.env.local` pointed at **staging** (URL + anon key). Double-check the URL in the browser's network tab before the first save: it must be the staging project ref, never `golfme-dev`. Use one normal browser profile per test account and a separate one for the admin.

## 3. Test cases

Pass = every expected result holds. For each case, record the account, the time, the result and the relevant rows (labels and miles from Midtown only, never coordinates in the notes).

### New users

| # | Steps | Expected |
|---|---|---|
| N1 | Sign up, confirm email, onboard with New York, NY (built-in) | Number awarded at onboarding (reveal shows), `onboarded_at` stamped, no review row |
| N2 | Onboard with a searched NYC-area city (e.g. Brooklyn) | Awarded |
| N3 | Onboard with Tokyo | No number, no review |
| N4 | Onboard with free text "Brooklyn" (no coordinates) | No number, no review |
| N5 | Unconfirmed email, onboard in NYC | No number, no review |
| N6 | Account with an excluded role, onboard in NYC | No number, no review |

### Corrections inside the 14-day window

| # | Steps | Expected |
|---|---|---|
| C1 | N3 (Tokyo) changes area to New York in Match Preferences | Auto-awarded; review row `auto_awarded`, flag `far_jump` |
| C2 | N4 (free text) changes to Brooklyn | Auto-awarded, flag `no_previous_coordinates` |
| C3 | Fresh account: Tokyo → London → Seoul → NYC (4th change) | No award; pending review `correction_over_cap`, flag `move_cap_exceeded` |
| C4 | Fresh account: Tokyo → London → NYC within minutes (3rd change) | Auto-awarded (cap boundary), flag `rapid_moves` |
| C5 | Awarded user edits bio / label / re-saves the same city | 0 award calls, no new review |
| C6 | Find a Round → "Playing somewhere else" → New York, browse | Profile row unchanged (`updated_at` too), no award, no review |
| C7 | Try to reopen the window: send `onboarded_at` in a profile update via the API as the user | Value unchanged |

### Outside the window

| # | Steps | Expected |
|---|---|---|
| O1 | Backdate a Tokyo user's `onboarded_at` to 15 days ago, move to NYC | No award; one pending review `outside_window` |
| O2 | Same user moves again (still NYC area) | Same review refreshed, not a second one |
| O3 | Admin approves O1 in the dashboard | Next number awarded, review `approved` with the number, reveal shows for the user |
| O4 | Admin dismisses another pending review; user later moves into the zone again | Dismissed stays dismissed; a new pending review opens |
| O5 | Pending user moves back to Tokyo, admin approves | Refused ("not eligible right now"), review stays pending, no number |

### Existing (legacy) users, created before the migration

| # | Steps | Expected |
|---|---|---|
| L1 | Legacy account already holding a number | Number, reveal and badge unchanged after the apply |
| L2 | Legacy, signed up 5 days before the apply, Tokyo → NYC | Auto-awarded, `window_anchor_source = created_at` |
| L3 | Legacy, `created_at` backdated 30 days, Tokyo → NYC | Pending review, anchored on `created_at` |
| L4 | Legacy account whose number was revoked with `admin_revoke_founding_award()` moves into the zone | No award, no review, the revoked number stays consumed |

### Admin, authorization and replay

| # | Steps | Expected |
|---|---|---|
| A1 | Non-admin calls `admin_list_founding_reviews`, `admin_approve_founding_review`, `admin_dismiss_founding_review` via the API | `Not authorized` (42501) |
| A2 | Non-admin selects / inserts / updates `founding_eligibility_reviews` and selects `private.founding_location_moves` via the API | Denied / 0 rows |
| A3 | Admin approves the same review twice (second call after the first returns) | Second fails "Pending review not found", one number only |
| A4 | Admin dismisses an already approved review | Fails, status unchanged |
| A5 | Signed-out (anon) calls to all three RPCs | Denied |

### Concurrency (real parallel connections)

Use a small throwaway script **outside the repo** that opens separate connections to staging (or fires API calls with separate user JWTs) and releases them at the same moment. Run each 5 times.

| # | Steps | Expected |
|---|---|---|
| P1 | 10 new in-zone users finish onboarding at once | 10 distinct consecutive numbers, no gaps, no duplicates, counter = max + 1 |
| P2 | One user's two simultaneous saves that both move into the zone | Exactly one award |
| P3 | Two admins (or two tabs) approve the same pending review at once | One succeeds, one fails, one number |
| P4 | Approve a review while the same user's in-window correction auto-awards | One number total; the other path awards nothing |
| P5 (last, see note) | Set `next_number = 249`, then 3 users qualify at once (mix of onboarding and an admin approve) | Exactly one gets #250, the cohort closes; the others get no number; later approvals are refused |

Note on P5: closing the cohort is **permanent by design** (the guard refuses to reopen it). Run P5 last, or recreate the staging database afterwards (repeat section 1) if more testing is needed.

### Display and copy

| # | Steps | Expected |
|---|---|---|
| D1 | Landing page logged out | Top section says rounds can be hosted worldwide, with no NYC spots line |
| D2 | "Golfing in the New York area?" section | Shows the live remaining count from `get_founding_cohort_status()`; changes after an award |
| D3 | Same section with the cohort closed, or the RPC blocked/failing | Section hidden, no stale number |
| D4 | Onboarding with Tokyo vs NYC | Spots line only for the NYC pick |
| D5 | Demo account | No Founding count or numbers loaded |
| D6 | Admin dashboard → Founding Golfer reviews, in 2 languages | Pending and auto-awarded lists show labels and miles only, never coordinates |

### Rollback rehearsal

1. After the cases above, run the rollback SQL from `GLOBAL_HOSTING_ROLLOUT.md` section c2.
2. Expected: every award and the counter are identical to before the rollback; the review table, move log, `onboarded_at` and new functions are gone; onboarding awards still work with the old rules (repeat N1).
3. Re-apply the migration and confirm it applies cleanly again.

## 4. Evidence to bring back

- Pass/fail per case with time and notes (no coordinates, no real emails).
- Apply and rollback timings, lock waits, advisor output.
- Concurrency run output (5 runs each).
- Screenshots: D1–D3 and D6.
- Anything unexpected, before any production step is proposed.

## 5. Not covered here

Geoapify credits and city localization (rollout section f), the released iOS app device check (rollout section e), and the production backup check (rollout section b) are separate release gates. Production rollout still needs its own explicit approval (rollout section h).

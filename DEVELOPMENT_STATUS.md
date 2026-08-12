# GolfMe — Development Status

> Read this file first in any new session (laptop or claude.ai/code on mobile) before making changes. Update it in the same commit as any milestone — new feature, schema change, or architectural decision — so the next session (possibly on another device) has zero context loss.

Last updated: 2026-08-12

## Current phase

Frontend-first MVP build. React + Vite + TypeScript app deployed to Vercel, running entirely on a mocked/localStorage `DataContext` — no live backend traffic yet. The `golfme-dev` Supabase project now has a real `profiles` table + auth trigger (applied directly against the remote DB in a prior session, ahead of this repo's history — reconciled into `supabase/migrations` in this session). Client code still hasn't been wired to read/write it yet. Next phase is replacing `DataContext`'s localStorage-backed profile reads/writes with real Supabase Auth + `profiles` calls.

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

## In progress

- Nothing actively mid-change. Local repo just caught up to the remote DB's actual schema state; next concrete step is wiring real auth + the `profiles` table into `DataContext` (see Remaining/next up #1).

## Remote/local sync note (2026-08-12)

The `create_profiles` and `lock_down_handle_new_user_execute` migrations were applied straight to `golfme-dev` in an earlier session (likely mobile/claude.ai/code — "remote control"), without a corresponding local commit. This session discovered the drift via `list_tables`/`list_migrations` against the live project, and wrote matching files into `supabase/migrations/` so the repo is reproducible again. **Lesson: always check `list_migrations` against the remote project at the start of a Supabase-touching session, don't trust local `supabase/migrations/` alone to reflect DB state**, since this project has no CLI-linked local Postgres to diff against.

## Remaining / next up

1. Wire real Supabase Auth (email/password or magic link — TBD) into `DataContext`'s `logIn`/`logOut`/`signUpNewGolfer`, replacing the mocked session. `profiles` stub-row-on-signup is already handled server-side by `handle_new_user()`.
2. Replace `DataContext`'s profile reads/writes (`updateCurrentUserProfile`, `setPhoneVerified`, etc.) with Supabase calls against `profiles`, behind the existing component interfaces so the UI doesn't need to change.
3. Design the next entity's migration (rounds/`golf_calls` is the natural next one — `DataContext.createGolfCall` etc.) once profiles are fully live.
4. Wire Playwright into a CI check (GitHub Actions) so regressions surface on push, not just locally.
5. Decide on production Supabase project (separate from `golfme-dev`) before any real user data is stored.

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

## Supabase configuration status

- Project: `golfme-dev` (dev-only, no production project yet), ref `adokdenbmpshqgjbzshb`.
- Client wiring: done (`src/lib/supabase.ts`), but unused by any live code path — app still runs on localStorage.
- Secrets: anon key lives in `.env.local` (gitignored, not committed) and would be set as a Vercel environment variable if/when the deployed app starts using Supabase. Service-role key has never been used in this codebase and should stay that way for client code.
- RLS: enabled on `profiles`, verified via advisors (0 security/performance lints as of 2026-08-12).

## Exact next recommended action

Commit the newly-reconciled `supabase/migrations/` files (this is a repo-state fix, not new DB work — the tables already exist remotely). Then start wiring Supabase Auth into `DataContext.logIn`/`logOut`/`signUpNewGolfer`: decide the auth method (email/password vs. magic link) with Micky first since it's a product-facing choice, then replace the mocked session with real `supabase.auth` calls, keeping the same `DataContextValue` interface so components don't change.

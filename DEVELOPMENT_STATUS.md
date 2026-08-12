# GolfMe — Development Status

> Read this file first in any new session (laptop or claude.ai/code on mobile) before making changes. Update it in the same commit as any milestone — new feature, schema change, or architectural decision — so the next session (possibly on another device) has zero context loss.

Last updated: 2026-08-12

## Current phase

Frontend-first MVP build. React + Vite + TypeScript app deployed to Vercel, running entirely on a mocked/localStorage `DataContext` — no live backend traffic yet. A Supabase project (`golfme-dev`) exists and the client is wired up in code, but nothing in the deployed app reads from it yet. Next phase is migrating real data flows (auth, profiles, matching) from localStorage onto Supabase.

## Completed work

- Core product surface: onboarding/auth flow, round-first discovery, Fill My Foursome, Golf Circle, GolfMe Credibility, Auto-Match, avatar uploads, course/age/gender preferences, Match Preference sliders, emoji chat, presentation mode, location selection with regional course recommendations, notification bell.
- 6-language localization (`src/i18n`).
- Playwright added for UI regression checks (not yet wired into CI).
- `src/lib/supabase.ts` client created, reading `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from env; throws loudly if unset.
- `.env.example` documents the anon-key-only pattern; `.env.local` is gitignored and holds real `golfme-dev` values locally.
- Vercel deployment configured (`vercel.json` SPA rewrite); production site is currently 100% localStorage-backed, so no Supabase secrets are exposed by the live deploy.

## In progress

- Nothing actively mid-change as of this update — repo has uncommitted `package.json`/`package-lock.json` bumps and the new `src/lib/supabase.ts` + `.env.example` staged for a first Supabase-wiring commit.

## Remaining / next up

1. Design and apply the first Supabase schema migration (users/profiles, rounds, matches — whatever the DataContext currently mocks) via `supabase/migrations`, not ad hoc dashboard edits.
2. Replace `DataContext`'s localStorage reads/writes with Supabase calls incrementally, one entity at a time, behind the existing component interfaces so the UI doesn't need to change.
3. Add RLS policies alongside each table as it's created — never ship a table without RLS in the same migration.
4. Wire Playwright into a CI check (GitHub Actions) so regressions surface on push, not just locally.
5. Decide on production Supabase project (separate from `golfme-dev`) before any real user data is stored.

## Known bugs

- None currently tracked. (Add entries here as they're found — include repro steps and the commit/date discovered.)

## Architectural decisions

- **Mocked-first, Supabase-second**: UI and product flows were built against a localStorage mock so product iteration wasn't blocked on backend design. Migration to Supabase happens entity-by-entity now that the shape of the data model is proven out by the mock.
- **Anon key only in the frontend, ever**: `VITE_`-prefixed env vars are inlined into the shipped bundle by Vite. The service_role/secret key must never be referenced in frontend code or committed anywhere — RLS policies are the access-control boundary, not key secrecy. See the comment header in `src/lib/supabase.ts` and `.env.example`.
- **Single repo, single `main` branch, GitHub as source of truth**: no long-lived feature branches; small commits with clear messages so any session (laptop or claude.ai/code mobile) can `git log`/`git pull` and immediately understand recent history. Push and Vercel deploy always require explicit confirmation from Micky before happening.
- **No unattended/scheduled agents**: development sessions are always actively driven (by Micky, from the laptop or from claude.ai/code in a mobile browser) — no cron-triggered or background cloud agents are configured to push commits unsupervised.

## Database migrations completed

- None. No `supabase/migrations` directory exists yet — first migration is the next concrete backend step (see Remaining/next up #1).

## Supabase configuration status

- Project: `golfme-dev` (dev-only, no production project yet).
- Client wiring: done (`src/lib/supabase.ts`), but unused by any live code path — app still runs on localStorage.
- Secrets: anon key lives in `.env.local` (gitignored, not committed) and would be set as a Vercel environment variable if/when the deployed app starts using Supabase. Service-role key has never been used in this codebase and should stay that way for client code.
- RLS: not yet applicable — no tables exist yet.

## Exact next recommended action

Commit the currently-staged `src/lib/supabase.ts` + `.env.example` + `package.json`/`package-lock.json` changes (small, focused commit), then start designing the first migration for whatever entity `DataContext` currently mocks first (likely user profiles) — check `src/context` for the current shape before writing schema.

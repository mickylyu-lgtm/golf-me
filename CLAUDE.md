# GolfMe — working agreement

## Start here every session

Read `DEVELOPMENT_STATUS.md` before doing anything else. It's the handoff point between sessions and devices (laptop CLI, claude.ai/code on mobile). Don't re-derive project state from scratch — trust it, verify against current code/git state if something looks stale, and fix the file if it's wrong.

## Continuity workflow

- GitHub (`main` branch, no long-lived feature branches) is the single source of truth. Any session — laptop or phone — works from `git pull` and `DEVELOPMENT_STATUS.md`, never from conversation memory of a prior session.
- Commit meaningful progress in small, focused commits with clear messages as you go, not in one large batch at the end. This is what makes it safe to pick up work from a different device mid-task.
- Update `DEVELOPMENT_STATUS.md` in the same commit as any milestone: a completed feature, a schema/migration change, or an architectural decision. Keep the "exact next recommended action" section genuinely actionable for whoever opens the repo next.
- Never push to GitHub or trigger a Vercel deploy without asking first, per round of changes — this holds regardless of which device/session initiated the work.
- No scheduled or unattended cloud agents against this repo. Every session is actively driven by Micky, whether at the laptop or via claude.ai/code in a mobile browser.

## Secrets

- `VITE_`-prefixed env vars are inlined into the shipped frontend bundle by Vite — never put a service_role/secret key in one. Anon/publishable keys are safe client-side by design; access control lives in Postgres RLS.
- `.env.local` holds real values and is gitignored; `.env.example` documents shape only, never real values.
- Don't add new secrets-sharing mechanisms (shared vaults, CI secrets, etc.) without asking — current scope is Vercel dashboard env vars + local `.env.local` only.

## Database

- Any schema change goes through a tracked migration (`supabase/migrations`), not ad hoc dashboard edits — so it's reproducible from a fresh session/device.
- Every new table ships with its RLS policies in the same migration, not as a follow-up.

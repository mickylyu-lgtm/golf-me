# GolfMe — working agreement

## Project overview

GolfMe is a golf social/matchmaking mobile app — find playing partners, host and join real golf rounds ("Golf Calls"), chat, build a community, and get AI swing-analysis feedback from "Caddie." Ships as an installable web app (PWA) and, via Capacitor, a native iOS TestFlight build that loads the same live web app rather than bundling a separate copy.

**Stack**: React + TypeScript + Vite frontend (`src/`), Tailwind v4 for styling, Supabase for the real backend (Postgres + RLS, Auth via Google OAuth/email magic-link, Storage, Edge Functions, Realtime), Capacitor for the iOS shell (`ios/`), Vercel for hosting (production alias `golfme.app`). 6-language i18n (`src/i18n`).

**Two parallel user paths, same UI**: a real, Supabase-backed account (`isDemo === false`) and a "Try Demo Account" mock/`localStorage`-only path (`isDemo === true`, for onboarding-free exploration and App Store review). Most context files (`DataContext`, `AuthContext`, `RealRoundsContext`, etc.) branch on this flag — check both paths before assuming a change is complete.

**Current major features** (real, not mocked, unless noted): auth + onboarding; profiles/preferences/avatar/location; real-time multiplayer Golf Calls (host/join/leave, atomic overfill prevention via a row-locked RPC); DMs, blocks, reports, notifications; Golf Circle/Following + Find Friends; Community feed (posts/comments/votes, Swing Posts); real course search/discovery (Geoapify + GolfCourseAPI enrichment); Caddie — real AI swing analysis via a Roboflow (pose) + Gemini (assessment) pipeline, with persisted server-side jobs that survive the app backgrounding/resuming; GolfMe Reputation — a server-derived 13-tier progression with custom shield/flag/dimple crest badges; push notifications (direct APNs); an admin platform dashboard (`/admin/dashboard`); a Coach Reviewer system; a public pre-signup waitlist landing page.

**Where the detail lives** (read these, don't re-derive from code): `DEVELOPMENT_STATUS.md` — phase-by-phase build log, current status, exact next recommended action, every migration, manual-config checklist. `BACKEND_STATUS.md` — real-vs-mock/demo classification per feature, security audit, TestFlight readiness list. `AFTER_TESTFLIGHT.md` — deliberately deferred post-launch feature ideas, not started yet.

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

## Task routing: default model vs. the Opus specialist

Routine work (copy/text, CSS/spacing/polish, small UI changes, approved SVG/animation implementation, routine lint/type/test fixes, simple bugs with a known root cause, isolated low-risk refactors) stays on whatever model this session is already running as. Don't escalate just because multiple files are touched — escalate on architectural risk, ambiguity, security/data impact, unknown root cause, or cross-system blast radius.

Delegate to the `golfme-architect` subagent (Agent tool, `subagent_type: "golfme-architect"`, pinned to Opus) for: Caddie's persisted-job/background-resume architecture; the Roboflow+Gemini AI pipeline (pose reliability, phase detection, model-output validation); Supabase schema/migrations/RLS/security policies; auth/credential/OAuth flows; native iOS/Capacitor (keyboard, plugins, lifecycle, push/APNs, entitlements); complex debugging with an unknown root cause or cross-system interaction; architecture-wide refactors; pre-release (TestFlight/App Store) security or architecture audits.

If classification is genuinely ambiguous: inspect enough code to judge blast radius, default to handling clearly low-risk work directly, escalate if investigation reveals real architectural/security risk, and only ask the user when the classification would materially change strategy or cost — don't ask about obvious cases either way.

Frozen/high-sensitivity areas that need the specialist before any change, not just a careful Sonnet pass: Chat's CapacitorKeyboard/DirectMessageThread viewport/composer/dvh/ResizeObserver behavior (known-good on physical device); Caddie's persisted-job architecture (never move durable analysis state back into component-only/in-memory state); Reputation's scoring formula/thresholds/tier names/qualifying-round definition (visual/crest polish is fine on the default model, scoring/data architecture is not).

The parent session cannot switch its own model mid-conversation — `/model` is a human-driven command, not something callable from a tool. Delegating to a pinned-model subagent via the Agent tool is the only supported way to route part of a task to a different model.

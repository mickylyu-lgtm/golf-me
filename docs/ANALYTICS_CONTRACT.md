# GolfMe product analytics: audit and metric contract

Status 2026-11-08: **local only, nothing shipped.** Migration `20261108120000_admin_product_analytics` is prepared, not applied. The dashboard UI works without it and shows "Unavailable" until it's applied.

Scope: the admin Platform Dashboard (`/admin/dashboard`). This document is Phase A of Micky's analytics brief (2026-11-08). Its confirmed definitions are final and are not re-asked here.

## 1. Audit: what the server records today

Verified against the migrations in `supabase/migrations`. The production database was not queried.

| Source | What it keeps | Mutable? What is lost |
|---|---|---|
| `profiles` | `created_at` (signup, server default), `has_onboarded` | **No onboarding time** (no `onboarded_at`). `has_onboarded` is current state only. Rows cascade-delete with the account. |
| `golf_calls` | `created_at`, `date_iso` (tee time), `status` (open/full/completed/cancelled), `total_spots` (includes the host), `host_user_id` | **No completed_at / cancelled_at.** `updated_at` changes on any edit, so it can't date a status change. A host can edit the date (reschedules aren't kept). The row cascades if the host deletes their account. There's no client DELETE policy. |
| `round_participants` | One row per (round, golfer), unique. `participant_status` joined/left, `joined_at` | **A re-join overwrites `joined_at`** (`on conflict do update set joined_at = now()` in `join_golf_call`), so earlier joins are gone. **A leave has no timestamp.** The host's own row is auto-inserted by `host_golf_call`, so it isn't a join. |
| `messages` (DMs) | Server `created_at`, `sender_id`, `unsent_at` | Append-only (no client UPDATE/DELETE). Unsend keeps the row. Account deletion cascades the sender's messages. A failed send leaves no row. |
| `round_messages` | Same as DMs (`unsent_at` since 20261107130000) | Same as DMs. |
| `conversations` / `conversation_participants` | Who is in each DM | DMs are 1:1 in practice. The founder welcome DM is inserted by trigger `notify_founder_welcome()` with the founder as sender. **This is the only automated message**, verified by grepping every `insert into public.messages/round_messages`. |
| `community_posts` / `_comments` / `_post_votes` / `_comment_votes` | `created_at`, author/voter | **Owners can delete posts, comments and likes** (delete-own policies), so these are current rows only. Likes are unique per (post, voter). |
| `round_reviews` | `showed_up` etc., written after host completion | Reviews require `status = 'completed'`. Unique per reviewer/reviewed/round. |
| `caddie_analyses` | One row per job. `created_at` is pinned to `now()` by trigger (trustworthy). `status`; `attempt`/`finished_at`/`failure_*` since 20261107140000 | Owners can delete their own analyses. Failed rows are kept only since Phase 22. |
| `analytics_daily_counts` (20261022130100) | Anonymous +1 per event per day | **Not usable** for unique users, retention or exclusions (no user id; any signed-in client can inflate it). Its migration isn't applied either. |
| Client `lib/analytics.ts` | Dev console only (5 events go to the counter above) | Not a source. |
| Error telemetry | None server-side for send failures, video playback, auth failures or push delivery receipts | Health metrics need new tracking. |

The earlier "dashboard accuracy patch (8 tests)" was **not found**. I searched every scratchpad, all branches (`fix/dashboard-no-waitlist` is already merged), stashes by name and every worktree's `AdminDashboard.tsx` (the newest one differs only in report button labels). Nothing from it was reused.

## 2. Exclusions (applied identically everywhere)

An account is **excluded** when either of these holds:
- it's listed in `private.analytics_excluded_users` by stable auth id. Micky seeds it himself with `analytics-seed-exclusions.sql`, which looks the id up from the email he types and never guesses; or
- it holds an active `admin`, `test`, `app_reviewer`, `bot` or `seeded` role.

`pre_launch`, `coach_reviewer` and `booking_reviewer` accounts are real golfers and count.

The founder already holds `admin`, so he's excluded before seeding. Seeding pins it by id as well. Exclusion is applied at read time, so marking an account later removes it from all history. Demo sessions never create server rows.

Excluded accounts' content is never activity. **A message counts only if at least one other eligible account is in that conversation or round.** So a reply to the founder's welcome DM, or a chat with a test account, doesn't make a golfer active. This is a choice (question Q2).

## 3. Reporting conventions

- Storage is UTC. Reporting is in **America/New_York**, labelled on the page and set in one place (`private.analytics_tz()`). See question Q1.
- Ranges are calendar dates, inclusive in the UI and **half-open** on the server: `[from 00:00 ET, to+1 00:00 ET)`, using `AT TIME ZONE`, so DST is handled (23 h and 25 h days are tested).
- Ranges are at most 366 days, can't start in the future, and are flagged `partial` when they include today.
- The previous period is the window immediately before, with the **same elapsed length**, so a partial today is compared with the same part of yesterday.
- Immature cohorts are **pending (null), never 0**.
- Unavailable data is shown as Unavailable. A failed query is shown as an error with Retry, never as 0 or empty.

## 4. Metric contract

Legend: **NOW** = available now from server records. **BACKFILL** = reliable from existing records with a stated limit. **TRACK** = only after new tracking.

"Events" means `private.analytics_events` v1 (section 5). They start at apply time and are never backfilled.

### Phase B: activity and retention (`admin_analytics_activity`, `admin_analytics_retention`)

**Activity** (the headline definition) is any one of:
- a successful join of a round hosted by someone else;
- a stored DM or round-chat message from an eligible sender, into a conversation or round with another eligible account.

Hosting, posts, Caddie, browsing and app opens don't count. The dedupe key is (user, reporting day) or (user, window).

| Metric | Definition | Status | Limits |
|---|---|---|---|
| Active now | Distinct eligible users with activity in the last 5 min | NOW | Recent activity, not presence |
| Active today / 7 d / 30 d | Distinct active since ET midnight / rolling 7×24 h / rolling 30×24 h | NOW | Before events, only the latest join per (round, golfer) is dated, so older re-joins are undercounted |
| Active in range, previous period | Distinct active in range, and in the equal-elapsed previous window | NOW | same |
| New vs returning | New: first-ever activity is in the range. Returning: also active before the range. Disjoint, and they sum to active | BACKFILL | Deleted history isn't counted. "Before" uses the same sources |
| Stickiness | Average DAU over the last 30 complete ET days, and the unique users over those days | NOW | |
| D1 / D7 / D30 | Of eligible signups (cohort = `profiles.created_at` ET day) in the last 90 days: active on exactly signup day + n. Mature only when that day has fully ended; otherwise pending | BACKFILL | Join re-date limit as above |
| Onboarding completion | Cohort with `has_onboarded` / cohort size | NOW (state) / TRACK (timing) | Completion time only from events |
| Signup to first activity | Median hours from `created_at` to the first activity | BACKFILL | |

### Phase C: Golf Calls (`admin_analytics_golf_calls`)

Round-level metrics cover **rounds created in range by eligible hosts**. Joiner metrics cover **joins by eligible golfers in range, into any round**. Joins into excluded hosts' rounds are reported separately. Round ids are stable.

| Metric | Definition | Status | Limits |
|---|---|---|---|
| Rounds hosted, unique hosts | count, distinct host | NOW | Cascade-deleted with the host's account |
| Rounds joined | Distinct (golfer, round, join time) from source rows ∪ events | NOW / exact after events | Pre-event re-joins collapse to the latest |
| Unique joiners, repeat joiners | Distinct joiners; joiners on 2+ distinct rounds in range | NOW | |
| Participation rate | Rounds with ≥1 eligible non-host participant row (left rows still count as "got a join") / rounds hosted | NOW | |
| Fill rate | Σ(1 host + current eligible joined) / Σ total_spots over non-cancelled rounds | NOW (current membership) | A round that filled and then lost someone reads as not full. Peak fill needs events |
| Time to first join | Median of min(join time) − round created_at | BACKFILL | Pre-event re-joins can make it read later |
| Zero-join rounds | Non-cancelled, tee time passed, no eligible non-host row ever | NOW | |
| Upcoming | Open or full, tee time ahead (snapshot) | NOW | |
| Cancelled | Hosted in range and now cancelled. Cancel *time* from events | NOW / TRACK | |
| Played: host-confirmed | status = completed (host-marked) | NOW | Not proof of play |
| Played: participant-confirmed | A joined non-host golfer submitted a review with `showed_up = true` | NOW | Reviews need host completion, so this is a subset of host-confirmed. Overlap and the deduped total are shown |
| Estimated played | **Unavailable** until a heuristic is agreed (Q4). Past tee time is never "played" | — | |
| Co-participation pairs | Distinct pairs of eligible members (host + still-joined) of the same non-cancelled round | NOW | Not friendship, not proof they met |

### Phase D: Social (`admin_analytics_social`)

| Metric | Definition | Status | Limits |
|---|---|---|---|
| Messaging users (DM / round chat) | Distinct eligible senders of counted messages | NOW | Failed sends aren't stored |
| Messages, later-unsent | Counted messages; unsent ones still count as sent and are shown separately | NOW | |
| Messages per active user | (DM + round chat) / active users in range | NOW | |
| Two-way DM conversations | Conversations where ≥2 distinct eligible senders wrote in range | NOW | The welcome DM never qualifies |
| New two-way conversations | Conversations whose second eligible sender's first-ever message falls in range | NOW | |
| Round chat engagement | Rounds with ≥1 / ≥2 distinct eligible senders | NOW | |
| Post creators, commenters, interactors | Distinct eligible authors / commenters / (commenters ∪ post likers ∪ comment likers) | NOW (current rows) | Deleted posts, comments and likes are gone. No reactions on posts exist beyond likes |
| % active in Community; % active messaging | Active ∩ community users / active; active ∩ messaging / active | NOW | Messaging is itself activity (shown separately on purpose) |

### Phase E: Caddie (`admin_analytics_caddie`, minimal)

Built now: analyses (jobs), unique users, **repeat users** (2+ in range), returning users, and complete/failed/processing counts.

Planned, not built:
- median processing time (`finished_at − created_at`; needs 20261107140000, which is applied, but not tested here);
- failure rate by category (already on the dashboard via `admin_caddie_failure_stats`);
- stuck vs pending.

Jobs vs attempts: one row is one job, and `attempt` counts retries on the same row.

### Phases F and G: health and live feed (planned, not built)

These need new tracking. None of it exists server-side today:
- message send failures (client-side today);
- video playback failures;
- auth failures;
- APNs acceptance (provider acceptance is not device receipt);
- API errors.

Proposed `private.analytics_events` v2 types, plus a small `track_client_failure(kind, code)` RPC: authenticated, rate-limited, with an idempotency key, no content and no URLs. Every rate needs an attempt denominator.

The live feed would be an admin RPC over the event log plus source rows (rounds created, joins, posts, Caddie completions, new two-way conversations), paginated and with no private text.

## 5. New storage (migration 20261108120000)

- `private.analytics_excluded_users` (user_id PK → auth.users cascade, reason, note). RLS on, no policies, no client grants.
- `private.analytics_meta` (records `events_tracking_started_at`).
- `private.analytics_events` v1:
  - `event_type` is one of: round_joined, round_left, round_completed, round_cancelled, onboarding_completed;
  - `occurred_at` is server transaction time; `idempotency_key` is unique;
  - `user_id` cascades on account deletion; `round_id` is a plain uuid, so a joiner's history survives the host deleting their account.
  - Written only by AFTER triggers in the same transaction, so a rolled-back join writes nothing. Each capture sits in its own exception block, so a capture failure can't fail a join, leave, status change or onboarding (tested).
- Indexes on `created_at`/`joined_at` of messages, round_messages, round_participants, golf_calls, profiles, comments and votes.
- All RPCs are SECURITY DEFINER with `search_path = ''`. The admin role is checked first (`42501`). Execute is revoked from public/anon; helpers are private with no client execute.

## 6. Tests actually run (local PGlite, synthetic fixtures)

- `scratchpad/pglite/_analytics.mjs`: **96/96**. Covers:
  - capture: re-join keeps both times; the host row is not a join; a rolled-back join leaves no event; onboarding idempotent; the capture-failure path;
  - authorization: 6 RPCs × non-admin / founder-without-admin / anon, plus direct table/function access as admin and as a user;
  - range validation; DST start/end windows and minute boundaries;
  - every metric above against hand-counted fixtures, including exclusions, founder welcome DMs, test-account chats, unsent messages, retroactive exclusion, and pending cohorts;
  - a 20k-message timing check and an index-plan check (informational, PGlite is not production).
- `scratchpad/pglite/_analytics_paste.mjs`: **14/14**. Apply-file lifecycle: check false → apply → check all true → second apply refused → seed by email (case-insensitive, unknown email refused, idempotent) → rollback → joins still work → re-apply.
- Existing `_funnel.mjs` over the full chain: 8/8.
- `npm run check`: tsc, oxlint, 1182/1182 node tests (incl. `tests/adminAnalytics.test.ts`), build.
- Headless Chromium on the preview build with a mocked backend (`scratchpad/analytics/shots/run.mjs`): **35/35**. Covers:
  - the not-set-up notice;
  - numbers changing after 30 s without a reload;
  - range switch refetch;
  - failure → last numbers kept + Retry + Stale;
  - hidden → Paused with no requests, refresh on return;
  - a failed users list shows an error, not "No registered users yet.";
  - no Suspend on self or another admin;
  - no horizontal scroll at 390 px and 1280 px.

Not tested: the production database, real data volumes and query plans on Postgres 15/17, a real iPhone, and long-running sessions.

## 7. Operating cost (assumptions stated)

Assumptions:
- Supabase Pro ($25/month base, 8 GB database and 250 GB egress included, Micro compute). Check your current plan in the dashboard.
- About 100 golfers today; a dashboard open for at most 2 hours a day.

- **Storage.** Events are about 250 B per row with indexes. Expect around 2–5k rows a year at today's scale (well under 5 MB), or about 1M a year at 10k very active golfers (about 250 MB). The new indexes are small, under 1% of the tables.
- **Compute.** The panel makes 6 RPCs every 30 s and the totals 12 RPCs every 60 s, only while the page is visible: about 1,400 + 1,400 calls per open hour. Each is milliseconds at today's size.
- **Scaling hotspot.** "New vs returning" scans all activity before the range. It grows with the history of messages and joins. Past roughly 1M messages, add an incremental per-user first-activity table.
- **Realtime.** None used, so it costs nothing.
- **Egress.** About 3 KB per analytics response plus the existing lists: under 10 MB per open hour.
- **Telemetry.** None added yet.
- **Expected extra cost: $0 at the current plan and scale.** No paid service is used.

## 8. Questions for Micky

1. **Timezone.** Report in America/New_York (ET)? It's a one-line change later.
2. **Recipient rule.** Should a message count as activity only when another real golfer is in the chat? This is the current rule. It means replies to your welcome DM don't count.
3. **Event retention.** Keep `analytics_events` for 25 months, then purge with a pg_cron job (proposed, not scheduled)? Account deletion already removes a golfer's events.
4. **Estimated played.** Any heuristic you'd accept (for example, host-confirmed or golfer-reviewed only, or "tee time passed + ≥2 members + not cancelled", labelled estimated)? Until then it shows Unavailable.
5. **Participant-confirmed.** Accept "a joined golfer's review said someone showed up" as participant confirmation, or build an explicit "I played" tap later?

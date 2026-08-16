# GolfMe — Backend Status (Phase 6 audit)

> Snapshot as of 2026-08-14, end of Phase 6. Read `DEVELOPMENT_STATUS.md` for the phase-by-phase build log; read this file for "is X actually real, and is it safe to ship to TestFlight."
>
> **Phase 7 addendum (2026-08-16, not yet a full re-audit):** Golf Circle/Following and Community are no longer accurate as written below — both now have real Supabase backends (real `follows` table; real `community_posts`/`community_comments`/`community_post_votes`/`community_comment_votes`/`saved_posts`/`hidden_posts` + a `community-media` Storage bucket for photos/swing videos). A real-vs-demo username/Find Friends search feature (`search_golfer_profiles()` RPC) also shipped. See the corrected rows below (marked "Phase 7") rather than treating the rest of this file's Phase 6 snapshot as stale — everything else here is still current. This addendum is not a substitute for a full re-audit; the RLS coverage, security audit, and TestFlight sections below were not re-verified against the Phase 7 changes.

## How to read the classification below

- **REAL** — backed by Supabase (Postgres + RLS, Storage, or an Edge Function), persists across devices/sessions for a real account, no fabricated data.
- **LOCAL** — persists, but only in that browser's `localStorage` on that one device. Not synced, not backed up, lost if storage is cleared.
- **DEMO-ONLY** — exists only inside the "Try Demo Account" mock world; a real account never touches this code path for this feature.
- **MOCK** — a real account *does* reach this feature, but the feature itself is still backed by the shared in-memory/localStorage mock data, not a real per-account backend.
- **EXTERNAL API** — depends on a live third-party provider and its own uptime/quota.
- **PENDING** — schema/plumbing exists but the feature isn't wired to real UI yet, or is explicitly deferred.

## E — System classification

| System | Classification | Notes |
|---|---|---|
| Auth (Google OAuth + email magic link) | **REAL** | Supabase Auth. Demo mode is a separate, explicit opt-in flag, never the default. |
| Account/session state (AUTHENTICATED vs ONBOARDED) | **REAL** | Driven by `auth.users` + `profiles.has_onboarded`. |
| Profile (name, bio, handicap, preferences, skill level, language) | **REAL** | `public.profiles`, RLS: any authenticated user can read, only the owner can write. |
| Avatar upload | **REAL** | Supabase Storage `avatars` bucket, per-user folder, public read. |
| Location | **REAL** | `playing_area_lat/lng` + `area_label` on `profiles`, written via the same real save path as other preferences. See security note below — this is broadly readable. |
| Reputation shown for a brand-new real account | **REAL** | Genuine zeros / "Building Credibility" — never fabricated. |
| Course search/discovery | **EXTERNAL API** (Geoapify, location discovery) via **REAL** Edge Function + cache | `course-search` Edge Function, results written through `upsert_external_course()` into `public.courses`/`course_external_ids`. **Not yet returning real results in production** — `GEOAPIFY_API_KEY` still needs to be set as an Edge Function secret (open since Phase 3, see Manual configuration below). |
| Course detail enrichment (holes, etc.) | **EXTERNAL API** (GolfCourseAPI, name-based) via **REAL** Edge Function, on-demand | `course-enrich` Edge Function (added 2026-08-16). GolfCourseAPI has no location search at all (confirmed live) so it can only enrich a course Geoapify already found, never discover one on its own. `GOLF_COURSE_API_KEY` is set and working; blocked on the same `GEOAPIFY_API_KEY` gap above, since there's nothing to enrich until Geoapify can discover a course to begin with. |
| Hosting/joining/leaving/cancelling a Golf Call | **REAL** | `public.golf_calls` + `round_participants`, atomic overfill prevention via `join_golf_call()` (`for update` row lock), Realtime cross-device sync. |
| Round completion | **REAL** | Host-only, RLS-enforced (`golf_calls_update_host`), simple status flip by design ("keep beta logic simple") — no auto-detection of "the round happened," no state-machine guard against e.g. completing a round in the future. Acceptable for beta scope. |
| Round reviews | **REAL** | `round_reviews`, all four rules DB-enforced (not just app-checked): same completed round required, can't review self (`CHECK` constraint), one review per reviewer/round/reviewee (`UNIQUE` constraint), review blocked until `golf_calls.status = 'completed'`. |
| Credibility (Completed Rounds, Would Play Again %, Show-Up %, On-Time %, Handicap Confidence) | **REAL** | `get_credibility_stats()` computes live from `round_participants`/`round_reviews`, never fabricates a non-zero baseline. |
| Direct messages | **REAL** | `conversations`/`conversation_participants`/`messages`, Realtime sync. |
| Block / report | **REAL** | Blocking enforced at the database (`messages` INSERT policy), not just hidden in the UI. Reports persist with a `status` field for future moderation. |
| In-app notifications | **REAL** | Trigger-generated (`round_joined`/`round_left`/`round_cancelled`/`new_message`), never client-authored. Bell open/close/outside-click/Escape UX untouched since Phase 5. |
| Account deletion | **REAL**, code-complete, **not yet verified end-to-end** | `delete-account` Edge Function, deletes the caller's own `auth.users` row (never a client-supplied id) via the service-role key held server-side only; cascades through every owned table. CORS bug fixed and redeployed this phase (see Security audit). Live re-verification blocked today by Supabase's auth email rate limit — see Two-account test results. |
| Community (posts/comments/votes) | **REAL** (Phase 7, 2026-08-16) | `community_posts`/`community_comments`/`community_post_votes`/`community_comment_votes`/`saved_posts`/`hidden_posts`, all RLS-enforced, real Realtime sync across accounts. Demo mode's original `localStorage`-backed implementation still exists unchanged (renamed `demoX`) and is used only when `auth.isDemo`. Root cause of the original "posts fail to publish" bug: `createPost()` attributed every post's `authorId` to a fixed mock placeholder (`data.currentUserId`) instead of the real signed-in user's id — same class of bug as the earlier Follow fix, not an RLS or upload failure. |
| Swing Posts (video + analysis) | **REAL storage, PENDING analysis** (Phase 7) | Real video upload to the `community-media` Storage bucket (200MB cap). `swing_analysis_status` is stored but no code path ever produces a result — `src/lib/swingAnalysis.ts`'s only provider always throws rather than fabricating measurements; UI shows an honest "Swing analysis processing" placeholder. Provider-ready architecture, not a real CV/AI integration yet. |
| Find Friends / username search | **REAL** (Phase 7) | `profiles.username` (format-checked, case-insensitive-unique partial index) + `search_golfer_profiles()` RPC returning a deliberately narrow field set (not the same broad `SELECT *` the rest of `profiles` allows — see the broad-read risk noted below). |
| Chat on a real Golf Call round | **MOCK** | Explicitly deferred in Phase 4 — a real round's chat tab is a local, non-synced mock thread. |
| Fill My Foursome (friend-invite hosting) | **DEMO-ONLY** | Needs a real Golf Circle/Following graph that doesn't exist yet; real hosting is "Starting Fresh" + instant-join only (approved scope trim, Phase 4). |
| Request-to-join (approval flow) | **DEMO-ONLY** | Real Golf Calls are instant-join only; `golf_calls.join_mode` is currently locked to `'instant'` by a `CHECK` constraint. |
| Golf Circle / Following | **REAL** (Phase 7, 2026-08-16) | `public.follows`, composite PK, `follows_no_self` check constraint preventing self-follow, RLS scoped to `follower_id = auth.uid()` for writes. Demo mode's original implementation still exists unchanged (renamed `demoX`) for `auth.isDemo`. |
| Live tee-time inventory / booking | **PENDING** | `tee_time_source`/`tee_time_provider`/`external_tee_time_id` columns exist and are reserved for this, but every real round's tee time is user-entered text (`tee_time_source` locked to `'user_entered'`) and never presented as live availability. Out of scope for Phase 6 per explicit instruction — no work done here this phase. |
| Push notifications (device) | **PENDING** | In-app notifications only; no APNs/FCM integration. |
| Payments | **PENDING** | Not built. |
| Apple Sign-In | **PENDING** | Google + email only. |

## G — Security audit

### RLS coverage
All 11 `public` tables have RLS enabled (`list_tables` verified). No table is world-writable; every INSERT/UPDATE policy scopes to `auth.uid()` except the intentionally-shared `courses` cache (any authenticated user can read/write course records — a reference cache, not user data, no per-user ownership to enforce) and `golf_calls`/`round_participants` SELECT (any authenticated user can see all open rounds — required for Discover/Find to work, matches the old mock's `visibleGolfers()`-style openness).

### Bugs found and fixed this phase
1. **CORS preflight rejected on both Edge Functions (`delete-account`, `course-search`).** Neither had ever been successfully callable from a real browser — `supabase.functions.invoke()` (and any `fetch()`) triggers a CORS preflight `OPTIONS` request that both functions rejected with a bare 405 and no `Access-Control-Allow-*` headers, so the browser never sent the real request at all. This wasn't a subtle edge case; it made both functions completely unusable from the shipped app regardless of auth correctness. Caught via a live browser-context `fetch()` test (a `curl`-only test never triggers a preflight and would have missed this). Fixed by adding proper CORS headers + an `OPTIONS` short-circuit to both, redeployed (v2), reverified via direct `OPTIONS` requests — both now return `204` with correct `Access-Control-Allow-Origin/Headers/Methods`.
2. **`conversation_other_participants()` was directly callable by any signed-in user, with no membership check, and leaked DM participant identities.** It's a `SECURITY DEFINER` helper meant only to be evaluated from inside RLS policies (same pattern as the Phase 5 recursion fix), but Postgres grants `EXECUTE` to `PUBLIC` by default, and it didn't verify the caller was actually a participant of the conversation ID passed in — any authenticated user could call `/rest/v1/rpc/conversation_other_participants` with a guessed/observed conversation ID and get back who else is in that DM thread. First fix attempt (revoking `EXECUTE` outright) broke real messaging, because unlike trigger functions, functions called inside a policy's `USING`/`WITH CHECK` clause are ordinary calls that still need `authenticated` to hold `EXECUTE` — that's a different mechanism than the Phase 5 trigger-function lockdown. Corrected by moving both `conversation_other_participants()` and `is_conversation_participant()` into a new `private` schema that PostgREST never exposes as an API route, while re-pointing the 4 policies that use them at the new location and re-granting `EXECUTE`/`USAGE` so RLS evaluation still works. Verified: the direct RPC route now 404s; messaging (insert into `messages` under a simulated real session) still succeeds; `get_advisors` no longer flags either function.

### Reviewed and confirmed correct (no change needed)
- `round_reviews` has exactly one SELECT policy (`reviewer_user_id = auth.uid()`) — a reviewed golfer **cannot** read the raw reviews written about them, including `private_note`, only the aggregated stats `get_credibility_stats()` exposes (percentages/counts, never free text or who-said-what).
- `reports` — only the reporter can read their own reports; no policy lets a reported user see who reported them.
- `blocks` — visible only to the two parties involved.
- Storage (`avatars` bucket) — public read (needed, avatars are meant to be visible), insert/update/delete scoped to the caller's own folder via `auth.uid()`.
- `delete-account` derives the account to delete from the caller's verified JWT (`auth.getUser()`), never a client-supplied id — it can only ever delete the caller's own account. Service-role key is a Supabase-managed Edge Function secret, never sent to or embedded in the browser bundle.
- `join_golf_call()`/`leave_golf_call()`/`host_golf_call()`/`submit_round_review()`/`get_or_create_dm_conversation()`/`get_credibility_stats()` all still show up on the security advisor as "callable by authenticated users" — this is correct and intentional for all six; they're the sanctioned direct-RPC mutation/read path by design, not an internal-only helper like the two functions fixed above.
- `get_or_create_dm_conversation()` blocks conversation creation between two users with an existing block in either direction, at the database level.

### Known, accepted risk — flagging, not fixing without your sign-off
- **`profiles` is broadly readable**: `profiles_select_authenticated` (`qual = true`) lets any signed-in user read every column of every profile, including `playing_area_lat`/`playing_area_lng` — a precise home/primary-location coordinate pair, not just a city label. This mirrors the old mock's fully-open `visibleGolfers()` behavior and is what powers distance-based discovery, so it's not a regression, but it's more precise than most apps expose broadly. Narrowing this would need either a Postgres view with a fuzzed/rounded location column (exposed instead of the raw table) or column-level grants, which is a real schema change I have not made — flagging for your decision rather than silently changing what discovery/distance features can see.
- **Leaked-password-protection is disabled** in Supabase Auth settings (HaveIBeenPwned check). One-click toggle in the dashboard, not something the MCP tools can flip. Only matters if/when a password-based auth method is ever added — currently OAuth + magic link only, so no password exists to leak.

## H — Two-account test results

Consolidated across Phases 4-6 (Phases 1-3's own test results are in `DEVELOPMENT_STATUS.md`).

| Flow | Verified how | Result |
|---|---|---|
| Two real accounts, independent login/session | Live Playwright, two browser contexts | Pass (Phase 1/4) |
| Host a round, second account discovers and joins | Live Playwright, two real accounts | Pass (Phase 4) |
| Concurrent join race on the last spot | Direct SQL, simulated concurrent `join_golf_call()` calls | Pass — Postgres row lock serializes them, no overfill (Phase 4) |
| Leave / cancel, Realtime reflects on both devices | Live Playwright | Pass (Phase 4) |
| DM between two real accounts | Live Playwright | Pass (Phase 5) |
| Block prevents new messages | Live SQL simulation (`set local role authenticated` + JWT claim) | Pass (Phase 5) |
| Report persists | Live Playwright | Pass (Phase 5) |
| Notification bell UX (open/close/outside-click/Escape) unchanged | Live Playwright, re-verified after Phase 5 changes | Pass |
| Conversation RLS (post-fix) still lets real participants message | Live SQL simulation, this phase | Pass — see Security audit bug #2 |
| Host marks round completed | Code review + RLS policy check (`golf_calls_update_host`) | Confirmed host-only by RLS, not just app logic |
| Submit review — same-round, no self-review, one-per-person, post-completion-only | Live SQL simulation of `submit_round_review()` plus DB constraint inspection | Pass — all four rules are DB-enforced (function checks + a `UNIQUE(round_id, reviewer_user_id, reviewed_user_id)` constraint + a `CHECK(reviewer_user_id <> reviewed_user_id)` constraint), not just app-level |
| Credibility reflects real review data, never fabricated for a new account | Live SQL call to `get_credibility_stats()` | Pass |
| Refresh / re-login persistence for all of the above | Live Playwright reload | Pass |
| CORS preflight on both Edge Functions | Direct `OPTIONS` request with `Origin` header | Pass, this phase (previously failing — see Security audit bug #1) |
| Account deletion, full live browser flow | **Not completed** | Blocked by Supabase's auth email-send rate limit hit during today's testing (`429 over_email_send_rate_limit`) when trying to re-establish a session for the throwaway test account (`golfme-phase6-deletetest@mailinator.com`, still exists, not yet deleted). The deletion logic itself is unchanged code (only CORS headers were added around the same `auth.getUser()` + `admin.deleteUser()` body that existed before), so this is a retest-when-unblocked item, not an unknown. |

## Manual configuration still required (carried forward + new)

- `GEOAPIFY_API_KEY` Edge Function secret — still not set (open since Phase 3). Real course search returns a clear "not configured" error, never fake data, until this is set.
- Google OAuth provider enablement in the Supabase dashboard.
- Google Cloud Console OAuth client setup for the production domain.
- Supabase Auth redirect URL configured for the Vercel production domain.
- (Optional, low priority) Enable leaked-password-protection in Supabase Auth settings — no effect until/unless password auth is added.

## I — TestFlight readiness

### BLOCKING TestFlight
- Finish live-verifying account deletion end-to-end once the email rate limit clears (code is believed correct — CORS was the only proven bug — but "believed" isn't "verified").
- Set `GEOAPIFY_API_KEY` so course search returns real results instead of a configuration error.
- Complete Google OAuth manual configuration (provider + Cloud Console client + redirect URL), or ship with email-only auth for the first TestFlight build if Google sign-in isn't ready in time.
- Confirm production Vercel env vars (`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`) are set for Production (done earlier in this project, but reconfirm before the TestFlight-linked build is cut).
- Community and Golf Circle/Following are now real (Phase 7, see addendum) — this line is superseded, kept for historical record.

### SAFE TO DO AFTER FIRST TESTFLIGHT
- Direct tee-time booking / live tee-time provider integration.
- Payments.
- A more sophisticated credibility algorithm (current one is simple, honest, and correct — just not fancy).
- A real CV/AI swing-analysis provider behind the `SwingAnalysisProvider` interface (currently provider-ready only, see Phase 7 addendum).
- Apple Sign-In.
- Push notifications (APNs).
- Fill My Foursome for real rounds, request-to-join approval flow (Following now exists for real accounts, but these two features aren't built on top of it yet).
- Real chat on real Golf Call rounds.
- Narrowing `profiles`' broad-read location precision (flagged above), if you decide it's worth doing before a wider public launch.

### What beta does NOT need (explicitly, per your own scoping)
Direct tee-time booking, live tee-time provider, payments, a sophisticated credibility algorithm, a real swing-analysis provider, Apple Sign-In, push notifications.

### What beta DOES need (all confirmed REAL and verified above)
Real auth, account isolation, real profiles, real location, real course search (pending the API key), real Golf Calls with join/leave, real messaging, block/report basics, real notifications, avatar upload, round completion, reviews, real basic credibility, a stable mobile flow.

## J — TestFlight readiness test script

Run this on a real device (or two, for the two-account steps) against the production Vercel build, not local dev.

1. **Cold install.** Open the app with no prior session. Confirm it lands on Welcome, not a crash/blank screen (this is the exact failure mode from the earlier "website crashed" DNS incident — confirm it's actually the app loading, not a network error page).
2. **Sign up (Account A).** Email magic link (or Google, if configured by then). Confirm the confirmation-email state, then confirm clicking the link lands back in the app, signed in, routed to profile setup.
3. **Complete profile setup (Account A).** All 4 steps, including a real location pick and an avatar upload. Confirm avatar actually appears (Storage round-trip).
4. **Repeat steps 2-3 for Account B** on a second device (or a fully separate browser profile/incognito context — must not share Account A's session).
5. **Course search (Account A).** Search a real city. Confirm real results appear (requires `GEOAPIFY_API_KEY` to be set) — if it shows a "not configured" error instead, that's a blocking-item failure, not a crash to panic about.
6. **Host a round (Account A)**, using a real searched course.
7. **Discover and join (Account B).** Confirm the round appears in Account B's Discover/Find, join it, confirm Account A sees the join reflected without restarting the app (Realtime).
8. **Notification check.** Account A should have a real "round joined" notification. Open the bell, confirm open/close/outside-click/Escape all still behave exactly as before.
9. **Message (Account B -> Account A).** Send a DM. Confirm Account A receives it live.
10. **Block test.** Account A blocks Account B. Confirm Account B can no longer send a message (should fail visibly, not silently).
11. **Unblock**, confirm messaging resumes.
12. **Report test.** Account B reports Account A. No crash, confirm a toast/confirmation.
13. **Complete the round (Account A, as host).** Tap "Mark Round Completed."
14. **Leave reviews.** Both accounts review each other. Confirm: can't review before completion (should already be impossible — step 13 must come first), can't review yourself, submitting twice for the same person/round is rejected.
15. **Credibility check.** Both accounts' profile/reputation pages should now show real numbers (not "Building Credibility / 0 Completed Rounds" anymore), matching what was actually submitted in step 14.
16. **Refresh / force-quit and reopen both apps.** Confirm every above state (profile, round, messages, block state, reviews, credibility) survives — this is the "not just an optimistic UI update" check.
17. **Account deletion (use a throwaway account, not A or B).** Settings -> Danger Zone -> Delete Account. Confirm the account is actually gone (cannot log back in with that email) and the app returns to Welcome.
18. **Demo mode regression, last.** "Try Demo Account" from Welcome. Confirm 100% of demo behavior is unchanged — this is the one thing that must never regress across any phase.

If steps 1-17 all pass and the BLOCKING TestFlight items above are cleared, GolfMe is ready for a private TestFlight build.

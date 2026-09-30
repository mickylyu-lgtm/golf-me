# GOLFME LAUNCH STATUS

**Target:** First public App Store launch (plus golfme.app, already live with open signup)
**Last updated:** 2026-09-29 (evening) — Privacy Policy rewrite + App Store privacy mapping drafted (task T-20260929-12042, not yet committed); new location-privacy blocker found. Initial audit earlier the same day.

Statuses: `[ ]` NOT STARTED · `[~]` IN PROGRESS · `[?]` NEEDS VERIFICATION · `[!]` BLOCKED · `[x]` COMPLETE (only with evidence it works).
Classify every request: **A** fixes a launch blocker · **B** improves launch quality · **C** nonessential, probably after launch.

### CURRENT LAUNCH BLOCKERS
0. **NEW — Users' device locations are readable by every signed-in member.** When someone allows location, `LocationPicker.tsx` saves raw device coordinates to `profiles.playing_area_lat/lng` (12 of 23 profiles have 12–13 decimal places). The profiles SELECT policy is `using (true)` for all authenticated users, and signup is open, so anyone can create an account and read approximate home locations through the API. **Fix (D1, approved):** `[~]` **database side LIVE and verified 2026-09-30.** Migration `20260930090000_coarsen_profile_location` (trigger + backfill) applied after Micky approved the SQL: 23 profiles, 0 with more than 2 decimals; trigger rounds precise writes; an authenticated non-owner sees at most 2 decimals; no side effects. No precise profile coordinates remain in production. Remaining: ship the client rounding (`coarseLocation.ts` + `LocationPicker` + `FindRoundModal`, uncommitted; the trigger already covers the current client), then a device check that "Use My Current Location" and nearby discovery still work. (A)
1. **Privacy Policy is inaccurate** → `[~]` **rewrite ready** (`src/pages/PrivacyPolicy.tsx`, uncommitted) plus the App Store mapping in `APP_STORE_PRIVACY.md`. It discloses Vercel Web Analytics, push tokens and APNs previews, every profile field, who can see what, Canada storage and 18+. The D1 database fix is now live, so the "rounded to about 1 km" statement is true; it ships with the client rounding in the same commit. D2 resolved: the review gate now redacts only the hash-listed published contact address (no allowlist; other PII still blocks), so GPT can review the policy text. (A)
2. **No public Support URL.** App Store Connect requires one. `/help` exists but sits behind login; there is no public support page. (A)
3. **Apple UGC rules (Guideline 1.2) not demonstrably met.** Report and block exist in code, but production has 0 reports and 0 blocks ever, so neither has been exercised. There's no signup-time acceptance of the Terms (Apple expects users to agree to terms with no tolerance for objectionable content), and no content filtering beyond reports. (A)
4. **No real upcoming rounds.** Production has 0 upcoming rounds, and the 10 open/full rounds are all past-dated (hidden from Play). A new user from the App Store finds nothing to join. (A — marketplace, not App Review)
5. **The two-account real-device QA has never been run end to end** (section 9). That includes round-join push (only 1 device token exists in production: Micky's), push-tap deep links, and in-app account deletion (Apple requires it). (A)
6. **App Store listing not started.** No screenshots, description, keywords, App Privacy answers, age rating, review notes, or release-candidate build. (A)

### NEEDS VERIFICATION
The App Review password account still signs in (the demo button is no longer visible to reviewers), Home, discovery, host/join/leave/cancel round, search and filter, profile viewing, follow, DM creation from a profile, logout and account switching, account deletion, push-tap deep links, foreground push, duplicate-push prevention, round-join push, Caddie completion push, denied-permission fallback, report/block, and Caddie failure states in the UI.

### READY
Email and Google signup/login with onboarding (fresh incognito tests, 2026-09-28) · golfme.app open signup (live, verified) · DM messaging + native DM push with previews (device test + `send-push` 200s, 2026-09-29) · Terms of Service at `/terms` (live, verified) · Page-not-found for unknown URLs (live) · Caddie pipeline (57 complete, 0 failures in 30 days, daily limit enforced in DB + Edge Function) · private Caddie storage for new uploads · no secrets in tracked files or git history (patterns scanned) · only the anon key and URL reach the frontend · GPT Review Gate working (P0 + P1, pilot shipped).

### NEXT 3 ACTIONS
1. **Ship the location-privacy commit** (client rounding + Privacy Policy + App Store mapping + hidden demo button; the DB fix is already live) after GPT DONE and Micky's approval, then a quick device check of "Use My Current Location" and nearby discovery. (A)
2. **Add a public `/support` page and a Terms-acceptance line at signup** ("By continuing you agree to the Terms and Privacy Policy", with zero tolerance for objectionable content in the Terms). (A, small)
3. **Micky: host 3–5 real NYC rounds, then run the two-account real-device QA** (section 9), including report, block and account deletion on a throwaway account. (A)

---

## 1. CORE PRODUCT
| Status | Item | Evidence / notes |
|---|---|---|
| [x] | Email signup/login | Fresh incognito email signup completed onboarding into the real app (Micky, 2026-09-28). Custom SMTP via Resend. |
| [x] | Google signup/login | Fresh incognito Google signup completed onboarding (Micky, 2026-09-28). OAuth consent "In production". |
| [x] | Onboarding | Same two tests. 18+ checkbox required (`ProfileSetup.tsx`). |
| [x] | Profile setup (first-run) | Same two tests. |
| [?] | Profile editing / avatar / location | Code exists; no recent device check. |
| [?] | Home | No recent device check. |
| [?] | Golfer discovery | Real distance and server stats fixed in Batch E (P2-1/P2-2); not device-verified. |
| [?] | Host round | Past-date guard (Batch F3) verified headless in demo only; no real round created in production in 7+ days. |
| [?] | Join round | Row-locked join RPC exists; no real join recently. |
| [?] | Leave / cancel round | `guard_leave_golf_call` migration (Batch C); not device-verified. |
| [?] | Search / filter | Not verified. |
| [?] | Profile viewing | Not verified. |
| [?] | Follow / Golf Circle | Follows real (Phase 7); Circle = followed + played together (P2-11); not verified. |
| [?] | DM creation from a profile | DMs exist (5 in the last 7 days); creation path from a golfer profile not re-verified. |
| [x] | Messaging | Real DMs exchanged between two accounts 2026-09-29, push delivered. |
| [?] | Notification tap → correct screen | `pushNotificationActionPerformed` routes `link_to` (`App.tsx`); tap behaviour not explicitly confirmed on device. |
| [?] | Logout / account switching | Token deleted on logout; `register_device_push_token` moves the token to the signed-in account; not device-verified. |
| [?] | Account deletion | `delete-account` v23 (purges storage incl. private Caddie bucket); not re-tested since the private-bucket change. **Apple requires this.** |

## 2. PUSH NOTIFICATIONS
| Status | Item | Evidence / notes |
|---|---|---|
| [x] | Server config | `PUSH_INTERNAL_SECRET` matches Vault (fingerprint-verified); all `APNS_*` secrets set; production APNs. |
| [x] | DM push, app backgrounded or closed | Micky's device test 2026-09-29; `send-push` returned 200 at 04:57 and 04:58 UTC. |
| [x] | DM preview text | `20260929120000_dm_push_message_preview` applied; short and long messages tested on device. |
| [?] | DM push while app in foreground | Not tested (iOS may suppress foreground banners unless handled). |
| [?] | Tap → correct chat | See Core Product; not explicitly confirmed. |
| [?] | Duplicate-notification prevention | One token per device via RPC; not tested with multiple devices or accounts. |
| [?] | Device token / account switching | RPC exists; not tested. |
| [?] | Denied-permission fallback | `checkPushPermission` returns `unavailable`/`denied`; in-app notifications still work; not tested. |
| [?] | Round join notification | Trigger `notify_round_joined` sends push; never exercised (only one device token in production). |
| [ ] | Round update / cancel push | Not implemented (V1 was joins only). In-app notifications only. (C unless you decide otherwise) |
| [ ] | Round (group) chat push | Not implemented; separate decision. (C) |
| [?] | Caddie completion push | Trigger sends push; 2 completion notifications in the last 7 days, push delivery not confirmed. |

## 3. CADDIE
| Status | Item | Evidence / notes |
|---|---|---|
| [x] | Video upload | New uploads go to the private `caddie-media` bucket (validated live 2026-09-25); 57 analyses complete. |
| [?] | Supported video handling | 200 MB cap, clip-length and trim-window caps in `analyze-swing`; unusual formats not tested. |
| [x] | Processing state | Persisted server-side jobs survive backgrounding (architecture validated earlier). |
| [?] | Failure states | Failure UI exists (`Caddie.tsx`, `CaddieAnalysisDetail.tsx`); 0 failures in 30 days, so not observed recently. |
| [x] | Analysis completion | 57 complete, 0 failed. |
| [x] | Result persistence | Stored in `caddie_analyses`, media by path with signed URLs. |
| [?] | Confidence handling | Callouts only on high/medium-confidence phases (P2-8); not re-verified on device. |
| [x] | Production cost safeguards | Daily limit per user enforced by a BEFORE INSERT trigger and in the Edge Function; size caps. |
| [~] | Stuck analyses | 2 rows stuck (`449a5520` pending since 08-18, `212bf24f` processing since 09-18). Cleanup + auto-fail after 30 min recommended. (B) |
| [ ] | Historical media backfill to the private bucket | Dry run done; COPY needs approval. Legacy media not anonymously listable. **Post-launch.** (C) |

## 4. APP STORE
| Status | Item | Evidence / notes |
|---|---|---|
| [?] | Final icon | `AppIcon-512@2x.png` (1024) exists; confirm it's final. |
| [ ] | Six screenshots | Not started. Concepts: 1 Find Your Next Round · 2 Never Golf Alone · 3 Meet Golfers Who Match Your Game · 4 Plan the Round Together · 5 Your AI Golf Caddie · 6 Build Your Golf Network. Real UI as template; replace real names, photos, messages and PII with fictional demo content. The real Caddie analysis screen may be the base for #5. |
| [~] | App name | Display name "GolfMe" in `Info.plist`; App Store name availability to confirm. |
| [ ] | Subtitle | |
| [ ] | Promotional text | |
| [ ] | Description | |
| [ ] | Keywords | |
| [ ] | Category | Suggest Sports (primary), Social Networking (secondary). |
| [!] | Support URL | No public support page (`/help` is behind login). |
| [~] | Privacy Policy URL | `https://golfme.app/privacy` is public; the accurate rewrite is drafted, waiting on D1 before shipping. |
| [x] | Terms URL | `https://golfme.app/terms` live 2026-09-29. |
| [~] | App Privacy disclosures | Full mapping with evidence in `APP_STORE_PRIVACY.md`: Name, Email, Coarse Location (after D1), Messages, Photos/Videos, Audio, Other User Content, User ID, Device ID (push token), Product Interaction (not linked, Analytics), Other Data; Tracking = No. Enter in App Store Connect after D1 ships. |
| [ ] | Age rating | Social app with user-generated content and chat → likely 17+ unless moderation changes the answers. |
| [ ] | App Review notes | Explain: social golf app, real accounts, demo account available, push, AI swing feedback. |
| [~] | Review / demo credentials | `scripts/setup-apple-review-account.ts` exists; "Try Demo Account" on the login screen. Confirm the reviewer account works. |
| [~] | Permission strings | Location, photos, camera and microphone descriptions present in `Info.plist`. Consider adding `ITSAppUsesNonExemptEncryption = NO` to skip the export question on each upload. (B) |
| [ ] | Final release-candidate build | Not built. The current TestFlight build has the push entitlement; Beta App Review / public link status to confirm. |

## 5. LEGAL / TRUST
| Status | Item | Evidence / notes |
|---|---|---|
| [~] | Privacy Policy | Rewrite drafted 2026-09-29 (10 disagreements fixed, listed in `APP_STORE_PRIVACY.md`); headless-verified; ships with D1. |
| [~] | Location privacy | Raw coordinates were stored and readable by all members. The migration is live and verified 2026-09-30 (0 precise values; non-owner sees at most 2 decimals). No other API path returns user coordinates. Client rounding ships with the task commit; device check pending. |
| [x] | Terms of Service | Live at `/terms` (approved by Micky, GPT review DONE). |
| [?] | Account deletion | In Settings → `delete-account` v23; re-test needed. |
| [?] | Report user / content | `reports` table + UI exist; never used in production. Check who receives reports and how quickly. |
| [?] | Block user | `blocks` table, blocks enforced for rounds (Batch C); never used in production. |
| [!] | User-generated-content safeguards | No filtering of objectionable content, no signup agreement. Apple 1.2 expects filtering, reporting, blocking and published contact info. At minimum: Terms acceptance at signup + a documented report response process. |
| [x] | Real-world meetup safety | Covered in Terms ("Meeting other golfers"). An in-app safety tip on round screens would help. (B) |
| [x] | AI / Caddie disclaimer | Covered in Terms. An in-app line on Caddie results would help. (B) |
| [x] | Governing law | New York (approved). |
| [x] | Contact information | Email on `/privacy` and `/terms`. |
| [!] | Terms acceptance | Not shown at signup. Likely needed for App Review (UGC). |

## 6. ANALYTICS
Current state: `track()` in `src/lib/analytics.ts` **does nothing in production** (dev-only console log). Vercel Web Analytics records page views only. The production database already holds the underlying facts.

| Status | Metric | Source today |
|---|---|---|
| [~] | Signup | `auth.users` (26 total, 1 in the last 7 days) |
| [~] | Onboarding completion | `profiles.has_onboarded` (24) |
| [~] | Profile completion | profile columns |
| [ ] | Golfer discovery | not measured |
| [~] | Round view | page views via Vercel only |
| [~] | Round creation | `golf_calls` |
| [~] | Round join | `round_participants` |
| [~] | First DM | `messages` |
| [~] | Caddie usage | `caddie_analyses` + admin Caddie stats RPCs |
| [ ] | Retention | not measured (no last-active timestamp) |

**Smallest launch-ready recommendation:** don't add an analytics vendor. Add one read-only SQL funnel (signup → onboarded → first round viewed/joined/hosted → first DM → Caddie) to the existing admin dashboard, plus a "last active" column updated on app open for retention. Fix the Privacy Policy to disclose Vercel page analytics. (B)

## 7. MONITORING
| Status | Can we detect… | Evidence / notes |
|---|---|---|
| [!] | Client crashes / errors | Nothing. No crash reporting and no React error boundary, so a render crash is a blank screen with no report. Minimum: an error boundary with a friendly reload screen. (B, arguably A) |
| [~] | Supabase errors | Supabase logs and advisors, checked manually. No alerting. |
| [~] | Edge Function failures | Function logs, checked manually. |
| [~] | Push failures | `send-push` logs every failure reason; manual check. |
| [~] | Caddie failures | `status='failed'` rows + admin Caddie stats; stuck rows not auto-detected. |
| [~] | Auth problems | Supabase auth logs; manual. |
**Launch-week routine:** check function logs, `send-push` errors, Caddie status counts and new signups daily.

## 8. PRODUCTION SECURITY / CLEANUP
| Status | Item | Evidence / notes |
|---|---|---|
| [x] | Secrets in tracked files | Only `.env.example` is tracked; no secret-shaped strings in tracked files. |
| [x] | Secrets in git history | Scanned for Supabase secret keys, private keys and service-role JWTs: the only hit is the PEM header string in `send-push` parsing code (no key material). |
| [x] | Service-role keys | Not referenced in `src/` or `api/`; only in Edge Function secrets and a local script that takes it inline. |
| [x] | Frontend env | Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable by design). |
| [x] | `.p8` / signing keys | Not in the repo; APNs key only in Supabase secrets; OpenAI reviewer key outside the repo. |
| [x] | Stale dev URLs | None in `src/`. |
| [x] | Debug / prototype tools | Profile switcher, demo reset and "any code works" verification are demo-only (`isDemo`). |
| [~] | Demo account on the public login screen | Micky decided: hide it. `Auth.tsx` now shows it only on `/login?demo=1` (headless-verified: hidden on `/login` and `/signup`; `?demo=1` shows it and signs in). Demo functionality kept. App Review uses the password reviewer account. Uncommitted. |
| [ ] | Placeholder copy | About page shows "Version 1.0 (prototype)"; login strings include "Prototype — choose your account" (check where shown). Reputation shows a disabled "Coming soon" for phone verification. (B) |
| [~] | Hard-coded / test accounts | Demo data is local-only. Production still has 2 old mailinator test accounts and a little test data; remove before launch. (B) |
| [?] | Broken links | Community Guidelines is login-only (the Terms reference it by name, not by link). Full link sweep not done. |
| [x] | Production-inappropriate TODOs | No TODO/FIXME comments in `src/`. |
| [x] | Unknown URLs | Now show "Page not found". |

## 9. REAL-DEVICE QA — two real accounts, two iPhones (TestFlight build)
1. **A** hosts a round for tomorrow in NYC. Also try a past time → refused.
2. **B** finds it in Play / discovery, opens it, views A's profile, joins.
3. **A** receives the round-join push (app in background) → tap → lands on the round.
4. **A** opens the round and messages B (DM from B's profile).
5. **B** receives the DM push with preview → tap → lands in the correct conversation.
6. Both send more messages. Test the foreground and app-closed cases.
7. **B** leaves the round; **A** sees the seat free up. **A** cancels a second test round.
8. **B** blocks, then unblocks, A; **B** reports a test post. Confirm the report reaches admin.
9. Log out on one phone and log in as the other account → the push token moves (only the signed-in account gets pushes).
10. Caddie: upload a swing on A → completion push → result screen.
11. On a throwaway third account: **delete the account** from Settings → it can't sign back into the old data.
12. Both users keep using GolfMe normally (Home, Community, Profile).
Record results here with date, device and build number.

## 10. RELEASE CANDIDATE
- [ ] Resolve all blockers above.
- [ ] Freeze feature development (only launch-blocker fixes after this point).
- [ ] Build the final TestFlight release candidate (record the build number).
- [ ] Run section 9 on that exact build.
- [ ] Submit that exact build to App Review.
- [ ] Replace it only for a genuine launch blocker.

## 11. MARKETPLACE SEEDING (NYC) — no fake users or activity in production
| Status | Item | Notes |
|---|---|---|
| [!] | Real hosted rounds available | 0 upcoming today. |
| [ ] | Initial real users recruited | 26 accounts, 1 new in the last 7 days. |
| [ ] | Creator hosts | See section 12. |
| [ ] | Micro-creator outreach | |
| [ ] | Golf communities | |
| [ ] | College golfers | |
| [ ] | Simulator communities | |
| [ ] | Local golf pages | |
| [ ] | Founder-led outreach | |

## 12. CREATOR PROGRAM (small test: creators host real rounds on GolfMe)
| Creator | Audience / location | Proposed round | Outreach status | Compensation | Attributed signups/joins | Actual participation |
|---|---|---|---|---|---|---|
| | | | | | | |
Attribution: give each creator a distinct round and track joins to it, plus signups on the day. A `?ref=` link is optional later (C).

## 13. LAUNCH DAY
- [ ] Production health: golfme.app loads; Supabase and Edge Functions healthy; no new errors in logs.
- [ ] Public download test from the App Store on a clean device.
- [ ] Auth: fresh email + Google signups.
- [ ] Hosted rounds visible in Play (at least 3 real upcoming rounds).
- [ ] Messaging + push between two accounts.
- [ ] Caddie: one analysis end to end.
- [ ] Creator posts live and linking correctly.
- [ ] Founder outreach sent.
- [ ] Monitoring: check logs morning, midday and evening.
- [ ] Respond to early users (DMs to Micky via the founder welcome chat) within hours.

## 14. POST-LAUNCH
Look for repeated evidence before expanding scope; don't implement every suggestion immediately.
- **CRITICAL BUG:** (none yet)
- **IMPORTANT IMPROVEMENT:** reconcile Supabase migration history. Every local migration filename's version differs from the version recorded in production (applied via MCP `apply_migration`, matched by name), so `supabase db push` must not be used until `supabase migration repair` aligns them · Review Gate: allow a pre-approved migration apply inside a task (today it deadlocks) · Caddie historical backfill (staged, approval needed) · auto-fail stuck Caddie analyses · server-side past-date guard for rounds · auto-close past rounds · waitlist email throttle · email notifications for web-only users · round (group) chat push · round update/cancel push · unused-Storage sweep · leaked-password protection.
- **FUTURE IDEA:** see `AFTER_TESTFLIGHT.md`.

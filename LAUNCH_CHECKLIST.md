# GOLFME LAUNCH STATUS

**Target:** First public App Store launch (plus golfme.app, already live with open signup)
**Last updated:** 2026-09-30 — Rows refreshed after the launch-blocker commits `a286063` and `fa3a27c` went live. New App Review blockers found: Google-only login on iOS (guideline 4.8), the reviewer password login hidden behind `?demo=1`, and "prototype" copy. The first two are fixed in task T-20260930-87857.

Statuses: `[ ]` NOT STARTED · `[~]` IN PROGRESS · `[?]` NEEDS VERIFICATION · `[!]` BLOCKED · `[x]` COMPLETE (only with evidence it works).
Classify every request: **A** fixes a launch blocker · **B** improves launch quality · **C** nonessential, probably after launch.

### CURRENT LAUNCH BLOCKERS
0. **Users' device locations were readable by every signed-in member** → `[~]` **fixed and live.** The DB trigger + backfill were applied 2026-09-30 (0 precise values; a non-owner sees at most 2 decimals), and client rounding shipped in `a286063`. Remaining: a device check that "Use My Current Location" and nearby discovery still work (part of the two-account QA). (A)
1. **Privacy Policy was inaccurate** → `[x]` **rewrite live** at golfme.app/privacy (`a286063`, GPT review DONE). It discloses Vercel Web Analytics, push tokens and APNs previews, every profile field, who can see what, Canada storage, 18+ and ~1 km location rounding. The App Store mapping is in `APP_STORE_PRIVACY.md`. (A)
2. **No public Support URL** → `[x]` **live** at golfme.app/support (`fa3a27c`). It covers contact, reply time, sign-in, rounds, safety/report/block, notifications, Caddie and account deletion; the footer links Privacy · Terms · Support. (A)
2b. **Reports reached no one** → `[x]` **fixed and verified end to end 2026-09-30** (real report → founder email → dashboard → marked Reviewed; see "Report handling" below). **Database side LIVE 2026-09-30.** Migration `20260930100000_report_alerts_and_admin_view` (designed by golfme-architect, applied after Micky's approval): an AFTER INSERT trigger emails the founder via Resend on every report (HTML-escaped, best-effort, never blocks the insert); admin-only `admin_list_reports` / `admin_set_report_status`. Verified in a rolled-back test: the insert works under RLS, the alert is queued escaped, nothing is sent, non-admins are rejected by both RPCs, no leftovers; no new advisor findings beyond the standard admin-RPC pattern. Known limits (post-launch): post/comment reports don't record which post; no alert rate limit. (A)
3. **Apple UGC rules (Guideline 1.2) not fully met** → `[~]`. Done: Terms acceptance at signup plus a zero-tolerance clause (`fa3a27c`), reporting verified end to end (2b), and contact info on `/support`. Remaining: **blocking** has never been used in production (two-account QA), and there is **no filtering of objectionable content**. Apple lists filtering explicitly. Smallest credible fix: a word-list filter on posts, comments and usernames (a DB trigger, so it goes through golfme-architect and Micky approves the SQL). (A)
4. **No real upcoming rounds.** Production has 0 upcoming rounds, and the 10 open/full rounds are all past-dated (hidden from Play). A new user from the App Store finds nothing to join. (A — marketplace, not App Review)
5. **The two-account real-device QA has never been run end to end** (section 9). That includes round-join push (only 1 device token exists in production: Micky's), push-tap deep links, and in-app account deletion (Apple requires it). (A)
6. **App Store listing not started.** No screenshots, description, keywords, App Privacy answers, age rating, review notes, or release-candidate build. (A)
7. **Google login without Sign in with Apple (Guideline 4.8)** → `[x]` **live (`f5dcc57`) and device-verified 2026-09-30.** The iOS app no longer shows Google (`Capacitor.isNativePlatform()`); the web keeps it. Headless-verified with a simulated iOS bridge (no Google on iOS `/login` or `/signup`; web unchanged). 20 of 26 production accounts are Google-only. Device check: Micky signed out (07:47:44 UTC), requested an email link (07:48:28) and signed in through `com.golfme.ios://auth-callback` (07:48:41). The auth log shows a login for his existing Google-only account `11be6983`, and no new user was created, so Google-first accounts reach their own account through the email link. A later `/verify` from a Google IP got "link invalid": Gmail's link scanner re-opening the used link, harmless (the app shows a toast if a scanner ever consumes a link first). Optional follow-up (B): `/support` could now say outright that Google users reach the same account with the email link; today it says to email for help. Sign in with Apple stays a post-launch option. (A)
8. **App Review couldn't sign in** → `[x]` **live (`f5dcc57`) and device-verified 2026-09-30.** The "Sign in with a password" link was inside the `?demo=1` block, unreachable inside the iOS app. It now always shows on the iOS app's `/login` (not `/signup`); the web is unchanged (only with `?demo=1`). Device check: on Micky's iPhone it signed into the reviewer account `24c3c140` at 07:54:54 UTC (auth log: password grant). The account is onboarded, has a location and no admin role, and its push token registered automatically. There were 5 "invalid credentials" attempts first, so paste the exact password into the App Store Connect review notes (tracked under App Review notes). (A)
9. **"Prototype" copy** → `[ ]`. The About page says "Version 1.0 (prototype)" and Reputation shows a disabled "Coming soon" button. Apple rejects beta/demo/prototype labeling (2.2) and placeholder features (2.1). Small copy fix. (A, upgraded from B)

### NEEDS VERIFICATION
Push after signing back into the same account (fix pending), "Use My Current Location" after rounding, Home, discovery, host/join/leave/cancel round, search and filter, profile viewing, follow, DM creation from a profile, account deletion, round-join push, Caddie completion push, denied-permission fallback, block, and Caddie failure states in the UI.

### READY
Email and Google signup/login with onboarding (fresh incognito tests, 2026-09-28) · golfme.app open signup (live, verified) · DM push on two iPhones in all three app states, tap → correct chat, token moves on account switch (2026-09-30) · `send-push` outcome logging (v13) + Settings Push status · Privacy Policy, Terms and Support pages live · Terms acceptance at signup · report → founder email → admin dashboard → status (verified 2026-09-30) · profile locations rounded to ~1 km · demo entry hidden · Page-not-found for unknown URLs · Caddie pipeline (daily limit enforced in DB + Edge Function) · private Caddie storage for new uploads · no secrets in tracked files or git history · only the anon key and URL reach the frontend · GPT Review Gate working.

### NEXT 3 ACTIONS
1. **Ship the push re-registration fix** (task T-20260930-94385), then on a device: sign out, sign back into the same account, and a DM push arrives with no Settings step. Next: fix the "prototype" copy (blocker 9) and add a show/hide eye icon to the password field (B, requested by Micky). Blockers 7 and 8 (Google hidden on iOS, reviewer login) are shipped and device-verified. (A)
2. **Micky: two-account real-device QA** (section 9 steps not yet done): round-join push, leave/cancel, block/unblock, report from B, Caddie completion push, account deletion on a throwaway account, "Use My Current Location". (A)
3. **Content filter (blocker 3)** via golfme-architect, then a crash-screen error boundary (B), 3–5 real NYC rounds, screenshots + listing, release candidate. (A)

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
| [x] | Notification tap → correct screen | DM push tap opens the correct conversation in foreground, background and killed states (device test 2026-09-30). |
| [x] | Logout / account switching | Device-verified 2026-09-30: account switch moved the push token; the old account stopped receiving pushes on that phone. |
| [?] | Account deletion | `delete-account` v23 (purges storage incl. private Caddie bucket); not re-tested since the private-bucket change. **Apple requires this.** |

## 2. PUSH NOTIFICATIONS
| Status | Item | Evidence / notes |
|---|---|---|
| [x] | Server config | `PUSH_INTERNAL_SECRET` matches Vault (fingerprint-verified); all `APNS_*` secrets set; production APNs. |
| [x] | DM push, app backgrounded or closed | Micky's device test 2026-09-29; `send-push` returned 200 at 04:57 and 04:58 UTC. |
| [x] | DM preview text | `20260929120000_dm_push_message_preview` applied; short and long messages tested on device. |
| [x] | Second-device DM push (launch blocker, 2026-09-29) | Micky reported: User B gets the in-app notification but no native push. Server-side diagnosis (metadata only): the 7 test DMs (02:31–02:36 UTC) went to account `1101110c`, which has **never had a device token**, so `send-push` correctly found "no registered devices" (HTTP 200, APNs never called). The second phone was signed in as `1101110c` (it ran a Caddie analysis at 02:42 under it) but never registered while on that account. At 02:45:04 the phone signed into the other "Jordan" account `2e28a8c5`, and a token registered 1 second later, so registration and the entitlement work on that phone. **Resolved 2026-09-30:** User B = Jordan joined Sep 4 (`2e28a8c5`, token fp `c276a08a90`). Controlled test: A→B DMs at 03:02:30 and 03:02:41 UTC created the in-app notifications, `send-push` returned 200, and there's no APNs rejection in the logs. **Micky confirmed the native notification arrived on the second iPhone.** B→A (03:01:45, 03:01:48) also delivered. Root cause of the earlier failure: the test DMs went to the other Jordan account, which never registered a device. Diagnostics built (uncommitted, task T-20260929-12184): fingerprint-only `send-push` outcome logging (deploys after GPT DONE) and a Settings "Push status" line. Acceptance test passed 2026-09-30 (three app states + tap + account switch; rows below). |
| [x] | DM push: app open / backgrounded / fully closed | Two real iPhones, 2026-09-30: Micky confirmed all three states deliver and **tapping opens the correct conversation**. Server: every A↔B DM created the in-app notification, `send-push` 200, no APNs rejections. |
| [x] | Tap → correct chat | Confirmed on device for all three app states (2026-09-30). |
| [x] | Duplicate-notification prevention | The account switch moved the phone's single token between accounts (no duplicate row); each DM produced one push. |
| [x] | Device token / account switching | 2026-09-30 03:07:50 UTC: the second phone signed into another account; token `c276a08a90` moved to it 1 s later via `register_device_push_token`; the previous account has no token on that phone. Micky confirmed the old account no longer receives pushes there. |
| [~] | Re-sign-in to the same account | Micky, 2026-09-30: after signing out and back in, he had to re-enable push in Settings. Cause: sign-out deletes the phone token, but `usePushRegistration` (App.tsx) still remembered it had registered for that user and skipped re-registering until the app fully restarted. Different-account switches were unaffected. Fix: reset that memory when signed out or push is off (task T-20260930-94385, uncommitted). Remaining: device check (sign out, sign back into the same account, send a DM, push arrives with no Settings step). |
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
| [x] | Production cost safeguards | Daily limit per user enforced by a BEFORE INSERT trigger and in the Edge Function; size caps. The limit stays at 30 analyses/user/day for launch (Micky decided 2026-09-29). |
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
| [x] | Support URL | `https://golfme.app/support` live (`fa3a27c`). |
| [x] | Privacy Policy URL | `https://golfme.app/privacy`, accurate rewrite live (`a286063`). |
| [x] | Terms URL | `https://golfme.app/terms` live 2026-09-29. |
| [~] | App Privacy disclosures | Full mapping with evidence in `APP_STORE_PRIVACY.md`: Name, Email, Coarse Location, Messages, Photos/Videos, Audio, Other User Content, User ID, Device ID (push token), Product Interaction (not linked, Analytics), Other Data; Tracking = No. Ready to enter in App Store Connect (D1 has shipped). |
| [ ] | Age rating | Social app with user-generated content and chat → likely 17+ unless moderation changes the answers. |
| [ ] | App Review notes | Explain: social golf app, real accounts, reviewer password login ("Sign in with a password" on the login screen), push, AI swing feedback, and what is native (push, camera/video upload) to pre-empt a 4.2 "website wrapper" concern. |
| [x] | Review / demo credentials | Reviewer password sign-in verified on a real iPhone 2026-09-30 (blocker 8). Put the exact credentials in the App Review notes. |
| [~] | Password show/hide toggle | Requested by Micky after 5 mistyped reviewer-password attempts. An eye / eye-off button inside the password field on `/login` (44×46 px; its `aria-label` switches between Show and Hide password, in 6 languages); hidden by default; autocapitalize/autocorrect off. Headless-verified (simulated iOS): password → text → password, value kept, 0 page errors. GPT reviewer hit its daily call limit, so Micky reviewed the diff and approved it (2026-09-30, task T-20260930-25411). Live after deploy; device check pending. (B) |
| [~] | Branded sign-in email | Supabase Auth sends it (not app code) via the Resend SMTP; the templates live only in the Supabase Dashboard. Tracked copy: `supabase/templates/sign-in-email.html` (paste steps in the README there). Corporate transactional layout (per Micky): subject "Sign in to GolfMe", gold + forest accent line, logo + wordmark top-left, left-aligned copy, 48 px forest button, fallback link, separate footer (Support · Privacy · Terms, automated-email note, © 2026). Link only via `{{ .ConfirmationURL }}`. Headless previews at 375 and 700 px (light, dark, images blocked): no horizontal scroll. **Live 2026-09-30:** Micky saved it into **Magic link** and **Confirm signup** (config reloads 08:39:01 and 08:39:12 UTC). Sign-in from the emailed link verified with the first design (request 08:34:02 → `/verify` 303 → login 08:34:16, same flow and variable); first email with the new design requested 08:39:32. Remaining: Micky confirms the new design on his phone. The GPT reviewer hit its daily limit; Micky approved the diff (task T-20260930-15914). (B) |
| [~] | Permission strings | Location, photos, camera and microphone descriptions present in `Info.plist`. Consider adding `ITSAppUsesNonExemptEncryption = NO` to skip the export question on each upload. (B) |
| [ ] | Final release-candidate build | Not built. The current TestFlight build has the push entitlement; Beta App Review / public link status to confirm. |

## 5. LEGAL / TRUST
| Status | Item | Evidence / notes |
|---|---|---|
| [x] | Privacy Policy | Rewrite live (`a286063`); the 10 disagreements it fixed are listed in `APP_STORE_PRIVACY.md`. |
| [~] | Location privacy | The DB trigger + backfill are live and verified 2026-09-30 (0 precise values; a non-owner sees at most 2 decimals); client rounding live (`a286063`). No other API path returns user coordinates. Device check of "Use My Current Location" pending. |
| [x] | Terms of Service | Live at `/terms` (approved by Micky, GPT review DONE). |
| [?] | Account deletion | In Settings → `delete-account` v23; re-test needed. |
| [x] | Report user / content | Verified end to end 2026-09-30 (see Report handling). |
| [?] | Block user | `blocks` table, blocks enforced for rounds (Batch C); never used in production. |
| [!] | User-generated-content safeguards | Terms acceptance + zero-tolerance clause live; reporting verified; contact published. **Missing: objectionable-content filtering** (blocker 3). |
| [x] | Real-world meetup safety | Covered in Terms ("Meeting other golfers"). An in-app safety tip on round screens would help. (B) |
| [x] | AI / Caddie disclaimer | Covered in Terms. An in-app line on Caddie results would help. (B) |
| [x] | Governing law | New York (approved). |
| [x] | Contact information | Email on `/privacy` and `/terms`. |
| [x] | Terms acceptance | "By continuing, you agree to our Terms of Service and Privacy Policy" (linked, 6 languages) on login and signup, live (`fa3a27c`); the Terms include an explicit zero-tolerance clause. |
| [x] | Report handling | **Real delivery verified 2026-09-30:** Micky filed a real report (06:19:20 UTC, report `46cff7b4`, context profile), Resend accepted it (HTTP 200) and the email arrived in his inbox. Admin RPCs verified (non-admins rejected). Dashboard Reports section deployed 2026-09-30 and loads on iPhone (`admin_list_reports` 200 at 06:50:27 UTC). The first "Reviewed" tap didn't register (no request logged). On retry, `admin_set_report_status` returned 204 at 06:56:49 UTC, the badge updated, and the DB shows report `46cff7b4` = `reviewed`. Full loop verified: file → email → dashboard → status change. Post-launch (B): the status buttons are ~24px tall, below the 44px tap-target guideline. See blocker 2b. |

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
| [x] | Push failures | `send-push` v13 (deployed 2026-09-30) logs one `send-push outcome` line per call, with a token fingerprint and counts only. Verified live: a DM to `81765aff` logged `outcome: no_registered_devices`. Settings → Push status shows correctly on both phones (Micky, 2026-09-30). |
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
| [x] | Demo account on the public login screen | Hidden; shown only on `/login?demo=1` (live, `a286063`). The reviewer password link was moved out of that block (blocker 8). |
| [ ] | Placeholder copy | About page shows "Version 1.0 (prototype)"; Reputation shows a disabled "Coming soon" for phone verification. `auth.prototypeChooseAccount` is unused. **Upgraded to A** (blocker 9). |
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
- **Review Gate notes (2026-09-30):** payload limit raised 60k → 120k characters (Micky approved) after a combined launch batch was truncated; the Resend shared sender address was added (by hash) to the redact-only list.
- **IMPORTANT IMPROVEMENT:** reconcile Supabase migration history. Every local migration filename's version differs from the version recorded in production (applied via MCP `apply_migration`, matched by name), so `supabase db push` must not be used until `supabase migration repair` aligns them · Review Gate: allow a pre-approved migration apply inside a task (today it deadlocks) · Caddie historical backfill (staged, approval needed) · auto-fail stuck Caddie analyses · server-side past-date guard for rounds · auto-close past rounds · waitlist email throttle · email notifications for web-only users · round (group) chat push · round update/cancel push · unused-Storage sweep · leaked-password protection.
- **FUTURE IDEA:** see `AFTER_TESTFLIGHT.md`.

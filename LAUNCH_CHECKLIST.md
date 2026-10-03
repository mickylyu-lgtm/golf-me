# GOLFME LAUNCH STATUS

**Target:** First public App Store launch (plus golfme.app, already live with open signup)
**Last updated:** 2026-09-30 (evening). Shipped today: report → admin loop verified; Google hidden on iOS (4.8) and reviewer login, both device-verified; push re-registration after re-sign-in; password eye toggle; branded sign-in email (live in Supabase, device-confirmed); prototype/placeholder wording removed; login screen cleanup. Review Gate daily call limit raised from 10 to 25 (Micky approved; $2/day and $10/month caps unchanged).

Statuses: `[ ]` NOT STARTED · `[~]` IN PROGRESS · `[?]` NEEDS VERIFICATION · `[!]` BLOCKED · `[x]` COMPLETE (only with evidence it works).
Classify every request: **A** fixes a launch blocker · **B** improves launch quality · **C** nonessential, probably after launch.

### CURRENT LAUNCH BLOCKERS
0. **Users' device locations were readable by every signed-in member** → `[~]` **fixed and live.** The DB trigger + backfill were applied 2026-09-30 (0 precise values; a non-owner sees at most 2 decimals), and client rounding shipped in `a286063`. Remaining: a device check that "Use My Current Location" and nearby discovery still work (part of the two-account QA). (A)
1. **Privacy Policy was inaccurate** → `[x]` **rewrite live** at golfme.app/privacy (`a286063`, GPT review DONE). It discloses Vercel Web Analytics, push tokens and APNs previews, every profile field, who can see what, Canada storage, 18+ and ~1 km location rounding. The App Store mapping is in `APP_STORE_PRIVACY.md`. (A)
2. **No public Support URL** → `[x]` **live** at golfme.app/support (`fa3a27c`). It covers contact, reply time, sign-in, rounds, safety/report/block, notifications, Caddie and account deletion; the footer links Privacy · Terms · Support. (A)
2b. **Reports reached no one** → `[x]` **fixed and verified end to end 2026-09-30** (real report → founder email → dashboard → marked Reviewed; see "Report handling" below). **Database side LIVE 2026-09-30.** Migration `20260930100000_report_alerts_and_admin_view` (designed by golfme-architect, applied after Micky's approval): an AFTER INSERT trigger emails the founder via Resend on every report (HTML-escaped, best-effort, never blocks the insert); admin-only `admin_list_reports` / `admin_set_report_status`. Verified in a rolled-back test: the insert works under RLS, the alert is queued escaped, nothing is sent, non-admins are rejected by both RPCs, no leftovers; no new advisor findings beyond the standard admin-RPC pattern. Known limits (post-launch): post/comment reports don't record which post; no alert rate limit. (A)
3. **Apple UGC rules (Guideline 1.2)** → `[~]`. Done: Terms acceptance + zero-tolerance clause (`fa3a27c`); reporting verified end to end (2b); contact on `/support`; **server-side content filter LIVE 2026-09-30** (migration `add_objectionable_content_filter`, version 20260930165502: 32 severe terms, triggers on posts, comments, profile name/username/bio, round notes, round chat and DMs; rolled-back dry run + post-apply tests passed, ~0.65 ms/check; advisor clean apart from the expected INFO). Micky commits to acting on reports within 24 hours (goes in the review notes). The in-app "not allowed" message is live too (`c31bd24`, GPT review DONE): translated toast with the text kept at every write path. Device check 2026-09-30 (Micky's iPhone, real account): DMs verified: a clean DM stored (17:11:11 UTC) and two blocked-word DMs rejected by the filter (17:11:20, 17:11:24; postgres log "objectionable_content"); the other stored test DMs check clean against the filter. Post and bio verified on device 2026-10-02 (blocked post 22:12:11 UTC, blocked bio 22:12:30, both 'objectionable_content'). Remaining: blocking in the two-account QA. (A)
4. **No real upcoming rounds.** Production has 0 upcoming rounds, and the 10 open/full rounds are all past-dated (hidden from Play). A new user from the App Store finds nothing to join. (A — marketplace, not App Review)
5. **The two-account real-device QA has never been run end to end** (section 9). That includes round-join push (only 1 device token exists in production: Micky's), push-tap deep links, and in-app account deletion (Apple requires it). (A)
6. **App Store listing not started.** No screenshots, description, keywords, App Privacy answers, age rating, review notes, or release-candidate build. (A)
7. **Google login without Sign in with Apple (Guideline 4.8)** → `[x]` **live (`f5dcc57`) and device-verified 2026-09-30.** The iOS app no longer shows Google (`Capacitor.isNativePlatform()`); the web keeps it. Headless-verified with a simulated iOS bridge (no Google on iOS `/login` or `/signup`; web unchanged). 20 of 26 production accounts are Google-only. Device check: Micky signed out (07:47:44 UTC), requested an email link (07:48:28) and signed in through `com.golfme.ios://auth-callback` (07:48:41). The auth log shows a login for his existing Google-only account `11be6983`, and no new user was created, so Google-first accounts reach their own account through the email link. A later `/verify` from a Google IP got "link invalid": Gmail's link scanner re-opening the used link, harmless (the app shows a toast if a scanner ever consumes a link first). Optional follow-up (B): `/support` could now say outright that Google users reach the same account with the email link; today it says to email for help. Sign in with Apple stays a post-launch option. (A)
8. **App Review couldn't sign in** → `[x]` **live (`f5dcc57`) and device-verified 2026-09-30.** The "Sign in with a password" link was inside the `?demo=1` block, unreachable inside the iOS app. It now always shows on the iOS app's `/login` (not `/signup`); the web is unchanged (only with `?demo=1`). Device check: on Micky's iPhone it signed into the reviewer account `24c3c140` at 07:54:54 UTC (auth log: password grant). The account is onboarded, has a location and no admin role, and its push token registered automatically. There were 5 "invalid credentials" attempts first, so paste the exact password into the App Store Connect review notes (tracked under App Review notes). (A)
9. **"Prototype" copy** → `[~]` **fixed and deployed** (task T-20260930-71354; GPT at its daily limit, Micky approved the diff). About now says "Version 1.0" (6 languages). Real accounts no longer see the Reputation phone row (disabled "Coming soon") or the Verified Golfer row ("requires phone verification, which isn't available yet"); both need phone verification, which doesn't exist yet. Demo mode unchanged. The Caddie tutorial no longer calls its feedback "beta" (6 languages). Unused strings removed. Demo-only "Prototype tools" were already hidden from real accounts. Remaining: deploy + a quick look at About and Reputation on a real account. (A)

### NEEDS VERIFICATION
Device checks after today's deploys: push after signing back into the same account, the password eye toggle, the new login screen (email-link sign-in + reviewer password), About/Reputation wording on a real account, "Use My Current Location". Two-account QA: host/join/leave/cancel round, round-join push, block/unblock, report from B, Caddie completion push, account deletion. Also: Home, discovery, search/filter, profile viewing, follow, DM from a profile, denied-permission fallback, Caddie failure states.

### READY
Email and Google signup/login with onboarding (fresh incognito tests, 2026-09-28) · golfme.app open signup (live, verified) · DM push on two iPhones in all three app states, tap → correct chat, token moves on account switch (2026-09-30) · `send-push` outcome logging (v13) + Settings Push status · Privacy Policy, Terms and Support pages live · Terms acceptance at signup · report → founder email → admin dashboard → status (verified 2026-09-30) · profile locations rounded to ~1 km · demo entry hidden · Page-not-found for unknown URLs · Caddie pipeline (daily limit enforced in DB + Edge Function) · private Caddie storage for new uploads · no secrets in tracked files or git history · only the anon key and URL reach the frontend · GPT Review Gate working.

### NEXT 3 ACTIONS
1. **Micky: device checks + two-account QA** (see NEEDS VERIFICATION); host 3–5 real NYC rounds while doing it (blocker 4). (A)
2. **Content filter (blocker 3)** via golfme-architect (DB trigger; Micky approves the SQL), then a crash-screen error boundary (B, strongly recommended). (A)
3. **App Store Connect:** six screenshots, subtitle/description/keywords/promo text, category, App Privacy answers (from `APP_STORE_PRIVACY.md`), age rating, review notes (reviewer account via the in-app "Sign in with a password" link). Then the release-candidate build → QA on that build → submit. (A)

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
| [x] | Account deletion | Device-verified 2026-10-03: account deleted from Settings, nothing left in auth, profiles, tokens, posts, messages, Caddie or storage. **Apple requires this.** |

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
| [x] | App Review notes | Entered in App Store Connect by Micky 2026-10-03 (drafted text: what GolfMe is, "Sign in with a password" with the reviewer account, rounds by real golfers in NYC, UGC filter + report (24 h) + block + account deletion, native push and camera); sign-in info and contact email confirmed by Micky. |
| [x] | Review / demo credentials | Reviewer password sign-in verified on a real iPhone 2026-09-30 (blocker 8). Put the exact credentials in the App Review notes. |
| [x] | Login screen cleanup | Device-verified 2026-09-30: on the new screen Micky requested an email link (17:10:22 UTC) and signed in (17:10:53); push re-registered 1 s later. Details: Per Micky (2026-09-30): `/login` title is always "Sign in"; the email field shows directly with "Send sign-in link" (no "Continue with Email" step, and no keyboard popping up on load); Google is web-only; Terms/Privacy and "New here? Get Started" unchanged. Password sign-in, by Micky's decision: the iOS app keeps the small "Sign in with a password" link, because the reviewer can't add URL parameters there (verified for App Review); on the web it appears only with `?demo=1` or the new `?review=1`, which opens the email + password fields directly. `/signup` unchanged. No auth logic changes. Headless-verified (web + simulated iOS: `/login`, `?review=1`, `?demo=1`, `/signup`), 390 px, no horizontal scroll, 0 page errors. Deployed (task T-20260930-14656; GPT at its daily limit, Micky approved the diff); device re-check of sign-in pending. Review notes don't need the hidden route: the reviewer uses the visible in-app link. (B) |
| [x] | Keyboard: Review Golfer, Coach Review, comments, group chat, bio | **Device-verified 2026-10-02 by Micky** ("all works") after `b43eca2`: the keyboard no longer drags the screen in the Review Golfer popup, the post comment box, round group chat and the Edit Profile (bio) popup; DMs unchanged. Server follow-up 2026-10-02: a comment posted through the docked box (22:11:46 UTC); a post with a blocked word was rejected (22:12:11) and a bio with a blocked word was rejected (22:12:30, a clean bio save went through at 22:12:24). A group chat message sent through the docked box (22:14:19 UTC). History: Micky: the whole screen dragged up when the keyboard opened. Root cause (golfme-architect): in `KeyboardResize.Body` mode the plugin only sets `body.style.height`; the layout stays full height, so the keyboard covers the bottom-anchored sheet and iOS pans the whole surface to reveal the focused field. Fix (task T-20260930-08701; GPT CONTINUE, no findings; pushed for device testing with Micky's approval, gate deadlock workaround): an opt-in `keyboardAware` prop on the shared `Modal` (default off, so every other popup, including chat, is unchanged) lifts the sheet onto the keyboard, shrinks it to the visible area, scrolls only the sheet to keep the focused field visible (also on focus switches), restores its scroll position when the keyboard closes, and locks page scroll while open. Enabled on Review Golfer and Leave Coach Review. No native change, no new TestFlight build. tsc/lint/build pass; headless web check shows the default path unchanged. Remaining: iPhone test. Also found: `review.intro` shows a literal `{name}` (second placeholder unfilled, all 6 locales), a separate small fix. Comment composer on a post: Micky confirmed it jumps too and no comment ever reached the server. Fix (task T-20260930-04081; GPT CONTINUE with no findings after F1 fix; pushed for device testing with Micky's approval): while the keyboard is open the existing composer row docks in a fixed bar right above the keyboard (same input element, so focus is kept), a measured spacer holds its place, and page scroll is locked; web unchanged (headless: identical position/size, Post enables on typing). Round group chat (Micky: the textbox couldn't be seen while typing): same dock pattern inside GroupChat only, so the shared ChatComposer and DMs are untouched Combined batch (task T-20261002-02254; GPT CONTINUE with no findings; pushed for device testing with Micky's approval): the group chat dock (scroll lock + restore before paint), the Edit Profile popup (bio) on the same one-line `keyboardAware` opt-in, and the comment dock's scroll lock moved before paint. Remaining: iPhone test of all of these. Noted, unchanged: opening a round page scrolls the window down to the group chat (existing behavior). (B) |
| [~] | Bio on the Me page | Per Micky (2026-10-02, Instagram-style): your own bio now shows on the Me page under your name and stats (line breaks kept, long words wrap); empty shows "+ Add a bio" (6 languages), which opens Edit Profile. Others already see it on your golfer profile page (full) and on Discover cards (2 lines). Headless-verified at 390 px (shows, empty prompt opens the editor, no horizontal scroll). Live (task T-20261002-80506, GPT review DONE). (B) |
| [x] | Bio limit 150 characters | Per Micky (2026-10-02). App: the bio box stops at 150 with a live counter (headless: typing 170 keeps 150). Database: migration `profiles_bio_length` applied 2026-10-02 (recorded version 20261002225246; reviewed by golfme-architect; Micky approved the SQL; gate deadlock workaround). Rolled-back test: 150 accepted, 151 rejected. Longest existing bio 34. Security advisor: no new findings. (B) |
| [~] | Caddie history stays expanded | Per Micky (2026-10-02): after View more, opening an analysis and coming back kept collapsing the list. Now the expanded count is kept in sessionStorage while moving within /caddie* and cleared when leaving the Caddie section (task T-20261002-27347; GPT flagged a Strict Mode clear-on-unmount risk, removed; Micky approved the push). Headless: key kept across /caddie, /caddie/analyze, /caddie; cleared on /. Remaining: device check with a real account (demo has too few analyses). (B) |
| [~] | Keyboard: Report popup | Micky: the report text box was hidden while typing. The Report popup now uses the same `keyboardAware` Modal mode as Review Golfer and the bio popup (one line; task T-20261002-90425). Remaining: device check. (B) |
| [~] | Home: available rounds at the top | Per Micky (2026-10-03): rounds now sit right under the greeting, above Find/Host. Nearby (25 mi) first; otherwise the newest open rounds anywhere ("Open rounds"); with none at all, a "No rounds yet" card with Host a Round. 6 languages. Headless-verified in all three states (task T-20261002-18663, GPT review DONE; live). (B) |
| [~] | Password show/hide toggle | Requested by Micky after 5 mistyped reviewer-password attempts. An eye / eye-off button inside the password field on `/login` (44×46 px; its `aria-label` switches between Show and Hide password, in 6 languages); hidden by default; autocapitalize/autocorrect off. Headless-verified (simulated iOS): password → text → password, value kept, 0 page errors. GPT reviewer hit its daily call limit, so Micky reviewed the diff and approved it (2026-09-30, task T-20260930-25411). Live after deploy; device check pending. (B) |
| [x] | Branded sign-in email | Supabase Auth sends it (not app code) via the Resend SMTP; the templates live only in the Supabase Dashboard. Tracked copy: `supabase/templates/sign-in-email.html` (paste steps in the README there). Corporate transactional layout (per Micky): subject "Sign in to GolfMe", gold + forest accent line, logo + wordmark top-left, left-aligned copy, 48 px forest button, fallback link, separate footer (Support · Privacy · Terms, automated-email note, © 2026). Link only via `{{ .ConfirmationURL }}`. Headless previews at 375 and 700 px (light, dark, images blocked): no horizontal scroll. **Live 2026-09-30:** Micky saved it into **Magic link** and **Confirm signup** (config reloads 08:39:01 and 08:39:12 UTC). Sign-in from the emailed link verified with the first design (request 08:34:02 → `/verify` 303 → login 08:34:16, same flow and variable); first email with the new design requested 08:39:32. Micky confirmed the new design on his iPhone (2026-09-30). The GPT reviewer hit its daily limit; Micky approved the diff (task T-20260930-15914). **Refinement (per Micky, 2026-09-30):** button kept dark forest in dark mode (it had switched to a lighter green), a compact "Trouble signing in?" fallback with a smaller link, tighter spacing and a more compact footer. Saved into both templates (reloads 08:50:03 and 08:50:19 UTC); Micky confirmed the email requested at 08:51:14 looks right. (B) |
| [~] | Permission strings | Location, photos, camera and microphone descriptions present in `Info.plist`. `ITSAppUsesNonExemptEncryption = false` added (standard HTTPS only; skips the export-compliance question on each upload); takes effect with the next Xcode archive (committed with task T-20260930-19042). (B) |
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
| [~] | User-generated-content safeguards | Terms acceptance + zero-tolerance clause live; reporting verified; contact published; objectionable-content filter live on the database (2026-09-30, blocker 3). In-app message live (`c31bd24`). Remaining: device test, blocking QA. |
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
| [~] | Client crashes / errors | Crash screen live (task T-20260930-19042, GPT review DONE): a top-level error boundary around the app (`src/components/ErrorBoundary.tsx`, wraps `<App />` in `main.tsx`) shows "Something went wrong" with Reload / Go to Home instead of a blank screen, in the user's language (6, self-contained since it sits outside the providers), light or dark to match the phone setting. Stale page chunks after a deploy are already reloaded once by `lazyPage`; if that fails, this screen shows. Headless-verified by blocking the About chunk: one auto-reload, then the crash screen (en + ja), Home → `/`. Still no crash reporting service (console only). (B) |
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
| [~] | Placeholder copy | Fixed with blocker 9 (About version, Reputation phone + Verified Golfer rows hidden for real accounts, "beta" removed from the Caddie tutorial). Deployed; device look pending. |
| [~] | Hard-coded / test accounts | Demo data is local-only. Production still has 2 old mailinator test accounts and a little test data; remove before launch. (B) |
| [?] | Broken links | Community Guidelines is login-only (the Terms reference it by name, not by link). Full link sweep not done. |
| [x] | Production-inappropriate TODOs | No TODO/FIXME comments in `src/`. |
| [x] | Unknown URLs | Now show "Page not found". |

## 9. REAL-DEVICE QA — two real accounts, two iPhones (TestFlight build)
**Run 2026-10-02, two real accounts on two iPhones (server evidence, UTC):** host `1101110c` hosted a round (`host_golf_call` 23:34:13) → `11be6983` joined (23:34:24) → **round-join push delivered to APNs** for the host (send-push `delivered_to_apns`, 23:34:25) and the in-app `round_joined` notification was created → left (23:34:34, `round_left` in-app) → rejoined (23:34:37) → round cancelled (23:34:54, `round_cancelled` in-app) → **report** filed (23:35:47) and the founder alert email accepted by Resend (HTTP 200, 23:35:48) → **block** (23:36:38) and **unblock** (23:36:55) → DM push delivered (23:37:21). **Caddie completion push:** analysis `c25c8379` uploaded 23:40:22, complete 23:41:27, `caddie_analysis_complete` notification + push delivered to APNs 23:41:28. **Account deletion:** Micky deleted his second account `cd45207c` from Settings on 2026-10-03 00:39:47 (auth `user_deleted` via the delete-account function); verified nothing remains (auth user, profile, push tokens, posts, messages, Caddie analyses, storage objects all 0); users 26 → 25. **All section 9 two-account items passed on real accounts.**
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
- **IMPORTANT IMPROVEMENT:** reconcile Supabase migration history. Every local migration filename's version differs from the version recorded in production (applied via MCP `apply_migration`, matched by name), so `supabase db push` must not be used until `supabase migration repair` aligns them · Review Gate: allow a pre-approved migration apply inside a task (today it deadlocks) · Caddie historical backfill (staged, approval needed) · auto-fail stuck Caddie analyses · server-side past-date guard for rounds · auto-close past rounds · waitlist email throttle · email notifications for web-only users · round (group) chat push · round update/cancel push · unused-Storage sweep · leaked-password protection · **group DMs** (Micky, 2026-10-02: add people to a chat like WeChat/Instagram; C, deferred: new tables + RLS for membership/leave/remove/blocks, group push, filter on group messages, reworking the frozen DM screen; round group chats cover playing partners for now) · **global iOS keyboard mode** (Micky, 2026-09-30): switch from `KeyboardResize.Body` to an overlay mode so the keyboard slides over a fixed page and only sheets/composers adjust (visualViewport + internal scroll) across all text inputs, including chat (frozen today, re-tune and device-test); native config change, so it needs a new TestFlight build. Before launch, only Review Golfer and Ask Caddie are fixed within the current mode.
- **FUTURE IDEA:** see `AFTER_TESTFLIGHT.md`.

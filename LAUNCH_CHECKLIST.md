# GOLFME LAUNCH STATUS

**Target:** App Store launch → real NYC usage. golfme.app is live with open signup.
**Launched:** **1.0 live on the App Store** ("Ready for Distribution", build 2, seen 2026-10-17). **1.1 approved and live on the App Store 2026-10-18** (native launch screen + entry animation, Sign in with Apple + Google, email code sign-in); on-device check of the App Store build pending.
**Last updated:** 2026-11-06 (2.4 (1) TestFlight prepared: native appearance plugin, permission strings, version 2.4; see section 10a. Last uploaded build: 2.3 (1)). Earlier: 2026-10-25 (Founding Golfer applied on production: Kiyyah #1, next signup #2). Phase is now **post-launch**: ship 1.1 cleanly, then seed the marketplace (real rounds, Founding Golfer, outreach).

Statuses: `[ ]` NOT STARTED · `[~]` IN PROGRESS · `[?]` NEEDS VERIFICATION · `[!]` BLOCKED · `[x]` COMPLETE (only with evidence it works).
Classify every request: **A** blocks the launch going well (now: 1.1 release + marketplace) · **B** improves launch quality · **C** nonessential, later.

### CURRENT BLOCKERS
1. **1.1 live (2026-10-18) but not yet checked on the App Store build.** On the App Store build check: launch screen + entry animation (no cream flash), Sign in with Apple, Google, 6-digit email code (existing account, brand-new email, iOS autofill), and Sign in with Apple on a throwaway Apple ID → delete the account → confirm the `delete-account` logs show no "Apple token revocation not completed" (revocation never exercised for real). (A)
2. **No real upcoming rounds.** Production has 0 upcoming rounds; a new App Store user finds nothing to join. Host 3–5 real NYC rounds. (A — marketplace)
3. **Founding Golfer database live (2026-10-25).** The 2026-10-18 apply had rolled back; the revised migrations (Kiyyah #1, 11 pre-launch accounts excluded, next signup #2) were applied by Micky on 2026-10-25 with all post-checks passing. Remaining: see the #1 badge and "249 spots" on device. (A for launch marketing)
4. **No user acquisition yet.** 26 accounts, ~1 new per week; creator/community outreach not started (sections 11–12). (A)

### RESOLVED PRE-LAUNCH BLOCKERS (history)
Location privacy (DB rounding live 2026-09-30) · accurate Privacy Policy · Support URL · report → founder email → admin loop · Apple UGC 1.2 (Terms, filter, report, block, 24 h commitment) · two-account real-device QA (passed 2026-10-02/03, section 9) · App Store listing + review notes (1.0 approved) · Guideline 4.8 (Google hidden on iOS for 1.0; Sign in with Apple ships in 1.1) · reviewer sign-in · "Prototype" copy · account deletion (device-verified 2026-10-03).

### NEEDS VERIFICATION
On the 1.1 App Store build: blocker 1 items. Still-open device checks from earlier batches: push after signing back into the same account, password eye toggle, About/Reputation wording on a real account, "Use My Current Location", Report popup keyboard, Caddie history staying expanded, Host a Round course search above the keyboard, denied-permission push fallback, Caddie failure states. Dark mode (LIVE on the web since ed5bd37): status bar text colour, cream web-view edges and keyboard in dark are fixed natively in 2.4 (1) (`GolfMeAppearance` plugin + `Keyboard.setStyle`); check them on the 2.4 build (section 10a.3). Also unverified screens: profile editing, Home, discovery, search/filter, profile viewing, follow, DM from a profile.

### READY
1.0 on the App Store · email and Google signup/login with onboarding · golfme.app open signup · DM + round-join + Caddie push on real iPhones, tap → correct screen, token moves on account switch · two-account QA (host/join/leave/cancel, report, block/unblock, deletion) · `send-push` outcome logging + Settings Push status · Privacy, Terms and Support pages · Terms acceptance · objectionable-content filter · report handling · profile locations rounded to ~1 km · crash screen · Caddie pipeline with DB-enforced daily limit · private Caddie storage for new uploads · no secrets in tracked files or git history · `delete-account` v33 with Apple token revocation (secrets set).

### NEXT 3 ACTIONS
1. **Micky: run the blocker 1 checks** on the live 1.1 App Store build; Claude then checks the `delete-account` logs. (A)
2. **Founding Golfer:** applied 2026-10-25 (post-checks 15/15 + role check ok); check Kiyyah's #1 badge and "249 spots" live on golfme.app and iOS. (A)
3. **Seed the marketplace:** Micky hosts 3–5 real NYC rounds, then founder outreach to existing accounts + waitlist (`LAUNCH_MARKETING.md`). (A)

---

## 1. CORE PRODUCT
| Status | Item | Evidence / notes |
|---|---|---|
| [x] | Email signup/login | Fresh incognito email signup completed onboarding into the real app (Micky, 2026-09-28). Custom SMTP via Resend. |
| [~] | 6-digit email sign-in code | Live (`bb01f4b`). 2026-10-17: the code first went missing because the Dashboard "Magic link" template lacked `{{ .Token }}`. Micky pasted `supabase/templates/sign-in-email.html` into both "Magic link" and "Confirm signup", and the code now arrives (Micky, existing account). Still to check: typing the code in the app, a brand-new email, iOS code autofill. 2026-11-03 branch `fix/signin-support` (not deployed): code-first copy, email kept across Terms/Privacy and app switches, email autofill/validation/Enter, translated errors; headless-verified only, the device checks above still apply. (A) |
| [x] | Google signup/login | Fresh incognito Google signup completed onboarding (Micky, 2026-09-28). OAuth consent "In production". |
| [x] | Onboarding | Same two tests. 18+ checkbox required (`ProfileSetup.tsx`). |
| [x] | Profile setup (first-run) | Same two tests. |
| [?] | Profile editing / avatar / location | Code exists; no recent device check. |
| [?] | Home | No recent device check. |
| [?] | Golfer discovery | Real distance and server stats fixed in Batch E (P2-1/P2-2); not device-verified. |
| [x] | Host round | Real round hosted 2026-10-02 23:34:13 UTC (section 9). Past-date refusal still only verified headless in demo. Course search docks above the iOS keyboard (`0f51b56`), device check pending. |
| [x] | Join round | Real join 2026-10-02 23:34:24 UTC (section 9). |
| [x] | Leave / cancel round | Leave 23:34:34 and cancel 23:34:54 UTC on real accounts, 2026-10-02 (section 9). |
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
| [x] | Round join notification | Delivered to APNs on real accounts 2026-10-02 23:34:25 UTC (section 9). |
| [ ] | Round update / cancel push | Not implemented (V1 was joins only). In-app notifications only. (C unless you decide otherwise) |
| [ ] | Round (group) chat push | Not implemented; separate decision. (C) |
| [x] | Caddie completion push | Analysis `c25c8379` → push delivered to APNs 2026-10-02 23:41:28 UTC (section 9). |

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
| [x] | Final icon | Shipped with 1.0. |
| [x] | Six screenshots | Done for 1.0 (live 2026-10-17). Original brief: Concepts: 1 Find Your Next Round · 2 Never Golf Alone · 3 Meet Golfers Who Match Your Game · 4 Plan the Round Together · 5 Your AI Golf Caddie · 6 Build Your Golf Network. Real UI as template; replace real names, photos, messages and PII with fictional demo content. The real Caddie analysis screen may be the base for #5. |
| [x] | App name | "GolfMe", live on the App Store (1.0). |
| [x] | Subtitle | Entered for 1.0. |
| [x] | Promotional text | Entered for 1.0. |
| [x] | Description | Entered for 1.0. |
| [x] | Keywords | Entered for 1.0. |
| [x] | Category | Set for 1.0. Original suggestion: Sports (primary), Social Networking (secondary). |
| [x] | Support URL | `https://golfme.app/support` live (`fa3a27c`). |
| [x] | Privacy Policy URL | `https://golfme.app/privacy`, accurate rewrite live (`a286063`). |
| [x] | Terms URL | `https://golfme.app/terms` live 2026-09-29. |
| [x] | App Privacy disclosures | Entered for 1.0 (approved). For 1.1, Sign in with Apple was added to the Privacy Policy (2026-10-17). Full mapping with evidence in `APP_STORE_PRIVACY.md`: Name, Email, Coarse Location, Messages, Photos/Videos, Audio, Other User Content, User ID, Device ID (push token), Product Interaction (not linked, Analytics), Other Data; Tracking = No. Ready to enter in App Store Connect (D1 has shipped). |
| [x] | Age rating | Set for 1.0 (approved). Original note: social app with user-generated content and chat → likely 17+ unless moderation changes the answers. |
| [x] | App Review notes | Entered in App Store Connect by Micky 2026-10-03 (drafted text: what GolfMe is, "Sign in with a password" with the reviewer account, rounds by real golfers in NYC, UGC filter + report (24 h) + block + account deletion, native push and camera); sign-in info and contact email confirmed by Micky. |
| [x] | Review / demo credentials | Reviewer password sign-in verified on a real iPhone 2026-09-30 (blocker 8). Put the exact credentials in the App Review notes. |
| [x] | Login screen cleanup | Device-verified 2026-09-30: on the new screen Micky requested an email link (17:10:22 UTC) and signed in (17:10:53); push re-registered 1 s later. Details: Per Micky (2026-09-30): `/login` title is always "Sign in"; the email field shows directly with "Send sign-in link" (no "Continue with Email" step, and no keyboard popping up on load); Google is web-only; Terms/Privacy and "New here? Get Started" unchanged. Password sign-in, by Micky's decision: the iOS app keeps the small "Sign in with a password" link, because the reviewer can't add URL parameters there (verified for App Review); on the web it appears only with `?demo=1` or the new `?review=1`, which opens the email + password fields directly. `/signup` unchanged. No auth logic changes. Headless-verified (web + simulated iOS: `/login`, `?review=1`, `?demo=1`, `/signup`), 390 px, no horizontal scroll, 0 page errors. Deployed (task T-20260930-14656; GPT at its daily limit, Micky approved the diff); device re-check of sign-in pending. Review notes don't need the hidden route: the reviewer uses the visible in-app link. (B) |
| [x] | Keyboard: Review Golfer, Coach Review, comments, group chat, bio | **Device-verified 2026-10-02 by Micky** ("all works") after `b43eca2`: the keyboard no longer drags the screen in the Review Golfer popup, the post comment box, round group chat and the Edit Profile (bio) popup; DMs unchanged. Server follow-up 2026-10-02: a comment posted through the docked box (22:11:46 UTC); a post with a blocked word was rejected (22:12:11) and a bio with a blocked word was rejected (22:12:30, a clean bio save went through at 22:12:24). A group chat message sent through the docked box (22:14:19 UTC). History: Micky: the whole screen dragged up when the keyboard opened. Root cause (golfme-architect): in `KeyboardResize.Body` mode the plugin only sets `body.style.height`; the layout stays full height, so the keyboard covers the bottom-anchored sheet and iOS pans the whole surface to reveal the focused field. Fix (task T-20260930-08701; GPT CONTINUE, no findings; pushed for device testing with Micky's approval, gate deadlock workaround): an opt-in `keyboardAware` prop on the shared `Modal` (default off, so every other popup, including chat, is unchanged) lifts the sheet onto the keyboard, shrinks it to the visible area, scrolls only the sheet to keep the focused field visible (also on focus switches), restores its scroll position when the keyboard closes, and locks page scroll while open. Enabled on Review Golfer and Leave Coach Review. No native change, no new TestFlight build. tsc/lint/build pass; headless web check shows the default path unchanged. Remaining: iPhone test. Also found: `review.intro` shows a literal `{name}` (second placeholder unfilled, all 6 locales), a separate small fix. Comment composer on a post: Micky confirmed it jumps too and no comment ever reached the server. Fix (task T-20260930-04081; GPT CONTINUE with no findings after F1 fix; pushed for device testing with Micky's approval): while the keyboard is open the existing composer row docks in a fixed bar right above the keyboard (same input element, so focus is kept), a measured spacer holds its place, and page scroll is locked; web unchanged (headless: identical position/size, Post enables on typing). Round group chat (Micky: the textbox couldn't be seen while typing): same dock pattern inside GroupChat only, so the shared ChatComposer and DMs are untouched Combined batch (task T-20261002-02254; GPT CONTINUE with no findings; pushed for device testing with Micky's approval): the group chat dock (scroll lock + restore before paint), the Edit Profile popup (bio) on the same one-line `keyboardAware` opt-in, and the comment dock's scroll lock moved before paint. Remaining: iPhone test of all of these. Noted, unchanged: opening a round page scrolls the window down to the group chat (existing behavior). (B) |
| [~] | Bio on the Me page | Per Micky (2026-10-02, Instagram-style): your own bio now shows on the Me page under your name and stats (line breaks kept, long words wrap); empty shows "+ Add a bio" (6 languages), which opens Edit Profile. Others already see it on your golfer profile page (full) and on Discover cards (2 lines). Headless-verified at 390 px (shows, empty prompt opens the editor, no horizontal scroll). Live (task T-20261002-80506, GPT review DONE). (B) |
| [x] | Bio limit 150 characters | Per Micky (2026-10-02). App: the bio box stops at 150 with a live counter (headless: typing 170 keeps 150). Database: migration `profiles_bio_length` applied 2026-10-02 (recorded version 20261002225246; reviewed by golfme-architect; Micky approved the SQL; gate deadlock workaround). Rolled-back test: 150 accepted, 151 rejected. Longest existing bio 34. Security advisor: no new findings. (B) |
| [~] | Caddie history stays expanded | Per Micky (2026-10-02): after View more, opening an analysis and coming back kept collapsing the list. Now the expanded count is kept in sessionStorage while moving within /caddie* and cleared when leaving the Caddie section (task T-20261002-27347; GPT flagged a Strict Mode clear-on-unmount risk, removed; Micky approved the push). Headless: key kept across /caddie, /caddie/analyze, /caddie; cleared on /. Remaining: device check with a real account (demo has too few analyses). (B) |
| [x] | Keyboard: latest messages above the docked composer | Per Micky (2026-10-19): tapping the round group chat or a post comment box now scrolls the newest messages/comments to just above the docked bar (`233e057`, plus keyboard-height scroll room in `ba7e476` after the first version had nowhere to scroll). Device-verified by Micky 2026-10-19 ("works now"). DMs (frozen) and keyboardAware popups unchanged. (B) |
| [~] | iOS 26 pale band under the status bar | Micky 2026-10-19 (iPhone 18 Pro Max, 1.1): a frosted band over the dark entry screen. golfme-architect: iOS 26 top scroll edge effect on the web view; fix hides it in `GolfMeBridgeViewController` (`89650c0`, local, not compiled yet). Ships with the next App Store build (1.2); check on device from Xcode first. (B) |
| [~] | Keyboard: Report popup | Micky: the report text box was hidden while typing. The Report popup now uses the same `keyboardAware` Modal mode as Review Golfer and the bio popup (one line; task T-20261002-90425). Remaining: device check. (B) |
| [~] | Keyboard: onboarding (Quick Profile + location picker) | Micky, 2026-10-22, native iOS app during a real sign-up: the keyboard covered the "or choose manually" search in the location picker and the Handicap field + Continue button on Quick Profile. Root cause: same as the earlier popups. With `KeyboardResize.Body`, 100dvh/innerHeight stay full height, so bottom-anchored content stays under the keyboard. Fix on branch `fix/onboarding-keyboard` (not pushed): LocationPicker opts into the existing `keyboardAware` Modal mode (one line; also covers its uses in Find a Round, Match Preferences, Nearby Courses). Quick Profile sizes itself to end at the keyboard's top using the plugin's keyboardHeight, scrolls only its own scroller to the focused field, and keeps Continue right above the keyboard. `revealFocusedField` moved to `src/lib` to be shared. Web/PWA unchanged (keyboardHeight is 0 off-native). No native change. tsc/lint/build pass. Remaining: deploy (Micky's OK) and iPhone check. (A: onboarding) |
| [~] | Keyboard: dismiss on scroll | Micky, 2026-10-22, native iOS app: after typing in a search (Find Golfers) and scrolling the results, the keyboard stayed up and hid the bottom of the list. Fix on branch `feat/keyboard-dismiss-on-scroll` (not pushed): one app-wide hook (`src/lib/useDismissKeyboardOnDrag.ts`, mounted in AppGate). Native app only, only while the Keyboard plugin reports the keyboard open and a text field has focus: a one-finger, mostly vertical drag of more than 10 px that starts outside the focused field blurs the field (same as tapping outside). Never on taps, programmatic scrolls, drags inside the field, or while text is selected. Passive listeners, never blocks the scroll. Excluded: DM thread (frozen; excluded by route, file untouched), round group chat (its message list is what scrolls while the composer is docked), Host a Round course suggestions panel (the suggestions vanish without focus). Keyboard-aware popups no longer snap their scroll back when the keyboard was closed by a drag. Web/PWA unchanged. No native change. tsc/lint/build pass. Remaining: deploy (Micky's OK) and iPhone check. (B)
| [~] | Home feed: drag lag, swing video fullscreen, opening posts | Micky, 2026-10-22, iPhone: the feed lagged while dragging; after a swing video's native fullscreen the card flashed a black band; opening posts felt unstable. Fixes on branch `feat/swing-video-backdrop` (not pushed; root causes in DEVELOPMENT_STATUS): pre-blurred backdrop with the video box sized to its picture, 10 px tap slop, no in-app viewer double-open after native fullscreen, viewer portaled with the feed locked underneath, photo-carousel swipes never change tabs, Back from a post returns to the same feed position, double-open guard, fewer root-page re-renders. Opt-in perf HUD (`?perfhud=1`) gives before/after numbers on the phone. tsc/lint/build pass, not browser-tested. Remaining: Vercel previews of the HUD-only commit (before) and the branch tip (after), Micky's OK to push, HUD readings on the iPhone, then deploy. (B) |
| [~] | Keyboard: stays open after sending a chat message | Micky, 2026-10-23, native iOS app (screen recording): in a DM, tapping Send closed the keyboard and the textbox lost focus, so every message needed another tap on the box. Root cause: the Send `<button>` in the shared `ChatComposer` took focus on tap (mousedown default action), blurring the textarea. Fix on branch `fix/chat-keep-keyboard` (not pushed): Send now cancels mousedown so focus stays in the textarea (click, Enter and Space still send), with a fallback refocus inside the same tap only if the textarea had focus when pressed. Applies to DMs and round group chat (same shared component). DirectMessageThread itself (frozen viewport/keyboard-height/ResizeObserver code) untouched. tsc/lint/build pass. Remaining: deploy (Micky's OK) and iPhone check. (B) |
| [~] | Round chat: DM features (hold menu, reactions, unsend, reply, times) | Micky, 2026-11-05: round group chats had none of the DM interactions. Branch `feat/roundchat-parity` (uncommitted, not deployed): GroupChat uses the DM pieces (focus menu, reactions with the same write ordering, 5-minute unsend with placeholder + hidden admin copy, swipe-to-reply + quotes, swipe for times). Migration `20261107130000_round_chat_parity` PREPARED, NOT APPLIED (client feature-detects; deploy client first). Evidence: PGlite 59/59, headless demo 41/41, DM suites unchanged, tsc/lint/tests/build pass. Remaining: Micky's OK to commit/deploy, apply the migration, iPhone check (round page card with keyboard docked, two accounts live). (B) |
| [~] | Chat photos (DMs + round chats) | Micky, 2026-11-06: "add sending images in chat, beside the emoji button". Branch `feat/chat-images` (uncommitted, not deployed): photo button beside the emoji button, preview chip, one photo per message (+ optional text), upload progress, Not sent · Retry / Discard, re-encoded on the device (EXIF/GPS stripped, ≤2048 px, ≤2 MB), private `chat-media` bucket with per-viewer signed URLs, tap → fullscreen viewer, react / reply / copy / unsend, "📷 Photo" previews, "<name> sent a photo" bell/push, report photos in the admin dashboard. Migration `20261107170000_chat_images` PREPARED, NOT APPLIED (needs `20261107130000` first; client feature-detects, deploy client first). delete-account Edge Function change NOT deployed. Evidence: PGlite 105/105 (incl. 10 negative controls), headless demo 48/48, existing chat suites unchanged, 677 node tests, tsc/lint/build. Remaining: Micky's OK, apply both migrations, deploy delete-account, iPhone checks (camera / library / HEIC, keyboard with the chip, two real accounts). (B) |
| [~] | DM: swipe left to see sent times | Micky, 2026-10-25 (Telegram): show each message's sent time with an Instagram-style swipe. Branch `feat/chat-swipe-timestamps` (not pushed): drag the DM list left, every row slides over and its time (plus Yesterday / weekday / date for older messages, since the thread has no date separators) appears at the right edge; release springs back. Gesture only on the message list (pointer events, `touch-action: pan-y`, 8 px axis lock, one transform per frame); composer, keyboard height, viewport and scroll anchoring untouched. Headless touch-emulated check passed (swipe, vertical scroll, tap, reduced motion, en/ja). tsc/lint/build/tests pass. Remaining: Micky's OK to merge + deploy, then iPhone check (swipe, vertical scroll, keyboard + send unchanged). (C) |
| [~] | Courses: only real, named, playable courses | Micky, 2026-10-22, Hong Kong Nearby Courses (Chinese UI): street names shown as courses, plus a mini-golf course and driving ranges. Fix on branch `fix/legit-courses-only` (not pushed): shared filter `supabase/functions/_shared/courseFilter.ts` used by `course-search` (unnamed features dropped instead of named after their street; mini golf / driving ranges / non-course venues dropped by OSM tags first, name keywords EN/ZH/JA/KO last; not cached) and by the web client for nearby + search lists. No migration, no DB change. Unit tests `npm run test:courses` (6 pass); tsc/lint/build pass. Remaining: Micky's OK to web deploy and to deploy `course-search`, then re-check Hong Kong Nearby on the iPhone. (A: discovery) |
| [~] | Home: available rounds below Tee Times | Per Micky (2026-10-03): rounds sit right below the Tee Times card (first placed under the greeting, then moved down at Micky's request, task T-20261002-99558). Nearby (25 mi) first; otherwise the newest open rounds anywhere ("Open rounds"); with none at all, a "No rounds yet" card with Host a Round. 6 languages. Headless-verified in all three states (task T-20261002-18663, GPT review DONE; live). (B) |
| [~] | Home launch polish | Per Micky brief (2026-10-03): ~80 px tighter Home (gaps 24->20 / 12->10 px), quieter greeting with a bigger "Ready to golf?" line, a more compact Tee Times card, host avatar inline with "hosted by" on round cards (avatar row only for other golfers), softer vibe/Competitive tag. Shared round card, so Play and match screens get the same card change. Live (task T-20261002-76486, GPT review DONE). Search-bar clipping: waiting on Micky's screenshot. (B) |
| [~] | Password show/hide toggle | Requested by Micky after 5 mistyped reviewer-password attempts. An eye / eye-off button inside the password field on `/login` (44×46 px; its `aria-label` switches between Show and Hide password, in 6 languages); hidden by default; autocapitalize/autocorrect off. Headless-verified (simulated iOS): password → text → password, value kept, 0 page errors. GPT reviewer hit its daily call limit, so Micky reviewed the diff and approved it (2026-09-30, task T-20260930-25411). Live after deploy; device check pending. (B) |
| [x] | Branded sign-in email | Supabase Auth sends it (not app code) via the Resend SMTP; the templates live only in the Supabase Dashboard. Tracked copy: `supabase/templates/sign-in-email.html` (paste steps in the README there). Corporate transactional layout (per Micky): subject "Sign in to GolfMe", gold + forest accent line, logo + wordmark top-left, left-aligned copy, 48 px forest button, fallback link, separate footer (Support · Privacy · Terms, automated-email note, © 2026). Link only via `{{ .ConfirmationURL }}`. Headless previews at 375 and 700 px (light, dark, images blocked): no horizontal scroll. **Live 2026-09-30:** Micky saved it into **Magic link** and **Confirm signup** (config reloads 08:39:01 and 08:39:12 UTC). Sign-in from the emailed link verified with the first design (request 08:34:02 → `/verify` 303 → login 08:34:16, same flow and variable); first email with the new design requested 08:39:32. Micky confirmed the new design on his iPhone (2026-09-30). The GPT reviewer hit its daily limit; Micky approved the diff (task T-20260930-15914). **Refinement (per Micky, 2026-09-30):** button kept dark forest in dark mode (it had switched to a lighter green), a compact "Trouble signing in?" fallback with a smaller link, tighter spacing and a more compact footer. Saved into both templates (reloads 08:50:03 and 08:50:19 UTC); Micky confirmed the email requested at 08:51:14 looks right. (B) |
| [~] | Permission strings | 2026-11-06 (2.4): camera / photo library / microphone strings rewritten for chat photos and voice messages, `NSPhotoLibraryAddUsageDescription` added (Save Image would crash without it); English only (no InfoPlist.strings). Device check of the prompts on 2.4 pending. Earlier: Location, photos, camera and microphone descriptions present in `Info.plist`. `ITSAppUsesNonExemptEncryption = false` added (standard HTTPS only; skips the export-compliance question on each upload); takes effect with the next Xcode archive (committed with task T-20260930-19042). (B) |
| [~] | iPhone-only app | App Store Connect asked for iPad screenshots because the app target declared TARGETED_DEVICE_FAMILY = "1,2" (iPhone + iPad). Changed to 1 (iPhone only) in Debug and Release, nothing else (task T-20261003-92442). Takes effect with the next uploaded build; then the iPad screenshot requirement goes away. |
| [x] | Final release-candidate build | 1.0 = build 2 (live 2026-10-17). 1.1 approved and live 2026-10-18. |

## 5. LEGAL / TRUST
| Status | Item | Evidence / notes |
|---|---|---|
| [x] | Privacy Policy | Rewrite live (`a286063`); the 10 disagreements it fixed are listed in `APP_STORE_PRIVACY.md`. |
| [~] | Location privacy | The DB trigger + backfill are live and verified 2026-09-30 (0 precise values; a non-owner sees at most 2 decimals); client rounding live (`a286063`). No other API path returns user coordinates. Device check of "Use My Current Location" pending. |
| [x] | Terms of Service | Live at `/terms` (approved by Micky, GPT review DONE). |
| [x] | Account deletion | Device-verified 2026-10-03 (section 9). `delete-account` v33 adds Apple token revocation (not yet exercised: blocker 1). |
| [x] | Report user / content | Verified end to end 2026-09-30 (see Report handling). |
| [x] | Block user | Block (23:36:38) and unblock (23:36:55 UTC) on real accounts, 2026-10-02 (section 9). |
| [x] | User-generated-content safeguards | Terms acceptance + zero-tolerance clause, reporting, contact, objectionable-content filter (device-verified for DMs, post, bio) and blocking (section 9) all done; 1.0 approved. |
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

Update 2026-10-22 (branch `feat/first-round-prompt`, not deployed): `track()` now sends anonymous +1 daily counts for 5 funnel events (`first_round_prompt_shown`, `first_round_host_started`, `first_round_hosted`, `round_shared`, `app_shared`) to `analytics_daily_counts` via `track_analytics_event`, real signed-in accounts only, never from dev; admin read RPC `admin_analytics_daily_counts` (not yet on the dashboard). Needs migration `20261022130100` applied.

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
- [x] 1.0 (build 2) approved and live 2026-10-17.
- [x] 1.1 (launch screen, entry animation, Sign in with Apple + Google, email code) submitted 2026-10-17, approved 2026-10-18.
- [x] 1.1 live on the App Store 2026-10-18.
- [ ] Run blocker 1 checks on the 1.1 App Store build.
- Every later native change ships as a new App Store version: `git pull` + `npx cap sync ios` on the Mac, bump Version/Build in Xcode, archive, upload, submit.

## 10a. NEXT BUILD: 2.4 (1) TESTFLIGHT (prepared 2026-11-06, branch `chore/testflight-next`; NOT ready to archive until `@capacitor/camera` lands)
Prepared 2026-11-06 on branch `chore/testflight-next` (worktree `.claude/worktrees/testflight-next`, based on origin/main 801fa77; not committed or pushed yet). The last uploaded build was **2.3 (1)**. This one is **2.4 (1)**.

#### 0. What is native in this build (needs the Xcode archive)

| File | Change |
|---|---|
| `ios/App/App.xcodeproj/project.pbxproj` | `MARKETING_VERSION` 1.0 → **2.4** (Debug + Release). `CURRENT_PROJECT_VERSION` stays **1**. The repo said 1.0 (1), not 2.3 (1): the real numbers only ever lived on the Mac. |
| `ios/App/App/AppleSignInPlugin.swift` | New app-local plugin `GolfMeAppearance` (`setAppearance({appearance: light/dark/system})`). It sets the window's interface style, so the status bar text, the photo picker, camera, share and Apple sheets follow the app's Light/Dark setting instead of the iPhone's. The web view and its scroll view get a light/dark page colour (cream `#faf9f6` / `#0d1210`) instead of fixed cream. |
| `ios/App/App/SceneDelegate.swift` | Window background = the same light/dark page colour (behind the web view while the keyboard animates). |
| `ios/App/App/Info.plist` | Permission strings rewritten (below), plus a new `NSPhotoLibraryAddUsageDescription` (iOS's "Save Image" on a photo would crash without it). |
| `capacitor.config.ts` | Comment only (backgroundColor is now replaced natively). |

Web side (ships with a Vercel deploy and works on old builds too): `src/lib/nativeAppearance.ts` + one line in `useAppearance.ts`. On every appearance change it calls the new plugin (only if the build has it) and `Keyboard.setStyle` (in every build, so **the dark keyboard fix also reaches 2.3 users** after the web deploy). Test: `tests/nativeAppearance.test.ts`.

No new npm package and no Package.swift change. `@capacitor/status-bar` is **not** installed and isn't needed: the window style override fixes the status bar, sheets and keyboard in one place, without a new dependency.

Permission strings (English only; the app has no `InfoPlist.strings` translations yet):
- Camera: "GolfMe uses the camera so you can take photos and record swing videos for posts, chats, Caddie and your profile picture."
- Photo library: "GolfMe uses your photo library so you can choose photos and swing videos for posts, chats, Caddie and your profile picture."
- Photo library (add): "GolfMe saves a photo or video to your library only when you choose to save it."
- Microphone: "GolfMe uses the microphone to record swing videos and voice messages."
- Location: unchanged.

#### 1. On the Mac

> **NOT READY TO ARCHIVE YET.** 2.4 (1) will also include `@capacitor/camera` (native one-tap photo pick for the chat image button), which the golfme-architect is building separately. Don't run steps 3–9 until that is merged to main. Then `npm install` brings in the plugin, and `npm run ios:sync` should report **7** Capacitor plugins (adds `@capacitor/camera`) and change `ios/App/CapApp-SPM/Package.swift` (commit that change). The camera and photo-library strings below already cover it. Re-check this list against the merged main before archiving.

1. **Get the branch.** Your local `project.pbxproj` changes (Team, version) will block the pull, so stash them first:
   `git stash` → `git pull` (after this branch is merged to main) → `git stash pop`. If `stash pop` conflicts in `project.pbxproj`, keep **2.4 / 1** for the version lines and keep your `DEVELOPMENT_TEAM` lines.
2. `npm install` (no new packages, but it keeps node_modules in step with the lockfile).
3. `npm run ios:sync`. It builds the web app and runs `npx cap sync ios`. Expect "Found 7 Capacitor plugins" once `@capacitor/camera` has landed (6 without it); `Package.swift` then gains CapacitorCamera.
4. `npm run ios:open` (or open `ios/App/App.xcodeproj`).
5. Xcode: scheme **App**, destination **Any iOS Device (arm64)**.
6. Target App → General: check **Version 2.4**, **Build 1**. Signing & Capabilities: Team set; capabilities Push Notifications, Sign in with Apple and Associated Domains (`applinks:golfme.app`) all present.
7. Optional but recommended: run it once from Xcode on your iPhone (Debug) and do the "native" checks in section 3 before archiving.
8. Product → **Archive**.
9. Organizer → the new archive → **Distribute App** → **App Store Connect** → **Upload**. Keep automatic signing and "Upload symbols". The export-compliance question is skipped (`ITSAppUsesNonExemptEncryption = false`).

#### 2. In App Store Connect

1. TestFlight → iOS builds: wait for **2.4 (1)** to finish processing (an email arrives; usually 5–30 min).
2. If it shows "Missing Compliance", answer No (standard HTTPS only).
3. Paste the **What to Test** note (section 5b) into the build's Test Details.
4. Internal Testing → your group → add build 2.4 (1) (or turn on automatic distribution). Add internal testers if needed (App Store Connect users only).
5. Install from the TestFlight app on the iPhone and run section 3.
6. When you submit 2.4 for review: create version **2.4** on the App Store tab, select build 2.4 (1), paste **What's New** (section 5c), update the **App Review notes** (section 4), check **App Privacy** (section 6).

#### 3. What to test on the iPhone

**New native behaviour in 2.4 (needs this build)**
- [ ] Settings → Appearance → **Dark** on a **Light** iPhone: status bar text is white; the keyboard is dark; no cream edges when the keyboard opens or closes (DM, round chat, post comment, a search field); the photo picker, camera, share sheet and Apple sign-in sheet are dark.
- [ ] **Light** on a **Dark** iPhone: status bar dark text, light keyboard, light sheets.
- [ ] **Match iPhone**: switch the iPhone between Light and Dark in Control Centre while the app is open. The app, status bar and keyboard follow, and nothing gets stuck.
- [ ] Cold launch in each mode: the launch screen goes straight to the app with no cream or black flash.
- [ ] Permission prompts show the new text: camera (photo in chat or Caddie record), photo library, and microphone (first Caddie recording, or a voice message once that ships).
- [ ] Long-press a chat or community photo → "Save to Photos" asks permission and doesn't crash.
- [ ] Still fine from earlier native builds: no pale band under the status bar (iOS 26); a round link from Messages/Notes (`golfme.app/golf-calls/…`) opens the app on that round.

**Shipped on the web since 2.3, still not checked on a real iPhone**
- [ ] Sign-in: Sign in with Apple (native sheet), Google, Email → six-box code (iOS code autofill from Mail), a brand-new email, "Sign in with a password" link visible in the app (the reviewer path).
- [ ] Dark mode overall: safe areas, the landing page stays light, the loader.
- [ ] Haptics: light tap on buttons, tabs, bell and inbox rows; medium on Send; success after Join, Host and Post. Press-down scale doesn't flicker when a scroll starts on an Inbox row.
- [ ] DMs: hold a message → lifted bubble + reactions menu (also with the keyboard open; the keyboard stays up); reactions, Reply, Copy, Unsend (5 min); swipe left for times; swipe right to reply; Send keeps the keyboard open; long messages grow the box without jumping; a failed send shows Retry/Discard; Back from a push-opened thread lands on Inbox; new-messages pill.
- [ ] Round chat: the same hold menu, reactions, reply and unsend, on the round page card with the composer docked over the keyboard and on `/messages/round/…`; two accounts reacting and unsending live.
- [ ] **Native photo pick (new in 2.4, `@capacitor/camera`)**: the chat photo button opens the iOS picker in one tap with no extra confirm screen; Camera and Library both work; cancelling leaves the composer and keyboard as they were; the permission prompts show the new text; denied permission shows a clear message.
- [ ] Chat photos (**only after migration `20261107170000_chat_images` is applied**; the button stays hidden until then): library and camera, a HEIC from the camera roll, portrait orientation, the chip with the keyboard open, progress on a slow network, push text "sent a photo", unsend removes it on the other phone.
- [ ] Reaction "+" emoji picker (after migration `20261107160000`): grid scrolls inside the overlay, search, skin tones.
- [ ] Voice messages (when shipped): hold to talk, mic prompt, playback with the silent switch on, app backgrounded mid-recording.
- [ ] Bell: opening a chat, round or post clears its notifications; actor photos in the banner.
- [ ] Rounds: round-update push (tee time/course/date change, cancel) reaches the joined players; Auto-Match one tap; booking status labels on cards.
- [ ] Caddie: "Change section" on a long clip; a failed analysis shows a clear message and Try again; the history list stays expanded; with Caddie set to another language, all Caddie screens follow it.
- [ ] Courses: course map (pins fade in, tap pin → card → details sheet, Back/swipe closes the sheet); drone overview orbit smooth, Layout toggle, no crash on big courses (GPU memory).
- [ ] Keyboard (from earlier batches): onboarding location search + handicap, Report popup, Host a Round course search, comment box.
- [ ] Push: sign out and back into the same account → DM push still arrives with no Settings step; Settings → Push status.
- [ ] Founding Golfer #1 badge and spots counter.
- [ ] Blocker 1 (still open): Sign in with Apple on a throwaway Apple ID → delete the account → Claude checks the `delete-account` logs for Apple token revocation.

#### 4. App Review notes (replace the old text in App Store Connect → App Review Information → Notes)

Fill the Sign-in Information fields with the reviewer account's email and password (from your private notes, not from the repo). Notes:

> GolfMe helps golfers find playing partners: host or join real rounds ("Golf Calls") near you, chat with other golfers in direct messages and round group chats (text and photos), share posts in the Community, and get AI swing feedback from "Caddie".
>
> How to sign in: on the sign-in screen, tap "Sign in with a password" (small link under the main buttons) and use the demo reviewer account in Sign-in Information. Sign in with Apple, Google and a 6-digit email code are also available; the email code is sent to the address you type.
>
> Rounds are hosted by real golfers, mostly in New York City, so the list near you may be empty; the reviewer account can host a round from Play → Host a Round.
>
> Safety (Guideline 1.2): users must accept the Terms (zero tolerance for objectionable content) before using the app; objectionable text is filtered on the server; any profile, post, comment or message can be reported (we act within 24 hours) and any user can be blocked. Accounts can be deleted in Me → Settings → Account → Delete account.
>
> Permissions: camera, photo library and microphone are used only when you choose to take or pick a photo or video, record a swing, or record a voice message; location is used to show nearby courses and rounds and is rounded to about 1 km. Push notifications are used for messages, round updates and Caddie results.
>
> Appearance: Settings → Appearance offers Light, Dark or Match iPhone.

Remove the voice-message words if voice isn't live on golfme.app when you submit. The repo never held the old notes text verbatim (only a summary in `LAUNCH_CHECKLIST.md`), so check the current App Store Connect text for "magic link" or "sign-in link" and replace it. Sign-in is now by code, not link.

#### 5. Release notes

The baseline is 2026-10-29: the last native commit was f1f0db1 on 2026-10-28, and the status file says the Mac moved to main on 10-29 for "the next 2.x build". The repo never recorded when 2.3 (1) was archived, so confirm the date. TestFlight users on 2.3 have already been getting the web changes live, because the app loads golfme.app.

##### 5a. Changelog since 2.3 (user-facing, grouped)

**Chat**
- Hold any message for a reactions menu: ❤️😂😮😢😡👍, Reply, Copy and Unsend (within 5 minutes), with a lift-and-blur focus effect.
- Round group chats now have everything DMs have: reactions, replies with quotes, unsend, swipe to see times, tap an avatar for the profile.
- Swipe right to reply, swipe left to see when each message was sent.
- Send keeps the keyboard open; the message box grows smoothly; a failed send shows Retry/Discard and never overwrites what you typed next.
- Opening a chat from a notification no longer jumps; a "new messages" pill; always scrolls to your newest message after sending.
- Photos in chat: a photo button next to the emoji button, location data stripped, private to the chat (switches on once the server update is applied).
- Faster photo picking in chats: one tap opens the native picker, with no extra confirm screen (new native plugin in 2.4).
- "+" opens the full emoji picker for any reaction (once its server update is applied).
- Unsent drafts are cleared on sign-out and account deletion.

**Rounds**
- Auto-Match in one tap: it widens preferences, distance and date step by step and suggests golfers to invite.
- Players get a push when a round's tee time, course or date changes, or it's cancelled.
- Honest booking labels: "Booked · Host reported" vs "Booking status not provided"; the join sheet explains that joining doesn't book a tee time.
- Simpler round cards; clearer match labels ("preference match" vs compatibility).
- Notifications for new rounds near you and posts from your Golf Circle (with switches in Settings).
- Host a Round and Find: safer number fields, no double submits, past dates blocked, search kept when you come back.

**Caddie**
- More reliable analyses: clear failure messages, Try again reuses the same job, and failures don't count against your daily limit.
- "Change section" lets you re-pick the 10-second part of a long video.
- Coach Replay with per-checkpoint coaching cues and "Work on this next" first.
- Caddie's language picker translates all of Caddie (screens and feedback) without changing the app language; feedback auto-translates.
- Judges the lead arm only; camera-angle-aware checks; Putter removed from the club picker.

**Courses**
- Courses near you on a map (up to 100 pins), tap a pin for a card and a details sheet.
- Course pages with framed aerial photos, a drone-style 3D overview and the course layout (fairways, greens, bunkers, water, hole numbers).
- Search finds courses by name; only real, playable courses are listed.

**Profile and directory**
- A public golfer directory with distance ranges and a real "Discoverable" switch.
- "New to GolfMe" badge for a golfer's first 30 days.
- Message and Invite to play buttons on profiles; Google profile photo suggested at setup.
- The unblock list always shows every blocked contact.

**Sign-in**
- One clean Apple / Google / Email screen; the email option sends a 6-digit code with a six-box entry screen and a resend timer.
- Your email is kept when you switch to Terms or another app; translated errors; a notice when you've been signed out.

**Look and feel**
- Dark mode: Settings → Appearance → Light, Dark or Match iPhone.
- New in 2.4: the status bar, keyboard and system sheets follow the app's appearance, with no cream edges in dark mode.
- Haptics on taps, Send and successful actions, plus a subtle press effect on buttons.
- Bell: unread first, read items fold into "Earlier", and opening something clears its notifications. Profile photos on notifications.
- New loader with the app-icon mark; the Home Community feed keeps loading as you scroll; a 5-step tutorial (including Appearance).

**Fixes**
- Clearer permission prompts for camera, photos and microphone; saving a photo to your library now asks properly.
- Keyboard fixes on sheets and search fields; bigger tap targets across the app.
- More translations (Create Post, comments, profiles, match reasons, join sheet).
- Notifications no longer replay on a new device; Rounds and Community refresh when you come back to the app.
- Swing videos in the feed fill the card, with no black thumbnails.

##### 5b. TestFlight "What to Test" (paste into Test Details)

```
GolfMe 2.4 (1)

New in this build (native):
- Dark mode now reaches the system parts of the app. Try Settings > Appearance > Dark while your iPhone is in Light mode (and the reverse). Check the status bar text, the keyboard, the photo picker, camera and share sheets. There should be no cream edges when the keyboard opens or closes.
- Match iPhone: switch your iPhone between Light and Dark while GolfMe is open. Everything should follow.
- Chat photo button: one tap should open the native photo picker (no extra confirm screen). Try Camera and Library, and cancelling.
- New permission wording for camera, photos and microphone. Long-press a photo and choose Save: it should ask for permission, not crash.

Please also try (shipped recently):
- Chat: hold a message for reactions, reply, copy and unsend. Swipe right to reply, swipe left for times. The same in round group chats.
- Sending keeps the keyboard open. Try long messages and a bad connection (Retry / Discard).
- Photos in chat (if the photo button is there): library, camera, HEIC photos, sending with the keyboard open.
- Sign in: Apple, Google, and the 6-digit email code (try iOS autofill from Mail).
- Haptics: taps, Send, joining/hosting a round, posting.
- Caddie: upload a long video and use Change section; check failure messages.
- Courses: the course map and a course page's drone overview and Layout toggle.
- Bell: opening a chat or round clears its notifications.
- Push: round-change notifications, and signing out and back in.

Report anything odd with a screenshot: TestFlight > Send Beta Feedback.
```

##### 5c. App Store "What's New" (2.4)

```
A big update for GolfMe:

• Dark mode: choose Light, Dark or Match iPhone in Settings > Appearance. The status bar, keyboard and system sheets follow too.
• Better chat: hold any message to react, reply, copy or unsend. Swipe to reply or see when a message was sent. Round group chats now do all of this too.
• Photos in chat: share a photo in direct messages and round chats, picked in one tap.
• Courses on a map: browse courses near you, and open course pages with aerial photos, a drone-style overview and the hole layout.
• Auto-Match in one tap: GolfMe widens the search step by step and suggests golfers to invite.
• Round updates: get notified when a round's time, course or date changes, or it's cancelled.
• Caddie: more reliable analyses, clearer messages if something goes wrong, re-pick the part of a long video, and feedback fully in your chosen language.
• Simpler sign-in with Apple, Google or a 6-digit email code.
• Haptics and smoother taps throughout, a tidier notification bell, and many fixes and translations.

Thanks for playing with GolfMe. See you on the course!
```
(Only keep "Photos in chat" if the chat-images migration is applied before release.)

#### 6. App Store Connect: App Privacy and privacy manifest

- **App Privacy label: no new selections needed.** Already declared: Photos or Videos (linked, App Functionality) covers chat photos. Audio Data (linked, App Functionality) covers voice messages. Coarse Location covers the map area. Product Interaction stays as it is. Open App Privacy and confirm that "Photos or Videos" and "Audio Data" are both still ticked and **linked to the user**. If "Audio Data" was ever left out, add it now for voice messages (Collected, Linked, not Tracking, App Functionality).
- **PrivacyInfo.xcprivacy:** none in the app target. The app's own Swift code uses no required-reason API, and Capacitor ships its own manifest. Only add one if App Store Connect emails an ITMS-91053 warning after the upload.
- **Privacy Policy (golfme.app/privacy), recommended before submitting 2.4.** This is legal copy, so it isn't edited in this branch.
  1. Under "Content you create": "photos and voice messages you send in direct messages and round chats (visible only to the people in that chat)".
  2. A new provider bullet: "**Map and course imagery**: OpenFreeMap/OpenStreetMap map tiles, USGS aerial imagery, Wikimedia Commons photos and the Overpass API (course layouts). When you view a map or course, your device requests images for that area from them; no account information is sent." If `GOOGLE_PLACES_API_KEY` is set for `course-photos`, add "Google Places (course photos; only course names and locations are sent)". The same goes for MapTiler/Mapbox if their keys are set.
  3. "sign-in links" → "sign-in codes" (How we use it; Resend bullet).
  4. Consider dropping `maps.mail.ru` from the Overpass mirrors (VK, Russia; it sees the viewer's IP), or name it in the policy.

## 11. MARKETPLACE SEEDING (NYC) — no fake users or activity in production
| Status | Item | Notes |
|---|---|---|
| [!] | Real hosted rounds available | 0 upcoming (2026-10-18). |
| [ ] | Initial real users recruited | ~26 accounts (25 after the QA deletion), ~1 new per week. |
| [~] | **First Round Hosting Onboarding** (A — marketplace: rounds to join) | Branch `feat/first-round-prompt` (2026-10-22, not pushed/deployed). Popup "Host your first round" after the tutorial / at session start for real accounts that never hosted (never demo, never over another modal, never mid-session); Maybe Later → `profiles.first_round_prompt_dismissed_at` (never again, any device) + Home card until the first round exists. Host Share button + share card after hosting (native share sheet or copy link; course/date/time + round link only). Signed-out round link → sign in/up → that round. Universal Links prepared (AASA Team ID placeholder). Anonymous daily counts (`analytics_daily_counts`). Evidence: `tsc -b`, lint (0 errors), build, `test:courses` 6/6, `test:onboarding` 17/17; harness bundle absent from `dist`; both migrations role-simulated in PGlite; screenshots of popup (en, zh-CN), Home card, share card + copy fallback from a DEV-only harness. **Not yet:** migrations applied (needs Micky's OK), device check of the popup + share sheet in the iOS app, real Team ID, Universal Links (needs a Mac build). |
| [ ] | Creator hosts | See section 12. |
| [ ] | Micro-creator outreach | |
| [ ] | Golf communities | |
| [ ] | College golfers | |
| [ ] | Simulator communities | |
| [ ] | Local golf pages | |
| [ ] | Founder-led outreach | |
| [~] | **Founding Golfer launch hook** — **database APPLIED 2026-10-25** (B, Micky chose it for launch marketing 2026-10-07) | The first 250 NYC golfers get a permanent numbered badge. Migrations `20261006120000` (cohort, created closed) and `20261006120100` (exclusions, opening, backfill). **Correction 2026-10-25:** this row said "Applied 2026-10-18, #1–#7 awarded"; the 2026-10-24/25 read-only pre-checks found no founding objects and nothing recorded since 20261006, so that run rolled back. **Decision 2026-10-25 (Micky, replaces 2026-10-12):** Kiyyah (`93c351a5`) is #1; the 11 accounts eligible before them are excluded with the new `pre_launch` role (real people, Founding-only meaning); reviewer `24c3c140` + 2 test accounts stay excluded (3 original test ids no longer exist); future signups continue from #2, automatically. Safety: any unknown/deleted id aborts; the backfill rolls back unless exactly the expected list is awarded (a new eligible signup before apply aborts it, re-run pre-check and edit the list). PGlite 31/31. Branch `fix/founding-backfill-kiyyah`. `20261022120000` (global-hosting) needs the `pre_launch` one-line patch before it is applied. Evidence 2026-10-25 (production): precheck_1 23/23, precheck_2 only Kiyyah numbered, both versions in `schema_migrations`, postcheck_1 15/15 (#1 93c351a5, next 2, remaining 249, pre_launch=11), postcheck_2 role check as expected. Remaining: check badge + counter live on device. Plan: `LAUNCH_MARKETING.md`. |

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
- [ ] Founder outreach sent (existing accounts + waitlist: "We're live, Founding Golfer spots are open"; see `LAUNCH_MARKETING.md`).
- [ ] Founding Golfer cohort open, badge visible, spots-left counter correct.
- [ ] Monitoring: check logs morning, midday and evening.
- [ ] Respond to early users (DMs to Micky via the founder welcome chat) within hours.

## 14. POST-LAUNCH
Look for repeated evidence before expanding scope; don't implement every suggestion immediately.
- **CRITICAL BUG:** (none yet)
- **Telegram attachments (2026-10-03, dev tooling):** a local Read deny rule protecting the bot credentials also blocked the plugin inbox. Fix: PostToolUse hook `tools/telegram-inbox/copy-attachment.mjs` on the plugin download tool copies validated attachments (png/jpg/jpeg/webp/txt/pdf/mp4, 50 MB cap, magic-byte check, inbox-only source, sanitized unique names, 24 h cleanup) into gitignored `.claude/inbox/` and hands Claude that path; deny rule unchanged. Screenshots must be sent with Telegram "Send as File" (plain photo messages skip the download tool). Verified live with a .txt. **Update 2026-10-17 (Micky, at the laptop):** the broad `Read(~/.claude/channels/**)` deny was narrowed to `telegram/.env` + `telegram/access.json`, with `Read(~/.claude/channels/telegram/inbox/**)` allowed, so plain photo messages are readable too (verified with an Xcode screenshot).
- **Review Gate notes (2026-09-30):** payload limit raised 60k → 120k characters (Micky approved) after a combined launch batch was truncated; the Resend shared sender address was added (by hash) to the redact-only list.
- **IMPORTANT IMPROVEMENT:** reconcile Supabase migration history. Every local migration filename's version differs from the version recorded in production (applied via MCP `apply_migration`, matched by name), so `supabase db push` must not be used until `supabase migration repair` aligns them · Review Gate: allow a pre-approved migration apply inside a task (today it deadlocks) · Caddie historical backfill (staged, approval needed) · auto-fail stuck Caddie analyses · server-side past-date guard for rounds · auto-close past rounds · waitlist email throttle · email notifications for web-only users · round (group) chat push · round update/cancel push · unused-Storage sweep · leaked-password protection · **group DMs** (Micky, 2026-10-02: add people to a chat like WeChat/Instagram; C, deferred: new tables + RLS for membership/leave/remove/blocks, group push, filter on group messages, reworking the frozen DM screen; round group chats cover playing partners for now) · **global iOS keyboard mode** (Micky, 2026-09-30): switch from `KeyboardResize.Body` to an overlay mode so the keyboard slides over a fixed page and only sheets/composers adjust (visualViewport + internal scroll) across all text inputs, including chat (frozen today, re-tune and device-test); native config change, so it needs a new TestFlight build. Before launch, only Review Golfer and Ask Caddie are fixed within the current mode.
- **Sign in with Apple + Google in the iOS app → `[x]` merged, on for native builds with the plugin, approved in 1.1 (2026-10-18); App Store build check is blocker 1. History (2026-10-17):** Native Apple sheet via an app-local plugin (`ios/App/App/AppleSignInPlugin.swift`, entitlement `com.apple.developer.applesignin`) + `signInWithIdToken`; Google keeps the existing Supabase OAuth in the system browser (`@capacitor/browser`). Both appear only on a native build containing the plugin AND with `SOCIAL_SIGN_IN_ENABLED` (src/lib/socialSignIn.ts) or the founder test switch (About → tap the logo 7×), so the build in review and the web are unchanged. Account deletion revokes Apple tokens (new optional body field in `delete-account`, needs the `APPLE_*` secrets and a function deploy). Remaining: Micky's dashboard steps (Apple capability + key, Supabase Apple provider, Apple email relay), merge with `native-launch-screen`, one Mac build, the device test matrix, Privacy Policy line for Apple, then flip the flag.
- **Security / trust page (Micky, 2026-10-17, queued; B):** a short public page for when partners ask about SOC 2. GolfMe itself has **no** SOC 2 audit (never say "SOC 2 compliant/certified"). Honest points: Supabase and Vercel are SOC 2 Type 2 audited vendors (confirm on their trust pages before publishing); database row-level security on every user table; encryption in transit and at rest; Privacy Policy, Terms, support@golfme.app. If a real B2B deal needs SOC 2, look at Vanta/Drata then. Start after App Review and the native launch-screen test.
- **Next native build (launch screen + Apple/Google sign-in) → `[x]` shipped as 1.1 (approved 2026-10-18). History, 2026-10-17:** Micky is happy with the entry animation and wants it on for everyone, but only with the new build (the build in review still has the old logo launch image, so the hand-off would jump). Before/with that submission: turn the entry animation on for builds with the SplashScreen plugin (or flip it when approved), set `SOCIAL_SIGN_IN_ENABLED = true`, deploy `delete-account` with the Apple key secrets, add Apple sign-in to the Privacy Policy, register golfme.app for Apple's private email relay, and mention Sign in with Apple in the review notes.
- **Engagement push nudges (Micky, 2026-10-17, queued; B):** native push nudges such as "Host your first round with friends" (no hosted round yet) and "Try AI Caddie" (no analysis yet). Apple 4.5.4: promotional push needs explicit opt-in plus an in-app opt-out, so add a separate "Tips & reminders" notification setting (off by default or clearly asked), keep it apart from transactional pushes (DMs, rounds, Caddie done). Server-side schedule (e.g. day 2 / day 5 after signup), at most ~1 nudge per few days, stop once the action is done, quiet hours by the user's timezone, 6-language copy. Uses the existing direct-APNs sender; needs a schema/migration for preferences + sent-log (architect). Start after App Review.
- **FUTURE IDEA:** see `AFTER_TESTFLIGHT.md`.

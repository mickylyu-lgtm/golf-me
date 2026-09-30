# App Store privacy answers (App Privacy "nutrition label")

Source of truth for App Store Connect → App Privacy. Built on 2026-09-29 from the **production** schema, RLS policies, Edge Functions and frontend integrations, not from the old policy text. Keep in sync with `src/pages/PrivacyPolicy.tsx`.

**Status:** D1 implemented and **live**. Client rounding is in `src/lib/coarseLocation.ts`, `LocationPicker.tsx` and `FindRoundModal.tsx`. Migration `20260930090000_coarsen_profile_location.sql` was applied to production on 2026-09-30 (recorded as version 20260930012912) after Micky approved the SQL. Verified: 23 profiles with coordinates, 0 with more than 2 decimals; the trigger rounds a precise write (rolled-back test); an authenticated non-owner sees at most 2 decimals; no welcome DMs or trust changes; function execute revoked; no new security advisor findings. The app code ships with the commit of this task.

## Top-level answers
- **Do you or your third-party partners collect data from this app?** Yes.
- **Tracking** (linking data with other companies' data for advertising, or sharing with data brokers): **No.** No ads SDKs, no advertising identifier, no data brokers. No App Tracking Transparency prompt needed.
- **Data used to track you:** none.

## Data types collected

| Apple data type | Collected | Linked to user | Tracking | Purposes | Evidence |
|---|---|---|---|---|---|
| Contact Info → **Name** | Yes | Yes | No | App Functionality | `profiles.name`; Google sign-in name |
| Contact Info → **Email Address** | Yes | Yes | No | App Functionality | Supabase Auth; magic-link and account emails via Resend; `waitlist_signups.email` (website waitlist) |
| Contact Info → Phone / Physical Address / Other contact info | No | — | — | — | No phone or address columns (`phone_verified` is an unused flag) |
| Location → **Coarse Location** | Yes | Yes | No | App Functionality, Product Personalization | `profiles.playing_area_lat/lng`, 2 decimal places (~1.1 km; Apple treats fewer than 3 decimals as coarse). Rounded on device (`coarseLocation.ts`) and enforced by the `profiles_coarsen_location` trigger. Used for nearby courses (Geoapify search), rounds, golfer distance and match ranking. Readable by signed-in members (distance is computed client-side) |
| Location → Precise Location | **No** (after the migration) | — | — | — | Device position is rounded inside `LocationPicker` before anything uses it; no other geolocation code exists; the trigger rounds any client write. Before the fix, raw coordinates were stored (12 of 23 profiles) |
| User Content → **Emails or Text Messages** | Yes | Yes | No | App Functionality | `messages` (DMs), `round_messages` (round chat); previews sent through APNs |
| User Content → **Photos or Videos** | Yes | Yes | No | App Functionality | Profile photos (`avatars`), Community media (`community-media`), Caddie videos (`caddie-media`, private), booking-proof screenshots (`booking-proofs`, private) |
| User Content → **Audio Data** | Yes | Yes | No | App Functionality | Uploaded videos can include an audio track (microphone permission is requested for video capture) |
| User Content → **Other User Content** | Yes | Yes | No | App Functionality | Posts, comments, likes, bios, round reviews (incl. private notes), reports, coach reviews, Caddie analysis and pose data |
| Identifiers → **User ID** | Yes | Yes | No | App Functionality | Supabase user UUID on every row |
| Identifiers → **Device ID** | Yes | Yes | No | App Functionality | `device_push_tokens.token` (APNs device token) |
| Usage Data → **Product Interaction** | Yes | **No** | No | Analytics | Vercel Web Analytics (`<Analytics />` in `App.tsx`): page views, referrer, browser/device type, country; no cookies, no user ID |
| Usage Data → Advertising Data / Other Usage Data | No | — | — | — | No ads; `track()` in `src/lib/analytics.ts` is a no-op in production |
| **Other Data** | Yes | Yes | No | App Functionality, Product Personalization | Age range, gender, handicap, skill level, language, match preferences (age/gender/handicap preferences, budget, availability, travel radius…), reputation ratings |
| Health & Fitness | No | — | — | — | Caddie gives swing feedback; no health or fitness records. Swing videos → Photos or Videos. Pose/swing-analysis output → derived user content (Other User Content), **not** biometric data: GolfMe never uses body geometry to identify or authenticate anyone (decided by Micky, D3). |
| Sensitive Info | No | — | — | — | None of Apple's listed categories (gender is not on Apple's list) |
| Financial Info / Purchases | No | — | — | — | No payments |
| Contacts | No | — | — | — | Contacts are never accessed |
| Browsing History / Search History | No | — | — | — | Course searches are not stored per user |
| Diagnostics (crash / performance) | No | — | — | — | No crash reporting SDK. Provider server logs (IP, device) are standard operational logs; disclosed in the policy |

**Age rating input:** users can post and message each other (user-generated content, chat); 18+ required at signup (`ProfileSetup.tsx`).

## Third parties (must match the policy)
Supabase (DB/auth/storage/realtime, **ca-central-1 = Canada**) · Vercel (hosting + Web Analytics) · Apple Push Notification service (message previews) · Google sign-in · Google Gemini (Caddie video, feedback translation) · Roboflow (Caddie frames) · Geoapify (course-search location) · GolfCourseAPI (course names only, `course-enrich`) · Resend (sign-in and waitlist emails). `get-tee-times` fetches public tee-time pages (Chronogolf, Dyker Beach) and sends no user data. The GPT Review Gate is developer tooling; it never receives user data (diffs only, PII blocked).

## Policy vs implementation: disagreements found (2026-09-29)
| # | Old policy said | Actual behavior | Resolution |
|---|---|---|---|
| 1 | "We don't have any advertising or analytics tracking" | Vercel Web Analytics runs on every page | Policy now discloses it accurately |
| 2 | Playing area saved as "a region, not exact coordinates" | Raw device coordinates saved; **readable by every signed-in member** (`profiles_select_authenticated` = `true`) | **D1** — rounded to 2 decimals on device + DB trigger + backfill; policy states the rounded behavior |
| 3 | Listed only email, name, photo, handicap, area | Also age range, gender, bio, username, language, skill, full match preferences — all readable by any signed-in member | Policy lists them and says members can see them. Consider restricting preference columns post-launch (B) |
| 4 | No mention of push | APNs device tokens stored; message previews on lock screens | Disclosed |
| 5 | "Don't knowingly collect from anyone under 13" | App requires 18+ | Changed to 18+ |
| 6 | Resend "e.g. waitlist notices" | Resend is now also the SMTP for sign-in emails | Disclosed |
| 7 | GolfCourseAPI not listed | `course-enrich` calls it (course names only) | Listed |
| 8 | No storage location | Supabase project in Canada | Disclosed |
| 9 | No mention that Community media is link-public | `community-media` bucket is public-read by URL | Disclosed |
| 10 | Not stated who can see what | RLS: profiles, posts, follows, coach reviews readable by all members; DMs/round chat participants only; reviews, reports, booking proofs private (admins see reports/proofs) | New "Who can see your information" section |

## Decisions (2026-09-29)
- **D1 — Location precision: APPROVED.** Coordinates rounded to 2 decimals at capture (`LocationPicker`, defensively in `FindRoundModal`), enforced by a BEFORE INSERT OR UPDATE trigger, and existing rows backfilled (migration `20260930090000_coarsen_profile_location.sql`, designed by golfme-architect, applied only after Micky's OK). Coarse coordinates stay readable by members for discovery; precise values no longer exist. Residual: anyone who read profiles before the fix may have kept the old precise values; the fix can't undo that.
- **D2 — Contact address in review payloads: DONE, strict.** No allowlist. The gate stores only the SHA-256 of the published contact address (`publishedContactEmailSha256` in `policy.json`). That exact address is replaced with `‹REDACTED:published-contact›` and doesn't block; every other email/PII still blocks (tests in `sanitize.test.mjs`, `review.test.mjs`).
- **D3 — Pose data: derived user content, not biometric** (see Health & Fitness row).

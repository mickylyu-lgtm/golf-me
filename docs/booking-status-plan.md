# Honest tee-time status and host booking evidence: audit and plan

Branch `feat/booking-status` (worktree `.claude/worktrees/booking-status`, rebased onto `origin/main` at `1ecc1f9`). The brief is Micky's "Honest tee-time status and host booking evidence" (2026-11-05). Status: Stage 1 implemented (client only, uncommitted). Stages 2 and 3 prepared on the same branch (migration, RPCs, admin UI, PGlite tests, paste-ready SQL in the scratchpad), nothing applied, committed or deployed.

## Decisions recorded (Micky, 2026-11-05: "defaults" to the recommendations in §4)

1. **Reviewer:** Micky only, through the existing `admin` role. No promised turnaround anywhere in the copy. Self-review is blocked, so Micky's own hosted rounds can't reach "reviewed" until a second reviewer exists (the RPC also accepts a `booking_reviewer` role for later).
2. **Eligible rounds:** evidence and review only for rounds the host marks booked. A "No advance booking needed" status covers walk-on or planned rounds; it's never eligible for evidence and never shown as booked.
3. **Joining while booking is pending or needed:** allowed, with the join-sheet warning always shown.
4. **Evidence formats:** images only (screenshots or photos), re-encoded on the device to JPEG at 1600 px (drops EXIF and location), at most **5 MB** as uploaded. No PDFs, no email files.
5. **Retention:** replaced, removed or invalidated raw files deleted after **7 days**; all raw evidence deleted **30 days after the round date**; minimal audit (outcome, reason code, reviewer id, timestamps, version) kept **12 months**. Account deletion purges immediately (unchanged).
6. **Staleness:** the reviewed badge shows its review date and disappears after the round or on any change to the booking details or status. No automatic recheck.
7. **Booked party size:** optional, labelled host-reported, shown separately from GolfMe places.
8. **Booking reference:** no longer collected. "Booked via" is a fixed list.
9. **Notifications:** "booking changed or cancelled" goes to joined players by bell plus push (existing push rules and toggles). "Evidence reviewed" goes to the host as a bell notification only.
10. **Staging:** none. PGlite only. The real Storage HTTP API (signed URLs, MIME enforcement, public-URL refusal) is listed as untested.

---

## 0. Security findings (read first)

Tested by replaying every repo migration on PGlite (Supabase-like stub) and running role-simulated SQL as anon, a joined member, an unrelated host, the host and an admin. The harness is `scratchpad/pglite/_booking_evidence.mjs` and its output is `scratchpad/pglite/run_booking_evidence.log`. 23 safety checks pass and 7 gaps are confirmed.

**Confidentiality holds. No evidence leak was found.** Anon, a joined member and an unrelated host each see 0 `booking_proofs` rows and 0 `booking-proofs` storage objects. Creating a signed URL needs `select` on the object, so none of them can get one. The host and admins can read them. Other hosts' attach, remove and edit calls are rejected (42501). Direct writes to `tee_time_source` and to course/date/time are rejected by `guard_golf_calls_client_writes`. Direct inserts into `booking_proofs` are refused by RLS. Paths contain a random UUID, so they aren't predictable, and listing another user's folder returns nothing.

**Real integrity vulnerability: any host can get the current "✓ Booking Proof Attached" badge without uploading anything, and can choose the public "Source" text.** `attach_booking_proof()` (`20260818070000_add_tee_time_verification.sql:83-116`) accepts any `p_storage_path` string. It never checks that a matching object exists, that the object is in the caller's folder, or that it belongs to this round. `p_booking_source` is unbounded free text, written to the public `golf_calls.booking_source` column and shown verbatim in the round's explainer modal (`BookingProofExplainer.tsx:21-25`). The objectionable-content filter doesn't cover it either: `20260930120000` filters only `notes` and `course_name`. Confirmed live on PGlite: a direct RPC call with path `nothing/here.pdf` and source `"Confirmed directly by the course - guaranteed"` flips the round to `user_verified`, and every member then sees the badge and that sentence. Severity: medium. It's a trust/integrity issue, not a data leak. The fix is in Stage 1 (copy no longer implies more than a host claim, and the source shown is mapped to a fixed list) and Stage 2 (the server checks the object and uses an enum source).

Other confirmed gaps, all lower severity:

1. **The badge outlives the file.** The host can delete their own object directly (storage delete policy `:75-77`), and the round keeps `user_verified`.
2. **Attach can point at someone else's object path.** It's accepted, but the host still can't read that object because storage RLS refuses. Impact: an admin would see the wrong person's file under this round.
3. **Free private file hosting.** Any signed-in user can upload any type up to 15 MB into `booking-proofs/<own uid>/…`, unrelated to any round. The bucket has `allowed_mime_types = null`, and the owner can mint signed URLs with any expiry. This is a private file-hosting abuse vector. Whether Supabase serves `text/html` inline from this bucket was not verified.
4. **Cancelling keeps the proof.** Cancelling a round leaves `tee_time_source = 'user_verified'` and the proof row. Attach is also accepted on cancelled or completed rounds. The UI hides the badge on cancelled rounds, and on completed rounds in the detail page only. The card still shows it on completed rounds (`GolfCallCard.tsx:138`), and the match-reason line shows on cancelled and completed rounds (`GolfCallDetail.tsx:235`).
5. **Unbounded fields.** `booking_reference` and `booking_source` have no server length limit (5,000 characters accepted).
6. **Orphaned files.** Storage cleanup after remove, replace or invalidate is client-side best effort (`useBookingProof.ts:53-58,123`, `RealRoundsContext.tsx:321-324`). Deleting a round cascades the row but orphans the object. Account deletion does purge the folder (`delete-account/index.ts:194-230`).
7. **Booking reference saved on the device.** The booking reference typed on Host a Round step 2 is saved in the localStorage draft (`hostRoundDraft.ts:39-41`).

**Not tested here:** the real Storage HTTP API (public-URL refusal for a private bucket, signed-URL behaviour, content-type sniffing). PGlite models RLS, not the API gateway. A staging check against a real Supabase project would close this. The headless browser wasn't used, since this round changes no UI.

---

## 1. Current behaviour

### 1.1 Round model

- **`public.golf_calls`** (`supabase/migrations/20260813050000_create_golf_calls_and_participants.sql:8-48`):
  - `course_id` → `courses` (nullable), course snapshot fields `course_name`, `course_area_label`, `course_lat` and `course_lng`.
  - `date_iso timestamptz not null`, which is noon on the host's chosen day converted to UTC (`src/lib/golfCall.ts:7-21`).
  - `tee_time_label text not null`, which is free text.
  - `holes`, `game_format`, `estimated_price_per_person`.
  - `total_spots int check 2..4`, which includes the host.
  - `join_mode` (`'instant'` only).
  - `status` (`open|full|completed|cancelled`), `notes`.
  - `tee_time_source`, `tee_time_provider` and `external_tee_time_id`, reserved for a provider and never set.
- **RLS:** any authenticated user can select every round (`:55-58`). Hosts insert and update their own (`:60-72`). Anon gets no access.
- **`guard_golf_calls_client_writes`** (`20260924100100_freeze_reputation_and_tee_time_trust_columns.sql:72-129`):
  - forces new rows to `manual` with null verification fields (`:83-93`);
  - freezes the verification columns (`:95-101`), course/date/time (`:103-111`), and `host_user_id`, `total_spots` and `join_mode` (`:113-119`) against direct client writes;
  - lets SECURITY DEFINER RPCs through.
- **Status transitions** are policed by `20260924100200_enforce_round_date_rules.sql:36-61`. Cancel is allowed from `open` or `full`. Complete is allowed from `open` or `full` once `date_iso` has arrived.
- **`public.round_participants`** (`20260813050000:78-85`): `participant_status` is `joined` or `left`, unique per (round, user), readable by all authenticated users. It's changed only through `join_golf_call()` and `leave_golf_call()`. The latest definitions are in `20260924100300_enforce_blocks_on_rounds.sql` and `20260924100500_guard_leave_golf_call.sql`. They row-lock the round, check `joined < total_spots`, and flip `open` and `full`. **Joining touches only `round_participants` and `golf_calls.status`. Nothing about the course.**
- **Client mapping** is `realRoundToGolfCall` (`src/lib/golfCall.ts:180-224`). The `GolfCall` type is in `src/types/index.ts:198-245`. `totalSpots` includes the host, and `joinedGolferIds` puts the host first.
- **Demo path:** `src/data/golfCalls.ts:36,327` fixtures are all `teeTimeSource: "manual"`. `DataContext.tsx:626` creates demo rounds as `manual`. Every booking-proof UI is gated `!isDemo`.

### 1.2 How the tee time is represented

- The round is `date_iso` (a calendar day) plus `tee_time_label`, a free-text label of at most 40 characters on the client (`CreateGolfCall.tsx:560-571`). It's required to be non-empty on the client (`:347-348`). The server doesn't check that it's non-empty, how long it is, or its format.
- The label is parsed best-effort by `parseTeeTimeLabel` (`golfCall.ts:32-54`). "Morning" and "TBD" return null and are treated as "time unknown" (`roundStartTime`, `:87-94`).
- **There is no explicit "no tee time" state.** No column, enum or UI option exists for it. A host who has no tee time types something like "TBD" or "Morning". No timezone is stored. The time is the host's label as typed and is shown verbatim to every viewer.
- `tee_time_source` is `manual` (the default: host typed it), `user_verified` (proof attached) or `provider_verified` (never set). See `20260818070000:16-20` and `types/index.ts:198-210`.
- There is no field for booking-needed versus walk-on, no booking party size, and no booking status apart from the proof flag.

### 1.3 The existing booking-proof feature (Phase 14, 2026-08-18)

- **Migration** `20260818070000_add_tee_time_verification.sql`:
  - `golf_calls.booking_source` and `verification_created_at`, both public (`:27-28`).
  - `public.booking_proofs` (`:41-49`): one row per round with `storage_path`, `proof_type` (`image|pdf`) and `booking_reference`.
  - RLS select for the uploader or an admin (`:52-54`), with no client write policies.
- **Storage bucket** `booking-proofs`: private, 15 MB, no MIME allowlist (`:65-67`). Policies (`:69-77`):
  - select: own folder or admin;
  - insert: own folder;
  - delete: own folder;
  - update: none.
- **Host RPCs:**
  - `attach_booking_proof` (`:83-118`): upserts the row, sets `user_verified` and the source, returns the old path;
  - `remove_booking_proof` (`:122-146`);
  - `edit_golf_call_tee_time` (`:158-212`): when course, date or time changes on a `user_verified` round, it deletes the proof row and reverts to `manual` in the same transaction, then returns the freed path.
- **The proof clean-up mentioned in `20261105130000_add_round_update_pushes.sql:23-24,52-55`** is not a separate trigger. It refers to that invalidation step inside `edit_golf_call_tee_time()` (`20260818070000:199-206`). Its follow-up `UPDATE` only lists the verification columns, so it doesn't re-fire the tee-time push. `booking_proof_removed` stays bell-only. Storage clean-up of the freed object happens on the client (`RealRoundsContext.tsx:321-324`).
- **Review flow: none exists.** Nothing anywhere reviews a proof:
  - The admin dashboard (`src/pages/AdminDashboard.tsx`) has no proof view.
  - Admins can technically read rows and objects through RLS, but nothing in the app does.
  - `getViewUrl` in `useBookingProof.ts:99-107` is never called, so even the host can't view their upload.
  - The "Founding" feature (`20261006120000_add_founding_golfer_cohort.sql`) is an unrelated signup cohort. Its `app_reviewer` role means App Store review accounts.
  - The only reviewer-role precedent is the Coach Reviewer system (`20260818040000_create_coach_reviewer_system.sql`: `user_roles`, `private.has_role`, grant/revoke RPCs, `src/pages/AdminReviewers.tsx`).
- **Labels and badges:**
  - `TeeTimeTrustBadge.tsx:16-31` renders "✓ Booking Proof Attached" with a shield icon only for `user_verified`, and nothing for `manual`.
  - `BookingProofExplainer.tsx` shows "The host provided confirmation that this tee time was booked.", "Verified by: Host", "Source: <free text>", "Added: <relative time>", and "GolfMe has not independently confirmed live course availability."
  - `GolfCallCard.tsx:138` (badge, hidden only when cancelled) and `:193-197` (match line "✓ Booking proof attached").
  - `GolfCallDetail.tsx:235-239` (match line, shown even when cancelled or completed) and `:253-257` (badge, or the disclaimer "Entered by the host — not confirmed with the course").
  - Host controls: `GolfCallDetail.tsx:298-308`, `BookingProofHostControls.tsx`, and `EditTeeTimeModal.tsx:42` with its warning.
  - Host a Round step 2 has the optional "Verify Your Tee Time" block (`CreateGolfCall.tsx:574-649`). Upload happens after the round is created (`:418-430`), and a failure is a warning toast only.
  - Ranking: `GolfCalls.tsx:93` adds +2 to the match score for `user_verified`.
- **Upload pipeline** (`useBookingProof.ts:29-60`):
  - checks size (15 MB) and type on the client only;
  - re-encodes images to JPEG at 1600 px through a canvas (`resizeImageToBlob`), which strips EXIF;
  - uploads PDFs as-is;
  - path is `<uid>/<roundId>/<uuid>.jpg|pdf`;
  - on RPC failure it removes the upload, then removes the previous path after a replace.
  - Missing: progress, retry, an idempotency key, and server-side type checks.

### 1.4 Member counts and spots

| Surface | Code | Copy (en) |
|---|---|---|
| Card status chip | `GolfCallCard.tsx:37,121-136` | "{n} Spots Remaining" / "1 Spot Left" / "Foursome full" |
| Card footer | `GolfCallCard.tsx:209` | "{joined} of {total} joined" |
| Detail status | `GolfCallDetail.tsx:145-149,212` | "{count} spot{plural} open" (English-only plural hack in every locale) / "1 Spot Left" / "Full" |
| Detail roster | `GolfCallDetail.tsx:321` | "Foursome ({joined}/{total})" (even for 2- or 3-player rounds) |
| Detail CTA | `GolfCallDetail.tsx:406-409` | "Foursome full" |
| Chat inbox next round | `Inbox.tsx:85` | "{joined} of {total} players" |
| My Rounds | `MyRounds.tsx:98-123` | "{joined}/{total} joined" |
| Host preview | `CreateGolfCall.tsx:941-942` | "{count} open spots to fill" |
| New-round push (server) | `20261030120000…:154-192` (`fanout_round_copy`, 6 languages) | "… · 3 spots open" |

`total_spots` really is enforced server-side (row-locked join), so "GolfMe group places" is a supported concept. None of these surfaces says the count is GolfMe-only. "Spots" and "Foursome full" read as course spots. The host is counted in `joined`.

### 1.5 Join flow wording

- `ConfirmJoinModal.tsx`: titled "You're joining". It shows trust stats (including "{n} Verified Golfers", which is the profile `verified_golfer` flag. That flag is frozen and never true for real accounts: `20260919030000`). It also shows the "Playing with" roster and course · date · time, then the button "Confirm Join →". **It says nothing about the booking.**
- `useJoinRound.ts:31-38`: the success toast is "You're playing {date}. ⛳", which implies a guaranteed game. Errors pass through the server's text.
- The join button reads "Join Round" (`GolfCallDetail.tsx:410-413`, `GolfCallCard.tsx:89-93`).
- Leaving is confirmed with "You'll be removed from the foursome and lose access to the group chat. The host will be notified."
- The cancel confirm is "Everyone who joined will be notified that the round is cancelled." It doesn't say the course booking is untouched.

### 1.6 Course links

- `CourseDetailContent.tsx:38-41,92-96` (`/courses/...` and the map sheet): "Find tee times" opens `https://www.google.com/search?q=<name area tee times>` with `noopener,noreferrer`. The note reads "Tee times opens a web search. GolfMe doesn't book this course yet." The word "yet" implies a coming partnership. Directions opens Apple Maps or Google Maps.
- `TEE_TIMES_VISIBLE = false` (`services/teeTimes/types.ts:11`) hides the Tee Times page, the "Tee times available" badge and the Home card. The `/tee-times/:id` routes still work by direct link:
  - `TeeTimeCourseDetail.tsx` shows `ExternalBookingCard` ("Book at {name}", "Check Tee Times", "You'll continue to {name}'s official booking site.", "Availability and booking are managed by {name}.").
  - The "Live availability inside GolfMe" header renders only if slots exist, which never happens (`getTeeTimes()` always returns `[]`).
  - Booking URLs are hard-coded constants (`services/teeTimes/providers/*.ts`).
- `courses.website` exists (`20260816081311_add_course_external_ids_mapping.sql:18`) but no UI uses it. The round detail page has no course link at all.

### 1.7 Trust words in use (all six locales carry the same keys)

The source lines are in `src/i18n/locales/en.ts`. `es.ts`, `ja.ts`, `ko.ts`, `zh-CN.ts` and `zh-TW.ts` translate each one faithfully. There are no extra trust claims in other locales, and the translations carry the same problems. For example, zh "验证人", ko "티타임 인증하기" and ja "予約証明あり" all translate "Verified"/"Verify".

| Key (en.ts line) | English | Problem |
|---|---|---|
| `golfCallDetail.bookingProofBadge` (1258) | ✓ Booking Proof Attached | A check mark and shield suggest something was approved |
| `golfCallDetail.bookingProofMatchReason` (1259) | Booking proof attached | Shown as a ✓ "reason", and on cancelled or completed rounds |
| `golfCallDetail.bookingProofExplainerBody` (1261) | The host provided confirmation that this tee time was booked. | States it as fact |
| `golfCallDetail.bookingProofVerifiedByLabel/Value` (1263-1264) | Verified by: Host | "Verified" |
| `golfCallDetail.bookingProofNotIndependentlyConfirmed` (1266) | GolfMe has not independently confirmed live course availability. | Good intent; keep the idea |
| `golfCallDetail.teeTimeDisclaimer` (1228) | Entered by the host — not confirmed with the course | OK |
| `host.verifyYourTeeTime` / `…Body` (925-926) | Verify Your Tee Time / Help other golfers know this round is based on a real booking. | "Verify"; "real booking" |
| `golfCallDetail.removeBookingProofConfirm` (1270) | … with no verification badge. | "verification" |
| `golfCallDetail.proofInvalidatedToast` (1288) | … Add new proof to re-verify. | "re-verify" |
| `golfCallCard.spotsRemaining*` (52-53), `golfCallDetail.spotsOpen` / `oneSpotLeft` / `foursome` / `foursomeFull` / `full` (1221-1232, 1241), `golfCallCard.joinedOfTotal` (55), `myGolf.joinedCount` (977), `chatInbox.nextRoundPlayers` (475) | Spots / Foursome | Read as course spots |
| `golfCallDetail.joinedInstantToast` (1300) | You're playing {date}. ⛳ | Implies a guaranteed game |
| `coursePage.findTeeTimes` / `teeTimesNote` (165-166) | Find tee times / … doesn't book this course yet. | "yet" |
| `teeTimes.subtitle` (145), `teeTimes.liveInsideGolfMe` (174), `nearbyCourses.teeTimesAvailable` (157) | "Check tee time availability…", "Live availability inside GolfMe", "Tee times available" | Live-availability claims (hidden or unreachable today, still shipped) |
| `teeTimes.bookAt` / `externalBookingBody` (177-178) | Book at {name} / … booked through the course's official booking site | Acceptable; could say "Open course booking site" |
| `joinConfirm.verifiedGolfer(s)` (1381-1382), `trust.verifiedGolfer` (90), `reputation.verified*` (1022-1029) | Verified Golfer | A profile concept, not booking. Never true for real accounts today. Out of scope but adjacent |
| `landing.faq.a6` (608) | "Anyone can take an open spot right away" | Landing page: "spot" |
| Server notification text (English only) | "{host} added booking proof to your round at {course}." (`20260818070000:230`), "{host} removed the booking proof…" (`20260819070000:68`, also sent when an edit auto-invalidated it) | "proof" |

### 1.8 Booking-related notifications

- `booking_proof_attached`: an AFTER UPDATE trigger on `tee_time_source` (`20260818070000:217-241`) notifies joined members, not the host, on the transition into `user_verified`. Bell only.
- `booking_proof_removed` (`20260819070000:55-79`): sent on the transition out of `user_verified`, which covers explicit removal and edit invalidation. Bell only.
- `tee_time_updated`: bell plus push since `20261105130000`, localized, with APNs collapse id `round-<id>`.
- `round_cancelled`: bell plus push.
- The client registers icons in `NotificationsPanel.tsx:27-29` and popups in `NotificationPopupHost.tsx` (`POPUP_TYPES`). The type union is in `types/index.ts:659-661`.

### 1.9 Reports

- `ReportModal` with `context="round"` and `golfCallId` is wired from the round "⋯" menu (`GolfCallDetail.tsx:186-197,572-574`).
- `reports.category` is free text with no CHECK. The categories come from `REPORT_CATEGORIES` (`types/index.ts:299-320`) and don't include anything booking-related.
- Admin loop: an email alert via Resend plus `admin_list_reports()` / `admin_set_report_status()` and the Reports section of `AdminDashboard.tsx:274-354,418+` (`20260930100000`).

### 1.10 Tests

There is no automated test for booking proof, member-count copy or join wording (the 58 files in `tests/` have none). The Phase 14 notes record role-simulated SQL against production at the time, plus demo-mode headless checks. A two-real-account click-through was never done (`DEVELOPMENT_STATUS.md:673`, item 0b).

---

## 2. Gap analysis

### Core rules

| Rule | Status |
|---|---|
| 1. GolfMe group separate from course reservation | **Backend OK** (join only touches participants and status). **Copy misleading**: "spots", "Foursome full", "You're playing". |
| 2. Joining doesn't reserve, guarantee, add to booking or pay | **Missing**: no statement anywhere near Join. "Pay at the course — no in-app payments" exists on the detail page only. |
| 3. Member count describes only GolfMe members | **Misleading**: unqualified "Spots Remaining", "Foursome ({n}/{t})", push "3 spots open". |
| 4. Uploaded evidence ≠ active, authentic or course-confirmed | **Misleading**: ✓ badge, "Verified by", "provided confirmation that this tee time was booked", ranking boost. Also forgeable (§0). |
| 5. State that availability isn't connected | **Partly**: one explainer line; course-page "yet". Missing on round detail and join. |
| 6. Legacy rounds accessible; unknown doesn't become booked or reviewed | **OK today** (`manual` shows no badge). Must be preserved in the migration: unknown maps to "not reported", never to booked. |

### Acceptance criteria

| Criterion | Today | Needed |
|---|---|---|
| Join/leave only changes participation | OK in DB; copy implies more | Stage 1 copy and test |
| Member counts vs booking party size separate everywhere | No party size exists; counts unlabelled | Stage 1 labels; Stage 2 optional party size, labelled "host-reported" |
| Unbooked can't look booked; host claim can't look course-confirmed; missing evidence → no evidence badge | **Fails**: badge obtainable without a file (§0); ✓ styling | Stage 1 copy and source mapping; Stage 2 server checks |
| Upload → pending only; reviewed needs a reviewer and current evidence | No review state at all | Stage 2 `submitted`; Stage 3 review RPC with version check |
| Failed, duplicate, oversized, unsupported, interrupted uploads | Client checks only; no idempotency; no progress; failure after create leaves an honest `manual` | Stage 2 |
| Anon, other members and unrelated hosts can't fetch evidence or modify status (direct API/storage) | **Passes** on PGlite (§0) | Keep; add a staging suite |
| Replace, remove, edits, cancellation, stale and concurrent → no invalid badge | Edit invalidation OK; **direct object delete and cancel leave state** | Stages 2–3 |
| Legacy rounds usable and honest | OK | Migration mapping (§3.2) |
| Course links external, validated, not proof or partnership | Google search link OK; "yet" wording; no course website link | Stage 1 |
| Mobile, keyboard and screen reader; not colour-only | Badge is icon plus text; the ✓ glyph is `aria-hidden`; cards are `role=button` | Stage 1: status as text with an accessible name |
| Tests cover surfaces and roles | None | Each stage |

---

## 3. Staged implementation

### Status vocabulary (all stages)

There are three independent axes, plus a constant.

**A. GolfMe group** (existing, relabelled only)

- "{joined} of {total} GolfMe places filled", "{n} GolfMe places open", "GolfMe group full".
- Proves: how many people joined this GolfMe group, against the host's group limit, which the server enforces.
- Doesn't prove: anything about the course booking, other golfers in the tee time, or course inventory.

**B. Host-reported booking** (Stage 2 server state; Stage 1 derives it from `tee_time_source`)

| Value | Label | Shown when | Proves / doesn't prove |
|---|---|---|---|
| `unknown` | "Booking status not provided" (details and join sheet only; no card chip) | legacy rows, or the host hasn't said | Nothing. Never treated as booked. |
| `not_needed` | "No advance booking needed · Host reported" | walk-on or planned round, if Micky approves (decision 2) | The host says no reservation is required. Not a guarantee of a spot. |
| `needed` | "Booking needed" | the host says a booking is required and none is claimed | No booking is claimed. |
| `pending` | "Booking confirmation pending" | the host is waiting on the course | The host is trying. Different from evidence awaiting review. |
| `booked` | "Booked · Host reported" | the host claims a booking | The host's own statement. Not checked, not course-confirmed. |
| `changed` | "Booking changed · Updated evidence needed" | material details changed after evidence was submitted or reviewed | The earlier evidence no longer applies. |
| `cancelled` | "Booking cancelled" | the host says the course booking is cancelled | Removes any evidence badge. Separate from cancelling the GolfMe round. |

**C. Evidence review** (Stage 2 adds `submitted`; Stage 3 adds the outcomes)

| Value | Label | Proves / doesn't prove |
|---|---|---|
| `none` | (no label) | — |
| `submitted` | "Booking evidence submitted · Not yet reviewed" | The upload succeeded. Not approval. No review time promised. |
| `reviewed` | "Booking evidence reviewed" + "Reviewed by GolfMe on {date}." | An authorised reviewer saw legible evidence that matched course, date, time (and party size, if captured) at that moment. **Doesn't prove** the booking is still active, that the document is authentic, or that the course confirmed anything to GolfMe. |
| `needs_correction` | "Booking evidence needs an update" (host and members) | The reviewer couldn't match it. Not an accusation. |
| `rejected` | Host only: "Evidence not accepted: {reason}". Members see the plain host-reported state. | Doesn't publicly accuse the host. |

**Constant:** "Course availability is not connected. Check with the course for current availability." This sits on round detail, the join sheet and the course page. No live inventory is shown or simulated.

**Required sentences** (from the brief, used as written):

- Near Join: "Joining this GolfMe group does not reserve a tee time or a spot with the course. Coordinate booking details with the host."
- With the reviewed badge: "Booking evidence reviewed by GolfMe on {date}. This is a review of host-provided evidence, not live confirmation from the course. Bookings can change or be cancelled."

"Verified", "Confirmed", "Guaranteed" and "Live availability" are never used for booking. Whenever "Booked" appears, "· Host reported" sits in the same visible text, not a tooltip.

### Stage 1: honest copy and labels, no schema change

Client only. No migration, RPC or storage change. It neutralises the §0 trust impact: a forged attach now only produces "Booked · Host reported", which is literally what it is.

**New pure module `src/lib/bookingStatus.ts`** (unit-testable under `node --test`, same pattern as `golfCall.ts`):

- `bookingStatusView(call, now)` returns `{ booking: 'unknown'|'booked', evidence: 'none'|'host_attached', show: boolean }`.
- Derived from `teeTimeSource`: `user_verified` maps to `booked` with "host added a confirmation, not reviewed". Anything else, including `provider_verified` and unknown strings, maps to `unknown`.
- `show` is false for cancelled or completed rounds, and after the round day (`isUpcomingRound`).
- `bookingSourceDisplay(source)` maps to the five known keys and anything else to "Other". It never renders the host's free text.

**Files:**

- `src/components/golfcall/TeeTimeTrustBadge.tsx`:
  - becomes a status chip with text "Booked · Host reported", a neutral icon (Clipboard or Info, not ShieldCheck), slate tone, and an `aria-label` carrying the full sentence;
  - renders only when `show`.
- `src/components/golfcall/BookingProofExplainer.tsx`:
  - title "Booking status";
  - body "The host says this tee time is booked and added a confirmation. GolfMe hasn't reviewed it.";
  - "Added by: Host" (replaces "Verified by");
  - mapped source;
  - "Course availability is not connected…".
- `src/components/golfcall/GolfCallCard.tsx`:
  - chips "{n} GolfMe places open", "1 GolfMe place left", "GolfMe group full";
  - footer "{joined} of {total} GolfMe places filled";
  - badge gated by `show` (fixes completed rounds);
  - match line → "Booked · Host reported" without ✓.
- `src/pages/GolfCallDetail.tsx`:
  - the same count labels;
  - "GolfMe group ({joined}/{total})" in place of "Foursome";
  - the match line gated by `show` (fixes cancelled and completed);
  - a booking-status row under "When": either the chip or "Booking status not provided", plus the constant line;
  - cancel confirm adds "Cancelling this GolfMe round doesn't cancel any booking with the course.";
  - the `spotsOpen` plural hack replaced by singular and plural keys.
- `src/components/golfcall/ConfirmJoinModal.tsx`:
  - adds the required join sentence and the booking-status line from `bookingStatusView`, above the button, as plain text, not an alert role;
  - button stays "Confirm Join".
- `src/lib/useJoinRound.ts`: toast "You joined the GolfMe group for {date}."
- `src/pages/CreateGolfCall.tsx` step 2:
  - "Verify Your Tee Time" → "Add booking confirmation (optional)";
  - body "Members will see 'Booked · Host reported'. GolfMe doesn't review confirmations yet." (or drop "yet": decision 1);
  - stop persisting `proofReference` in the draft.
- `src/lib/hostRoundDraft.ts`: drop `proofReference` from the saved shape and ignore it on load.
- `src/components/golfcall/BookingProofHostControls.tsx` and `EditTeeTimeModal.tsx`: wording only ("confirmation", not "proof" or "verify"), plus a host-only "View" button using the existing `getViewUrl`.
- `src/pages/GolfCalls.tsx:93`: remove the +2 ranking nudge for an unreviewed upload (it can come back in Stage 3 for `reviewed` only).
- `src/pages/Inbox.tsx:85` and `src/pages/MyRounds.tsx:123`: count labels.
- `src/components/courses/CourseDetailContent.tsx`:
  - "Find tee times" → "Search tee times";
  - note "Opens a web search. GolfMe doesn't book tee times or see course availability.";
  - when the round or course has a `courses.website` (https only, parsed with `new URL`, no credentials or ports), add "Check with course", which opens the site. Optional, since it needs the course row in the client: see decision 9.
- Hidden tee-times copy (`teeTimes.subtitle`, `bookAt`, `liveInsideGolfMe`, `nearbyCourses.teeTimesAvailable`): reword to "Official booking links" / "Open course booking site". Delete `liveInsideGolfMe` together with the unreachable slot list in `TeeTimeCourseDetail.tsx:94-120`.
- `src/i18n/locales/{en,es,ja,ko,zh-CN,zh-TW}.ts`: change about 30 keys in each, keeping key names where the meaning is the same.
- `landing.faq.a6`: "Anyone can take an open place in the group right away".
- **Not in Stage 1:** server notification text and the `fanout_round_copy` "spots open" push text. Both are SQL functions and need a migration, so they're folded into Stage 2. Flagged so it isn't forgotten.

**Tests:**

- `tests/bookingStatus.test.ts`:
  - every `teeTimeSource` value, including garbage → unknown;
  - cancelled, completed and past → hidden;
  - source mapping never echoes free text.
- `tests/bookingCopy.test.ts`: every booking and count key exists in all six locales, and none of the booking keys contains the banned words (verified, confirmed, guarantee, live) in en.
- Plus `npx tsc -b`, `npm run lint`, `npm run build`, and headless screenshots (run skill) of the card, detail, join sheet and Host step 2 at 390 px, in demo and real-mocked views.

**Legacy:** no data change. Every existing round renders as either "Booked · Host reported" (`user_verified`) or "Booking status not provided".

### Stage 2: host-reported booking state and evidence submission, server-enforced

**Draft migration outline** (one file, e.g. `2026111xxxxxxx_booking_status_and_evidence.sql`; RLS in the same migration; not written yet).

1. **New public-safe columns on `golf_calls`.** All are frozen for direct client writes by extending `guard_golf_calls_client_writes`. Insert defaults are forced, as with `tee_time_source`.
   - `booking_status text not null default 'unknown' check (booking_status in ('unknown','not_needed','needed','pending','booked','changed','cancelled'))`
   - `booking_status_updated_at timestamptz`
   - `booking_party_size smallint null check (booking_party_size between 1 and 8)`, only if decision 7 says yes
   - `evidence_status text not null default 'none' check (evidence_status in ('none','submitted','reviewed','needs_correction'))`. `rejected` stays private. The public value goes back to `none`.
   - `evidence_reviewed_at timestamptz` (Stage 3 writes it)
   - `booking_version integer not null default 0`. Bumped on every material change: course, date, time, party size or booking status. Used for optimistic concurrency and to pin reviews.
2. **New private table `booking_evidence`:**
   - columns `id`, `golf_call_id` (fk, cascade), `host_user_id`, `storage_path`, `mime_type`, `size_bytes`;
   - `status check in ('submitted','reviewed','needs_correction','rejected','superseded','withdrawn','invalidated')`;
   - a snapshot of the round as submitted: `snap_course_id`, `snap_course_name`, `snap_date_iso`, `snap_tee_time_label`, `snap_party_size`, `snap_booking_version`;
   - `client_request_id uuid unique` (idempotency), `created_at`, `closed_at`, `object_deleted_at`;
   - path constraint `storage_path like host_user_id || '/' || golf_call_id || '/%'` (same idea as the caddie path pin, `20260925090000`);
   - partial unique index `(golf_call_id) where status in ('submitted','reviewed','needs_correction')`: one current version per round.
   - **RLS:** select only for `host_user_id = auth.uid()` or a reviewer (`private.has_role(uid,'admin')`, or a new `booking_reviewer` role per decision 1). No client insert, update or delete policies.
3. **Storage `booking-proofs`:**
   - `update storage.buckets set allowed_mime_types = '{image/jpeg}'` (or plus `image/png` and `application/pdf` per decision 4), and `file_size_limit` per decision 4.
   - Replace the insert policy: own folder **and** `(storage.foldername(name))[2]` is a round the caller hosts with status `open` or `full`. This closes the file-hosting gap.
   - Replace the delete policy: own folder **and** no current `booking_evidence` row references the path. The badge can no longer outlive its file.
   - The select policy stays own-folder, plus reviewers.
4. **RPCs** (SECURITY DEFINER, `search_path = ''`, revoked from public and anon):
   - `set_booking_status(p_golf_call_id, p_status, p_party_size, p_expected_version) returns golf_calls`
     - host only; round `open` or `full` and not past; locks the row `FOR UPDATE`; rejects if the version doesn't match ("This round changed, refresh and try again");
     - allowed transitions: any → `needed|pending|booked|not_needed|cancelled`. Only the system sets `changed`. `unknown` can't be re-entered;
     - bumps the version. Changing to a state other than `booked` invalidates current evidence (`status='invalidated'`, public `evidence_status='none'`).
   - `submit_booking_evidence(p_golf_call_id, p_storage_path, p_client_request_id, p_expected_version) returns (evidence_id, superseded_path)`
     - host only; round `open` or `full`, not past, `booking_status='booked'`;
     - the object must exist in `storage.objects` with that bucket and name and `owner_id = auth.uid()`, with `metadata->>'mimetype'` in the allowlist and `(metadata->>'size')::bigint <= limit`;
     - the same `client_request_id` returns the existing row (a safe retry or double tap);
     - supersedes the current row; inserts with a snapshot; sets public `evidence_status='submitted'`.
   - `withdraw_booking_evidence(p_golf_call_id) returns text` (path to delete).
   - `edit_golf_call_tee_time` (`create or replace`, same signature): on a material change it bumps `booking_version`, marks current evidence `invalidated`, sets `evidence_status='none'`, and if `booking_status = 'booked'` sets `booking_status='changed'`. This replaces the `tee_time_source` revert. Keep the column list in its follow-up UPDATE so `20261105130000`'s push trigger still fires once.
   - **Group cancel** (existing status trigger path, or a small AFTER trigger on `status → cancelled`): marks current evidence `withdrawn` and `evidence_status='none'`. Leaves `booking_status` as is, because the course booking is a separate fact, and the UI hides booking chips on cancelled rounds.
   - Retire `attach_booking_proof` and `remove_booking_proof`: drop the functions, or redefine them to raise "Update the app" (the iOS app loads the live web app, so stale clients are only cached PWAs).
5. **Backfill (legacy):**
   - `tee_time_source='manual'` → `booking_status='unknown'`, `evidence_status='none'`.
   - `user_verified` on upcoming `open` or `full` rounds → `booking_status='booked'`. The host did claim it by attaching. The `booking_proofs` row is copied to `booking_evidence` as `submitted` **only if** its `storage.objects` row exists; otherwise `evidence_status='none'`.
   - `user_verified` on past, cancelled or completed rounds → `booked`, with evidence `withdrawn` (never shown).
   - **Nothing becomes `reviewed`.** `tee_time_source` is kept as a deprecated mirror (`user_verified` iff current evidence exists) for one release, then dropped. `booking_source` and `booking_reference` stop being collected (decision 8). Legacy values get nulled in Stage 3 retention.
6. **Notifications:**
   - Retarget `notify_booking_proof_attached` and `removed` to the new state, with text "{host} added a booking confirmation (not yet reviewed)…" and "…booking confirmation no longer applies…".
   - Add a new type `booking_status_changed` for host-set `changed` or `cancelled` (decision on push vs bell), sent through the existing `private.send_round_push` and collapse id.
   - Localize all of these the same way `20261105130000` does.
   - Fix `fanout_round_copy` "spots open" → "GolfMe places open" in 6 languages.

**Client files:**

- `src/lib/bookingStatus.ts`: reads the new columns, with Stage 1 fallback if the columns are absent (deploy order safety).
- `src/lib/golfCall.ts` (`RoundRow`, mapper), `src/types/index.ts` (new fields, `NotificationType`).
- `src/lib/useBookingProof.ts` → `useBookingEvidence.ts`:
  - upload with `upsert:false` to `<uid>/<round>/<client_request_id>.jpg`;
  - retry with the same id;
  - progress shown as states, since the supabase-js upload has no byte progress: Preparing → Uploading → Saving → "Submitted, not yet reviewed";
  - typed errors (too large, unsupported, network, round changed);
  - on submit failure, delete the object and leave the state as "not submitted".
- `BookingProofHostControls.tsx` → a host "Booking" panel:
  - status picker (Needed / Pending / Booked / No booking needed / Cancelled);
  - an optional party-size field, labelled "Booked party size (host-reported)";
  - evidence upload, replace and remove;
  - the guidance text: what reviewers need (course, date, tee time, party size), and to redact reservation numbers, payment and contact details.
- `CreateGolfCall.tsx` step 2: an optional status choice. It calls `set_booking_status` after `host_golf_call`, so `host_golf_call` stays untouched. A failure leaves an honest `unknown` and shows a toast.
- `EditTeeTimeModal.tsx`: warning "Changing course, date or time marks the booking 'changed' and removes your submitted evidence."
- `GolfCallCard.tsx`, `GolfCallDetail.tsx`, `ConfirmJoinModal.tsx`: render axes B and C from the view model.
- `NotificationsPanel.tsx`, `NotificationPopupHost.tsx`.
- Locales: all 6.
- **Demo path:** a mocked `bookingStatus` field on demo fixtures, with no uploads (as today). Demo never shows "reviewed".

**Tests:**

- A PGlite authz suite (`scripts/staging/booking-evidence-authz.sql` plus a harness) extends `_booking_evidence.mjs`. Every §0 gap must now fail, and confidentiality must still pass. It covers version conflicts, idempotent retries, submit on a past or cancelled round, a missing object, a wrong MIME type, and oversize metadata.
- Node tests for the view model and transition table.
- `tsc`, lint, build, headless screenshots.
- A staging Supabase run of the authz SQL against the real Storage API, if a staging project is available (decision 10).

### Stage 3: review and lifecycle

**Draft migration outline:**

1. `booking_evidence_reviews`, an append-only audit table:
   - columns `id`, `evidence_id`, `golf_call_id`, `reviewer_id`, `outcome check in ('reviewed','needs_correction','rejected')`, `reason_code check in ('illegible','course_mismatch','date_mismatch','time_mismatch','party_size_mismatch','not_a_booking','other')`, `note text check (length(note) <= 200)` (no PII; the guidance says so), `reviewed_booking_version`, `created_at`;
   - RLS: select for reviewers only;
   - the host sees outcome and reason through an RPC returning only those two fields, never the reviewer's identity or note.
2. A reviewer role: add `'booking_reviewer'` to `user_roles_role_check`, plus grant and revoke RPCs (copy `grant_coach_reviewer`). The alternative is admin only (decision 1).
3. RPCs:
   - `list_booking_evidence_queue(p_limit, p_before)`: reviewer only. Returns evidence metadata and the round snapshot, never the raw file.
   - `review_booking_evidence(p_evidence_id, p_outcome, p_reason_code, p_note, p_expected_booking_version)`:
     - locks the round;
     - the evidence must be current (`submitted` or `needs_correction`), `snap_booking_version = round.booking_version = p_expected_booking_version`, and `reviewer_id <> host_user_id`, so there's no self-review;
     - round `open` or `full` and not past;
     - inserts the audit row; sets the evidence status and the public `evidence_status` / `evidence_reviewed_at`;
     - `rejected` sets public `evidence_status='none'`.
   - A stale or concurrent approval fails with "Evidence changed since you opened it."
   - Storage select for reviewers is limited to paths of current evidence rows. Signed URLs come from the client with a 60 s expiry.
4. **Lifecycle:**
   - Any `set_booking_status`, `edit_golf_call_tee_time`, submit or withdraw already invalidates. A reviewed badge is shown only while the round is upcoming, so it expires after the round day by display rule. The server also marks it at the next touch, or with a sweep.
   - A stale-evidence reminder (decision 6) would be a bell row to the host, N days before the round, if the review is older than X.
5. **Reports:** add the category "Misleading or outdated booking info" to `REPORT_CATEGORIES` and the locales (`reports.category` has no CHECK, so no migration).
   - It goes through the existing round report (`ReportModal`, `context='round'`), the email alert and the admin Reports list.
   - The reviewer can move the evidence to `needs_correction` from the queue.
   - A report never changes status automatically.
6. **Retention and clean-up** (decision 5):
   - A `purge_booking_evidence()` RPC, service role or admin, returns paths for:
     - superseded, withdrawn and invalidated objects older than R1;
     - all evidence for rounds whose day is more than R2 days past;
     - legacy `booking_proofs` rows.
   - An Edge Function deletes those objects through the Storage API. Deleting `storage.objects` rows in SQL doesn't remove the bytes.
   - It sets `object_deleted_at` and keeps the minimal audit (outcome, reason, timestamps, version).
   - Trigger options: `pg_cron` (not used in this repo yet; it's new infra, so it needs approval), or an admin dashboard "Purge expired evidence" button. Recommended first: the button.
   - **Backups:** Supabase backups keep deleted rows and objects for the plan's backup window. The privacy policy should say so.
7. **Client:**
   - `AdminDashboard.tsx` gets a "Booking evidence" section, or a new `AdminBookingEvidence.tsx`:
     - shows each item with its round snapshot and course, date, time and party size;
     - an image preview with a signed URL (`referrerPolicy="no-referrer"`);
     - PDFs (if allowed) open as a download in a new tab, never in an iframe;
     - three outcome buttons; a reason picker; save errors keep the item unapproved.
     - No turnaround promise anywhere.
   - The host sees the outcome on round detail. Members see "Booking evidence reviewed" plus the required sentence and date.
   - `GolfCalls.tsx` ranking nudge for `reviewed` only (optional).
   - Privacy Policy and Terms: add a retention sentence and the review scope.

**Tests:** extend the PGlite suite with:

- reviewer versus host versus member versus anon;
- self-review blocked;
- approving after an edit, replace or withdraw blocked;
- concurrent submit and review;
- a past round;
- the purge result.

Plus node tests for the badge expiry rule, headless screenshots of the admin queue, and a two-account device check (host submits, Micky reviews, member sees the badge, host edits, badge drops).

---

## 4. Decisions for Micky (with recommendations)

1. **Who reviews?** Recommended: Micky only, through the existing `admin` role, for now. Build the RPC to accept a new `booking_reviewer` role so admins or helpers can be added later without a migration. Two consequences:
   - Self-review is blocked, so **Micky's own hosted rounds can't get a reviewed badge** unless a second reviewer exists. Accept that, or name a second reviewer.
   - The app promises no review time. The copy says "not yet reviewed", never "within 24 h".
2. **Which rounds are eligible?** There's no round-type field today. Recommended:
   - Evidence and the reviewed badge only for rounds the host marks `booked`.
   - Add "No advance booking needed" (walk-on or planned) as a host-reported status. It's never eligible for evidence and never shown as booked.
   - No separate "round type" column. The booking status covers it.
3. **Joining while booking is pending or needed?** Recommended: allow it (it's GolfMe-group-only), with the join-sheet sentence and the booking-status line always shown. No server block.
4. **Evidence formats and limits?** Recommended for v1: **images only** (screenshots of confirmation emails, apps or pages), re-encoded on the device to JPEG at 1600 px, which strips EXIF and location data. Bucket allowlist `image/jpeg`, **5 MB** limit (after re-encoding these are under 1 MB). One current file per round.
   - PDF is deferred, because there's no server-side sniffing or safe preview today. Adding it needs an Edge Function that checks the `%PDF` magic and is opened only as a download.
   - Any `.eml` or `.msg` upload is refused: no mailbox access and no email files.
   - The server checks Storage's recorded MIME type and size. A real content sniff would need that Edge Function. This gap should be stated plainly.
5. **Retention?** No default was chosen, per the brief. Suggested, for approval:
   - replaced, removed or invalidated raw files deleted within **7 days**;
   - all raw evidence deleted **30 days after the round date**, or at cancellation + 7 days;
   - the minimal audit (outcome, reason code, reviewer id, timestamps, version) kept **12 months**, then deleted;
   - legacy `booking_reference` values nulled in the Stage 2 migration;
   - account deletion purges everything immediately (already true);
   - backups follow Supabase's window, to be stated in the privacy policy.
6. **Staleness and post-round expiry?** Recommended:
   - The reviewed badge always shows its review date.
   - It disappears from display after the round day and whenever the booking details or status change.
   - No automatic recheck.
   - Optional: if a review is older than 14 days and the round is 2 days out, one bell reminder to the host: "Is your booking still on?" Confirming that doesn't renew the review.
7. **Capture a host-entered booked party size?** Recommended: yes, optional. Label it "Booked party size (host-reported)", show it separately from "GolfMe places", and let the reviewer match it. Omitting it is simpler, and the reviewer then checks course, date and time only.
8. **Booking source and reference fields?** Recommended:
   - Stop collecting the confirmation number entirely. The brief says not to require it, and it's sensitive.
   - Keep "Booked via" as a fixed list (Course website / GolfNow / Chronogolf / Phone / Other) stored as an enum, or drop it altogether. Never free text shown to members.
9. **"Check with course" link on round detail?** Recommended: show it only when `courses.website` is an https URL from GolfCourseAPI enrichment, labelled "Check with course". Otherwise show a web search labelled "Search for this course". Never "Book" and never a partner implication. This needs the round's course row loaded (a small extra fetch). Approve, or keep it to the course page.
10. **Who owns misleading-claim reports?** Recommended: Micky, through the existing round report → email alert → admin Reports list, with a new category "Misleading or outdated booking info". The reviewer can move the evidence to "needs update". No automatic penalty, and no Reputation impact (Reputation's formula is frozen).
11. **Notifications:** push or bell for "booking changed or cancelled" and "evidence reviewed"? Recommended:
    - joined members get a push plus bell when the host marks the booking changed or cancelled (round-update push precedent);
    - the host gets a bell only for review outcomes;
    - "evidence submitted" goes to the bell only.
12. **Staging:** is a staging Supabase project available to run the authz suite against the real Storage API? If not, PGlite plus a careful production read-only check is the fallback.
13. **Stage 1 copy word "yet"** ("GolfMe doesn't review confirmations yet", "doesn't book … yet"): recommended, drop it. It implies a roadmap promise.

---

## 5. Verification done this round

- Read: CLAUDE.md, DEVELOPMENT_STATUS.md (Phases 8, 14 and 20, the migration list), BACKEND_STATUS.md, LAUNCH_CHECKLIST.md, every migration and source file cited above, and the six locale files for the listed keys.
- Ran: the PGlite replay of every migration (skipping the prod backfill `20261006120100` and the not-live `20261106120100`), with role-simulated security probes (§0).
- Not run: `tsc`, lint, build or headless (no code changed), the real Storage API, or a device check.

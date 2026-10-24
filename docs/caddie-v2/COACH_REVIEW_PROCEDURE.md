# Caddie V2: coach review procedure (in person and remote)

Status: **draft, 2026-10-20. No coach recruited, no session run.** Micky's decisions (2026-10-20):

- The remote method for the pilot (3 to 5 golfers, decided 2026-10-21) is **Option A, live screen-share with no recording** (`VIDEO_IMPORT_AND_CONSENT.md` §7). Encrypted USB by post (Option B) isn't used in the pilot.
- The remote platform is **Google Meet**: screen-share only, no recordings or screenshots, Meet's privacy and data settings verified on Micky's account (section 4), only consented, de-identified clips (contributor IDs, audio and metadata stripped), a signed coach agreement, and the tool gates unchanged. Zoom was considered and **not chosen**.
- **Pilot pass 2 is on:** after pass 1 is locked, coaches rate the **local prototype's** output (section 5).

`SCREEN_SHARE_PLATFORM_REVIEW` stays `null` until Micky has done the Meet settings review himself and recorded it in its own commit, so every remote session is refused until then.

**No coach session of any kind, in person or remote, until `coach-session-check` passes for that coach on that day.** The tool enforces the parts it can see (section 1); the rest is this procedure.

Related: `consent/COACH_CONFIDENTIALITY_v1.pdf` (the agreement coaches sign), `TESTING_PROTOCOL.md` §8 (recruitment checklist, what coaches label), `VIDEO_IMPORT_AND_CONSENT.md` §7 (sharing rules).

## 1. What must be true before any session

| Requirement | Who | Enforced by the tool? |
|---|---|---|
| Coach recruited against the checklist in `TESTING_PROTOCOL.md` §8 (qualification, independence, time) | Micky | No |
| Coach has read and signed the **coach confidentiality and data-handling agreement v1.0**; Micky has countersigned; the signed copy is in the identity key | Micky, coach | Recorded: `coach-add` refuses without `--signed yes` and the current version |
| Coach recorded with a pseudonymous ID (`K01`, `K02`) and the session types they're cleared for | Micky | Yes (`coach-add`; strict fields, no names) |
| Each clip shown has active consent covering this session type (in person: `coachViewing`; remote: also `remoteCoachViewing`) and is stripped | Micky | Yes (`coach-check`, used inside `coach-session-check`) |
| **Remote only:** the screen-share platform reviewed against section 4 on the hosting account within the last 30 days | Micky | Yes: `SCREEN_SHARE_PLATFORM_REVIEW` must be set (it ships `null`, so every remote session is refused) |
| Contributor consent covers remote coach review by live screen-share | Checked 2026-10-20 | Form v1.1 §8, second tick, first method: "a live video call where Micky shares his screen and plays the video; the call is not recorded and no video file is sent". Section 5 of the form says coaches see the Contributor ID, never the name. **No form change needed**; the tool's `remoteCoachViewing` field already maps to this tick |

Record a coach once:

```
node $T coach-add --coach K01 --agreement-version 1.0 --agreement-date 2026-MM-DD \
  --signed yes --in-person yes --remote-sessions no
```

Use `--remote-sessions yes` for a remote coach (`K02`). If a coach leaves or breaks the agreement: `node $T coach-revoke --coach K02`. IDs are never reused.

**Mark the platform reviewed** (remote only): after every box in section 4 is ticked for the platform and account Micky will host from, set in `tools/caddie-eval/import-clip.mjs`, in a commit of its own:

```js
export const SCREEN_SHARE_PLATFORM_REVIEW = { platform: "google_meet", reviewedOn: "YYYY-MM-DD", by: "Micky", checklist: "docs/caddie-v2/COACH_REVIEW_PROCEDURE.md" };
```

Use `google_meet`: since Micky's decision the tool accepts no other platform (`SCREEN_SHARE_PLATFORMS`). Re-review (new date) every 30 days and whenever the platform, plan, account, or app version's privacy settings change. The tool refuses a review older than 30 days.

**On the day of every session**, run and keep the output's clip list:

```
node $T coach-session-check --coach K01            # in person
node $T coach-session-check --coach K02 --remote   # remote
```

It exits 1 with the reason if anything is missing. Show only the clips it lists as `eligible`.

## 2. In-person session (K01)

1. **Before the coach arrives**
   1. `node $T retention` (nothing due) and `node $T verify` (`OK`).
   2. `node $T coach-session-check --coach K01`. Note the eligible clip IDs.
   3. Close everything on the laptop except the frame-step player and a file browser opened at `clips/` in the data folder. The identity key (signed forms, name list) must be closed and not on screen.
   4. Notifications off (Windows Focus / macOS Do Not Disturb). Phone face down.
   5. Print or open the blank labeling sheet pre-filled with the eligible clip IDs and `K01`, nothing else.
2. **Start**
   1. Remind the coach of the agreement: no photos or recording, no copies, IDs only, blind to the other coach and to Caddie output.
   2. The coach's phone stays away from the screen (in a bag or face down) for the session.
3. **Labeling** (pass 1, `TESTING_PROTOCOL.md` §8)
   1. Open one clip at a time by clip ID. The coach drives the frame-step controls; Micky stays present but doesn't comment on swings.
   2. The coach fills in the sheet. Micky checks that free-text fields contain no names or places.
4. **Finish**
   1. Close the player. Collect the sheet (paper or file). The coach keeps nothing.
   2. Micky saves one file per clip as `labels/<clip ID>-K01.json` in the data folder (fields from `TESTING_PROTOCOL.md` §8 only), then runs `node $T verify`. It flags unknown fields, a coach ID that doesn't match the file name, or an unknown coach.
   3. Shred a paper sheet once its labels are saved and checked. Delete any sheet file kept outside the data folder.

## 3. Remote session by Google Meet screen-share (K02, Option A)

The coach never receives a file. Google Meet relays the picture live (encrypted in transit to Google, not end-to-end); the coach could capture it with another device, which only the signed agreement covers.

1. **Before the call (day before)**
   1. Platform reviewed in the last 30 days (section 4) and `SCREEN_SHARE_PLATFORM_REVIEW` set.
   2. Create **one meeting for this session only**: in Meet, "New meeting" > "Create a meeting for later" (a fresh link), not a recurring Calendar event or a reused link. Don't create it from a Calendar event that invites other people or carries attachments. Send the link to the coach only, by a direct message. Delete the link after the session.
   3. Send the coach the **blank** labeling sheet with the eligible clip IDs and `K02` only, or plan to type their answers yourself (step 3.4).
2. **Before the coach joins (on the day)**
   1. `node $T retention`, `node $T verify`, then `node $T coach-session-check --coach K02 --remote`. If it refuses, cancel the session.
   2. Re-check the Meet settings from section 4.1: recording, transcripts, "Take notes for me" (Gemini), captions, chat, and participant screen-sharing all **off**; Host management on.
   3. Close everything except the frame-step player (and, for pass 2, the overlay video and the results summary). Identity key closed. Notifications off. Join from Chrome or Edge on the laptop, signed in to the account that was reviewed.
   4. Plan to share **only the player window** ("Present" > "A window"), not the entire screen or a browser tab with other tabs open.
3. **Admit and confirm**
   1. Admit only the expected coach (Meet's "asks to join" prompt). Check it's them by video before sharing anything. Deny anyone else. Meet has no meeting lock for personal accounts as far as the help pages say; with Host management on, only the host admits people.
   2. Ask the coach to confirm aloud: they're in a private place, nobody else can see their screen, nothing is recording on their side, and AI note-takers or meeting bots are off. Remove any bot or unexpected participant immediately.
4. **Labeling**
   1. Share the player window. Play clips by clip ID. The coach says "back one frame", "play", "stop"; Micky steps frames and reads out the player's timestamp when the coach marks a phase.
   2. Labels go on the sheet keyed by clip ID and `K02`. The safest default is that **Micky types the coach's answers** into the sheet on his laptop during the call, so no sheet file sits on the coach's side. If the coach fills their own copy, they send it back as a file containing only clip IDs, `K02`, and labels (no footage, no names), and delete their copy afterwards (agreement §5).
   3. Expect this to be slower than in person, and phase times less exact (compression and lag on the shared picture). Note any clip where the coach says the shared picture was too poor to time, as `cant_tell` rather than a guess.
5. **End**
   1. Stop presenting, then "End call for everyone" (host option), or leave last.
   2. Check Google Drive (the "Meet Recordings" folder), Google Docs (auto "Notes by Gemini"), and the Calendar event (if any) for a recording, transcript, notes, or attachment that appeared anyway. If one did, delete it (and empty the Drive trash), and treat it as an incident (section 6).
   3. Save labels as `labels/<clip ID>-K02.json`, run `node $T verify`, and delete any emailed sheet from the inbox and trash once saved.

## 4. Screen-share platform checklist (Google Meet)

Tick every box on the **Google account Micky hosts from**, then set `SCREEN_SHARE_PLATFORM_REVIEW` with `platform: "google_meet"` (section 1). Record the account type (personal Google account, Google One, or a Workspace edition) and the browser version you checked, not the account address. Re-do it every 30 days and whenever the account type, plan, or Google's Meet settings change.

Facts below come from Google's Meet help pages read on 2026-10-20 (**unverified**; settings move and differ by account type). Where Google's page didn't say, the item says so: check it on the account.

### 4.1 Meet settings to verify

**Before the first session (account level)**

- [ ] **Account type noted.** Recording, transcripts, and Gemini "Take notes for me" depend on the plan (Google's help says "Take notes for me" needs an eligible Workspace subscription). On a personal account some of these may simply not exist; write "not available" rather than skipping the line.
- [ ] **Meet settings > Meeting records:** automatic recording **off**, automatic transcripts **off**, "Automatic note taking" / "Take notes for me" **off** (where shown).
- [ ] **Gemini in Meet:** any "Ask Gemini", summary, or "catch me up" option off or not present. Turning off one Gemini feature doesn't turn off the others (third-party guide, not Google; check each).
- [ ] **Captions:** off by default for the meeting. Captions themselves aren't saved, but transcripts are a separate feature; keep both off.
- [ ] **Google account "Smart features" and Workspace data settings** (Google's "smart features & controls" page): note what they cover and set them so meeting content isn't used for personalization. Note the page's date.
- [ ] **Browser:** Chrome or Edge up to date; **no extensions** that capture meetings (note-takers, transcript or recording extensions). Use a separate browser profile with no extensions if needed.

**In every meeting, before admitting the coach (Host controls, the shield or "Host controls" panel)**

- [ ] **Host management on** (only the host and co-hosts mute, remove, and change these settings). No co-hosts.
- [ ] **Quick access off** (Workspace) so everyone has to ask to join; on a personal account, people not invited ask to join by default.
- [ ] **"Let everyone share their screen" off** (only Micky presents).
- [ ] **"Let everyone send chat messages" off** (no files or links via chat).
- [ ] **No recording, transcript, or "Take notes for me" running:** no red recording dot, no "Gemini is taking notes" banner. If one appears, stop it at once and follow section 6.
- [ ] **No add-ons** opened in the meeting (Meet add-ons, whiteboards, shared docs).

**Platform terms (once, then on each re-review)**

- [ ] Google's *Meet security & privacy* page (<https://support.google.com/meet/answer/9852160>, read 2026-10-20) says media is encrypted in transit by default, that Google doesn't store video or audio of a meeting unless recording, transcription, or note-taking is turned on, and that Google Cloud doesn't use customer data for advertising. It shows no "last updated" date, and **it doesn't say whether meeting content is used to train AI models**. Find that answer for the account type (Google privacy policy, Workspace terms, or the smart-features page) and note where it says so. If it can't be found, write "not found" and decide whether that's acceptable.
- [ ] Meet is **not end-to-end encrypted** in a default meeting (client-side encryption exists only for some Workspace editions). Google could technically access the live stream. Accepted by Micky's decision; noted here so the contributor-facing answer stays honest.
- [ ] Note any meeting length limit for the account (from memory: one-to-one calls on a personal account are long enough for a session; unverified).
- [ ] Note whether the coach needs a Google account to join a meeting hosted from this account type.

Reviewed: platform Google Meet; account type ________ browser ________ on ____-__-__ by ______

### 4.2 Platforms considered (public docs, unverified)

Read by the assistant on 2026-10-20. **Decision: Google Meet** (Micky, 2026-10-20). The others are kept only as the record of what was compared.

| | FaceTime | Zoom (not chosen) | Google Meet (**chosen**) |
|---|---|---|---|
| Encryption | Apple's Platform Security guide says FaceTime audio and video are end-to-end encrypted (<https://support.apple.com/guide/security/facetime-security-seca331c55cd/web>) | Optional end-to-end encryption; Zoom's support article says it disables cloud recording, AI features, and live transcription (<https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065408>) | Encrypted in transit by default; Google doesn't keep meeting video or audio unless recording, transcription, or note-taking is on (<https://support.google.com/meet/answer/9852160>) |
| Host from Micky's laptop | Only from a Mac | Windows desktop app | Browser on Windows |
| Why not / why | Not usable unless the data folder lives on a Mac | E2EE is the stronger privacy story, but not chosen | Chosen: works from the Windows laptop in a browser; every capture feature must be checked off (4.1) |

## 5. Independence and blinding

- K01 and K02 label alone. Neither sees the other's sheet, and they don't discuss specific clips until both have locked pass 1 and pass 2.
- Micky doesn't comment on swings, faults, or phases during any session.
- **Pass 1 first, always blind:** coaches annotate the original clips without seeing any prototype output. Only after a coach's pass-1 sheet is locked (saved, `verify` passes) does that coach see prototype output.

### 5.1 Pass 2 in the pilot: rating the local prototype

V1 output can't exist in the pilot (both vendors blocked, `VENDOR_APPROVAL_CRITERIA.md` §6), so pass 2 rates the **local prototype**: MediaPipe pose, the V2 quality gate, the camera-angle heuristic, and the key-frame detector (`MEDIAPIPE_POC.md`). Say it to the coach in these words: "This is a local prototype, not GolfMe's Caddie. It finds body points and guesses four key frames (address, top, impact, finish). It doesn't produce measurements, faults, explanations, or drills yet."

What the coach is shown, per eligible clip, on Micky's laptop (in person) or in the shared player window (remote):

1. The **overlay video** `derived/<clip ID>/overlay-mediapipe-full.mp4` (from `render-overlay.mjs`): the clip with the prototype's confident body points drawn on it; a red border on frames the quality gate rejects.
2. The **results summary** printed by `run-v2-checks.mjs` for the clip: quality gate pass/inconclusive and why, camera angle (or `unknown`), and the detected key frames (frame number and heuristic confidence, or "inconclusive" and why). Step to each key frame in the player so the coach can rate `p2_phase_rating`.

Nothing else. Never show a fault, tip, drill, or explanation: the prototype has none, and none may be written by hand.

The coach rates the six items on the pass-2 sheet (`TESTING_PROTOCOL.md` §8, `EVAL_REPORT_TEMPLATE.md` §7a). Items the prototype doesn't produce are pre-filled **"not implemented, not rated"** (`not_implemented` in the label file). The tool refuses any other value for them.

Rules: same agreement, same no-recording and no-screenshot rules, same `coach-session-check` gate on the day. The overlay is derived data: it stays in `derived/`, is never sent as a file, and is deleted with the clip on withdrawal or retention.

## 6. Incidents

If a recording, transcript, summary, screenshot, or file transfer happened, or someone unexpected saw the screen:

1. Stop the session.
2. Delete what was captured (platform dashboard; ask the coach to delete theirs and confirm in writing).
3. Tell the affected contributors (by clip ID, Micky knows who), and note it in the identity key with the date.
4. Decide with the contributor whether to withdraw those clips (`withdraw --confirm`).
5. If the platform turned something on by itself, set `SCREEN_SHARE_PLATFORM_REVIEW` back to `null` until re-reviewed.

## 7. After the pilot

- Withdrawal: when a contributor withdraws, send each coach the withdrawn clip IDs and get written confirmation, within 7 days, that they hold nothing (agreement §6).
- End of project: each coach confirms in writing that they hold nothing; `coach-revoke` both; delete signed agreements with the rest of the identity key at project end.

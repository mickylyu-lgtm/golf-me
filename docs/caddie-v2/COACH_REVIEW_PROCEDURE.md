# Caddie V2: coach review procedure (in person and remote)

Status: **draft, 2026-10-20. No coach recruited, no session run.** Micky's decision (2026-10-20): the remote method for the 10-clip pilot is **Option A, live screen-share with no recording** (`VIDEO_IMPORT_AND_CONSENT.md` §7). Encrypted USB by post (Option B) isn't used in the pilot.

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
export const SCREEN_SHARE_PLATFORM_REVIEW = { platform: "zoom", reviewedOn: "YYYY-MM-DD", by: "Micky", checklist: "docs/caddie-v2/COACH_REVIEW_PROCEDURE.md" };
```

Allowed platforms: `facetime`, `zoom`, `google_meet`, `microsoft_teams`. Re-review (new date) every 30 days and whenever the platform, plan, account, or app version's privacy settings change. The tool refuses a review older than 30 days.

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

## 3. Remote session by live screen-share (K02, Option A)

The coach never receives a file. The call service relays the picture live; the coach could capture it with another device, which only the signed agreement covers.

1. **Before the call (day before)**
   1. Platform reviewed in the last 30 days (section 4) and `SCREEN_SHARE_PLATFORM_REVIEW` set.
   2. Create **one meeting for this session only**: new meeting ID, passcode on, waiting room or knock-to-join on, no recurring or personal meeting link. Send the link and passcode to the coach only, by a direct message, not a group or calendar invite with other people.
   3. Send the coach the **blank** labeling sheet with the eligible clip IDs and `K02` only, or plan to type their answers yourself (step 3.4).
2. **Before the coach joins (on the day)**
   1. `node $T retention`, `node $T verify`, then `node $T coach-session-check --coach K02 --remote`. If it refuses, cancel the session.
   2. Re-check the meeting's settings from section 4: recording, transcripts, captions saved to file, AI notes or summary, chat file transfer all **off**.
   3. Close everything except the frame-step player. Identity key closed. Notifications off. Start the meeting from the desktop app.
   4. Plan to share **only the player window**, not the whole screen.
3. **Admit and confirm**
   1. Admit only the expected coach from the waiting room. Check it's them by video before sharing anything. **Lock the meeting** if the platform allows it.
   2. Ask the coach to confirm aloud: they're in a private place, nobody else can see their screen, nothing is recording on their side, and AI note-takers or meeting bots are off. Remove any bot or unexpected participant immediately.
4. **Labeling**
   1. Share the player window. Play clips by clip ID. The coach says "back one frame", "play", "stop"; Micky steps frames and reads out the player's timestamp when the coach marks a phase.
   2. Labels go on the sheet keyed by clip ID and `K02`. The safest default is that **Micky types the coach's answers** into the sheet on his laptop during the call, so no sheet file sits on the coach's side. If the coach fills their own copy, they send it back as a file containing only clip IDs, `K02`, and labels (no footage, no names), and delete their copy afterwards (agreement §5).
   3. Expect this to be slower than in person, and phase times less exact (compression and lag on the shared picture). Note any clip where the coach says the shared picture was too poor to time, as `cant_tell` rather than a guess.
5. **End**
   1. Stop sharing, end the meeting for everyone.
   2. Check the platform's account dashboard for any recording, transcript, summary, or chat file that appeared anyway. If one did, delete it, and treat it as an incident (section 6).
   3. Save labels as `labels/<clip ID>-K02.json`, run `node $T verify`, and delete any emailed sheet from the inbox and trash once saved.

## 4. Screen-share platform checklist

Tick every box on the **account Micky hosts from**, then set `SCREEN_SHARE_PLATFORM_REVIEW` (section 1). Record the plan and app version you checked, not the account ID.

**Account and meeting settings**

- [ ] **Cloud recording off** (account level, and locked if the plan allows locking).
- [ ] **Local recording by participants off** (only the host can allow it; leave it disallowed).
- [ ] **Live transcription / captions saved to file off**; transcripts not stored.
- [ ] **AI features off:** meeting summaries, AI notes, AI companions or assistants, "catch me up", smart recordings. Check both the account setting and the in-meeting toggle; some platforms turn these on per meeting.
- [ ] **Chat file transfer off** (or in-meeting chat off).
- [ ] **Third-party apps and bots off** in meetings (note-taker bots, in-meeting apps, whiteboards that save content).
- [ ] **Passcode required**, **waiting room / knock-to-join on**, **meeting lock** available.
- [ ] **One-time meeting ID**, not a personal meeting room or a recurring link.
- [ ] **Screen-share limited to the host**.
- [ ] **End-to-end encryption on** if the platform offers it for this kind of meeting (it usually also blocks cloud recording and AI features, which is what we want).

**Platform terms**

- [ ] Read the platform's privacy notice for what it keeps from a call **without** recording (e.g. metadata, diagnostics) and for how long. Note the "last updated" date.
- [ ] Confirm meeting content isn't used to train AI models on this plan, or that the relevant setting is off. Note where it says so.
- [ ] Note where the service processes calls (region), for contributors in other countries.

Reviewed: platform ________ plan ________ app version ________ on ____-__-__ by ______

### 4.1 Comparison of common platforms (public docs, unverified)

Read by the assistant on 2026-10-20. **Unverified**: settings and terms change, and plan tiers differ. Micky checks the real settings on his account with the checklist above.

| | FaceTime | Zoom | Google Meet |
|---|---|---|---|
| Encryption | Apple's Platform Security guide says FaceTime audio and video are end-to-end encrypted and Apple can't decrypt them; call setup goes through Apple servers (<https://support.apple.com/guide/security/facetime-security-seca331c55cd/web>) | Optional end-to-end encryption, set by admins or per meeting; Zoom's support article says enabling it disables cloud recording, Zoom AI features, and live transcription, and needs every participant on the desktop or mobile app, not the web client (<https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065408>) | Google's Meet help says media is encrypted in transit by default, and that Google doesn't keep meeting video or audio unless recording, transcription, or note-taking is turned on (<https://support.google.com/meet/answer/9852160>). Client-side encryption is mentioned only for some Workspace setups (not read) |
| Recording / transcripts / AI notes | No built-in call recording (from memory, not checked); the main risk is the coach's own screen recording | Cloud and local recording, transcripts, and AI Companion are settings; E2EE turns several off | Recording, transcripts, and AI note-taking are features to switch off; availability depends on plan (not read) |
| Host from Micky's laptop | **Only from a Mac.** The pilot laptop appears to be Windows + WSL (the dev environment this branch was built in; Micky to confirm), and copying clips to an iPhone or Mac to host would break "clips stay on the laptop" | Windows desktop app works | Browser on Windows works |
| Coach joins from | Apple device, or a browser via a FaceTime link (from memory, not checked) | Desktop or mobile app (required for E2EE) | Browser or app |
| Fit for the pilot | Good privacy story, but not usable unless the data folder lives on a Mac | **Likely best fit if Micky has a Zoom account**: E2EE meeting with passcode and waiting room, recording and AI off by design | Workable with every capture feature checked off; no E2EE in a default meeting |

Microsoft Teams wasn't researched. If Micky prefers it, run the checklist above on his account first.

**Assistant's suggestion (Micky decides):** Zoom, with an end-to-end encrypted, passcode-protected, one-time meeting hosted from the Windows desktop app, and the account-level recording, transcript, AI, and chat-file settings off. Google Meet is the fallback.

## 5. Independence and blinding

- K01 and K02 label alone. Neither sees the other's sheet, and they don't discuss specific clips until both have locked pass 1 (and pass 2, if run).
- Micky doesn't comment on swings, faults, or phases during any session.
- Pass 2 (rating Caddie's output) **can't run in the pilot with V1 output**: both vendors are blocked (`VENDOR_APPROVAL_CRITERIA.md` §6). If a local-pose V2 output exists by then (`LOCAL_PILOT_WORKFLOW.md`), pass 2 may rate that, clearly labeled as the local-pose prototype, after pass 1 is locked.

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

# Caddie V2: 10-clip pilot day checklist

Status: **draft, 2026-10-20. Not run yet.** Tick the boxes on the day. The point of the pilot is to find problems in the process before filming the other 66 clips, so write down every snag.

Background: `LOCAL_PILOT_WORKFLOW.md` (the whole local-only flow and its blockers), `TESTING_PROTOCOL.md` (camera setup, shot matrix, labels), `VIDEO_IMPORT_AND_CONSENT.md` (storage, consent, deletion), `COACH_REVIEW_PROCEDURE.md` (coach sessions), `consent/CONSENT_FORM_v1.pdf` (the form), `consent/COACH_CONFIDENTIALITY_v1.pdf` (what coaches sign).

**The pilot is local only.** No clip goes to Roboflow, Gemini, Supabase, or any cloud. Roboflow is **excluded** from the pilot baseline until it confirms in writing that our configuration won't use the footage for training (Micky, 2026-10-20); Gemini is blocked until verified (`VENDOR_APPROVAL_CRITERIA.md`). The tool refuses third-party use anyway. Pose for the pilot comes from a **local model**: MediaPipe Pose Landmarker (Full; Heavy for comparison), installed 2026-10-20 as a pinned devDependency and run fully offline (`MEDIAPIPE_POC.md`). It has only been tested on a synthetic clip; the pilot is its first real run.

---

## 1. One week before

- [ ] **Contributors:** Micky (`C001`) plus at least one friend (`C002`), all 18+. Ideally one is left-handed (for clip 8). Nobody else will be in frame unless they also sign.
- [ ] Send each friend the **blank** `CONSENT_FORM_v1.pdf` to read in advance. They sign **on the day**, not before (the 90-day clock starts at the consent date).
- [ ] **Coaches:** note where recruitment stands (`TESTING_PROTOCOL.md` §8). The pilot can go ahead without coaches; their labeling then becomes the next step. Before any coach session: each coach signs `COACH_CONFIDENTIALITY_v1.pdf`, Micky records it with `coach-add`, and (remote) the screen-share platform is reviewed (`COACH_REVIEW_PROCEDURE.md` §1, §4).
- [ ] **Laptop:** BitLocker (Windows) or FileVault (Mac) on. Enough free disk (about 2 GB for 10 clips).
- [ ] **ffmpeg** available where the tool runs (WSL/Linux: `ffmpeg -version`; install with the system package manager if missing). If it isn't installed, the `ffmpeg-static` binary already in the repo's `node_modules` works for stripping and decoding: `export GOLFME_EVAL_FFMPEG=$PWD/node_modules/ffmpeg-static/ffmpeg`. It has no `ffprobe`, so `metadataVerified` stays `null` (not checked); spot-check one stripped clip's metadata by hand. Without any ffmpeg, plan the manual strip in `VIDEO_IMPORT_AND_CONSENT.md` §4.
- [ ] **Local pose ready:** `npm install` done on `caddie-v2`; `node tools/caddie-eval/fetch-models.mjs --check` prints `sha256 OK` for full and heavy (download them with `node tools/caddie-eval/fetch-models.mjs` if missing; the only network step, a public model file, no clip data). Headless Chromium launches (on WSL it may need the extra libraries described in `tools/caddie-eval/README.md`).
- [ ] **Data folder** created once, outside any repo and outside OneDrive/iCloud/Dropbox:

  ```
  cd <GolfMe checkout>            # on branch caddie-v2
  export GOLFME_EVAL_DATA_DIR=~/golfme-eval-data
  T=tools/caddie-eval/import-clip.mjs
  node $T init
  ```

  On Windows + WSL, `~/golfme-eval-data` lives inside the WSL disk image; that's fine as long as the drive holding it is BitLocker-encrypted.
- [ ] A **frame-step video player** for later labeling (QuickTime Player or VLC).
- [ ] Print or open the session log table (section 4 below), contributor IDs only.

## 2. On the day, before filming

- [ ] **Phone cloud backup off:** iCloud Photos (Settings > Photos) or Google Photos backup turned off on the filming phone. Check it's off, not paused.
- [ ] Phone storage free for about 20 clips (some retakes).
- [ ] Tripod, clamp, balls or mat. A friend available to film the handheld clip.
- [ ] **Consent, per person:**
  - [ ] They read the form, ask questions, tick their choices, sign and date it.
  - [ ] Micky writes the Contributor ID, contact line, and retention date (consent date + 90 days at most), and countersigns.
  - [ ] Give them a copy. File the original in the identity key (not the data folder).
  - [ ] Record it (copy the office-use block exactly):

    ```
    node $T consent-add --contributor C002 --form-version 1.1 \
      --consent-date 2026-MM-DD --retention-until 2026-MM-DD \
      --adult yes --signed yes \
      --coach-viewing yes --remote-coach-viewing no \
      --roboflow no --gemini no
    ```

    Use `no` for any box they didn't tick. The tool refuses if `--signed` or `--adult` isn't `yes`, or if retention is over 90 days.
- [ ] Set up the tripod for face-on (3 m to 4 m, hand height, portrait, 1x lens). Film **one test clip** and check the full body, club at the top, and finish are in frame. Delete the test clip.

## 3. Filming slots (10 clips)

Record 2 s before address, stop 1 s after the finish, 10 s or less, one swing per clip. Note the phone's file name in the session log right after each clip. Retakes are fine; log only the keeper.

| # | Slot code | Who | Angle | Club | Mount | Light | Condition | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | `FO-DR-TRI-RH-DAY` | C001 | face_on | driver | tripod | daylight | | |
| 2 | `DTL-DR-TRI-RH-DAY` | C001 | down_the_line | driver | tripod | daylight | | Move tripod behind the hands |
| 3 | `FO-HY-TRI-RH-DAY` | C001 | face_on | hybrid | tripod | daylight | | |
| 4 | `DTL-HY-TRI-RH-DAY` | C002 | down_the_line | hybrid | tripod | daylight | | |
| 5 | `FO-IR-TRI-RH-DAY` | C002 | face_on | iron | tripod | daylight | | 6 to 8 iron |
| 6 | `DTL-IR-TRI-RH-DAY` | C002 | down_the_line | iron | tripod | daylight | | |
| 7 | `FO-IR-HND-RH-DAY` | C001 | face_on | iron | handheld | daylight | | Friend films, no zoom, no following the ball |
| 8 | `FO-DR-TRI-LH-DAY` | left-handed contributor | face_on | driver | tripod | daylight | | If nobody is left-handed: film `DTL-IR-HND-RH-DAY` instead and note "no LH" |
| 9 | `FO-IR-TRI-RH-DAY` | C002 | face_on | iron | tripod | daylight | `no_swing` | Waggle and setup only |
| 10 | `DTL-DR-TRI-RH-DAY` | C001 or C002 | down_the_line | driver | tripod | daylight | `partial_body` | Frame so the feet or club head is cut off |

Swap who does which slot as needed, keeping **at most 5 clips per person** and both angles for each person. Use the right handedness for whoever swings.

## 4. Session log (scratch, deleted after import)

| # | Contributor | Phone file | Slot code | Condition | fps | Skill (self-reported) | Note (no names, no place names) |
|---|---|---|---|---|---|---|---|
| 1 | C001 | IMG_____.MOV | FO-DR-TRI-RH-DAY | | 30 | | |
| ... | | | | | | | |

## 5. Transfer to the laptop

- [ ] USB cable (Windows: Photos app import or File Explorer; Mac: Image Capture) or AirDrop. **Not** email, chat apps, or a shared drive.
- [ ] Into a temporary folder that's **not** in OneDrive/iCloud/Dropbox and **not** in the repo (on Windows, avoid Documents/Desktop if OneDrive syncs them; e.g. `C:\caddie-tmp\`, which WSL sees as `/mnt/c/caddie-tmp/`).
- [ ] Check the count: 10 files.

## 6. Import

One command per clip, labels from the session log. Example for clip 1:

```
node $T import --contributor C001 --file /mnt/c/caddie-tmp/IMG_0412.MOV \
  --angle face_on --club driver --mount tripod --handedness right \
  --lighting daylight --skill mid --fps 30 --require-strip
```

- Add `--condition no_swing` (clip 9) or `--condition partial_body` (clip 10).
- `--require-strip` refuses if ffmpeg is missing. If ffmpeg isn't available, do the manual strip first and use `--stripped-manually` instead.
- Each import prints the new clip ID (`C001-0001`, ...). Write it next to the row in the session log until all 10 are in.

## 7. Checks after import

- [ ] `node $T verify` prints `OK`. If it lists "metadata not stripped", fix before anyone else sees the clip.
- [ ] `node $T status`: 10 clips, the expected slot codes, `leftHandedShare` (10 % if clip 8 was left-handed, else 0), skill mix.
- [ ] `node $T coach-check` lists the clips coaches may watch in person; `coach-check --remote` for a remote coach.
- [ ] `node $T coach-session-check --coach K01` (and `--coach K02 --remote`) refuses until the coach agreement is recorded and, for remote, the platform is reviewed. Expected until then.
- [ ] `node $T third-party-check --processor gemini` reports `vendorVerified: false` and exits 1. Expected.
- [ ] Spot-check two stored clips in the player: no sound, plays normally.
- [ ] Delete the temporary folder, the phone copies, the phone's "Recently Deleted", and the session log.
- [ ] Turn phone cloud backup back on only after the phone copies are gone.
- [ ] Calendar reminder: each contributor's retention date, and a weekly `node $T retention`.

## 7a. Local pose run (after import, before any coach session)

Everything stays in the data folder; nothing goes online.

- [ ] Per clip: `node tools/caddie-eval/pose-local.mjs --clip C001-0001` (Full). Optional comparison: `--variant heavy`.
- [ ] Check the printed `network blocked` line lists only `odml.pa.googleapis.com` (MediaPipe's usage logger, blocked on purpose) or nothing.
- [ ] Left/right check on one of Micky's own clips: in the overlay, the golfer's lead (left, for a right-hander) arm must be drawn cyan. If it's orange, stop: the mapping is mirrored.
- [ ] Per clip: `node tools/caddie-eval/run-v2-checks.mjs --clip C001-0001`, then `node tools/caddie-eval/render-overlay.mjs --clip C001-0001` (overlay for pass 2).
- [ ] Note any clip the extractor or the checks refused, and why.

## 8. What to send coaches

**Nothing by cloud, email, or chat.** Send only:

- The **blank labeling sheet** (columns from `TESTING_PROTOCOL.md` §8 pass 1), pre-filled with the clip IDs from `coach-check`, nothing else. Clip IDs and coach IDs only.
- The fixed fault list and the phase definitions (`TESTING_PROTOCOL.md` §8).
- The blank coach agreement (`consent/COACH_CONFIDENTIALITY_v1.pdf`) to read before signing.
- The session plan: in person (`K01`) on Micky's laptop; remote (`K02`) **only by live Google Meet screen-share with no recording or screenshots** (Micky's decisions 2026-10-20), following `COACH_REVIEW_PROCEDURE.md` §3. No file is sent to a coach.
- The pass-2 sheet with the six items, five of them pre-filled "not implemented, not rated" (`TESTING_PROTOCOL.md` §8, "Pass 2 in the pilot").

Then:

- [ ] On the day of each session: `node $T coach-session-check --coach K0X [--remote]` passes; show only its `eligible` clips.
- [ ] Pass 1 (blind labels): each coach on their own, without seeing the other's sheet or any Caddie output.
- [ ] **Remote only:** Micky has done the Google Meet settings review (`COACH_REVIEW_PROCEDURE.md` §4.1) and set `SCREEN_SHARE_PLATFORM_REVIEW` in its own commit. Until then `coach-session-check --remote` refuses.
- [ ] **Pass 2 (on):** after a coach's pass 1 is saved and `verify` passes, show that coach the overlay and the gate/angle summary for each eligible clip and record the six ratings (`COACH_REVIEW_PROCEDURE.md` §5.1). Only body landmark reliability can be rated; the other five stay `not_implemented`. V1 output isn't used (Roboflow and Gemini stay blocked).
- [ ] Labels come back as a sheet keyed by clip ID and coach ID. Save each as `labels/<clip ID>-<coach ID>.json` inside the data folder (protocol fields only), so withdrawal deletes them. `node $T verify` checks the names, fields, and coach IDs.

## 9. Pilot review (before filming the other 66)

Write down, without names:

- Did consent take longer than expected? Any question the form didn't answer? (A wording change means form 1.2.)
- Framing: did any clip lose the club or feet unintentionally?
- Did ffmpeg strip work and `verify` pass first time?
- Labeling time per clip, per coach. Any field coaches found unclear? Any disagreement on clips 1 to 6?
- Did the left-handed slot work? If no left-handed contributor exists, decide whether the 15 to 20 % target is achievable.
- Go / no-go for the full set, and any process change. Pilot clips count toward the 76 only if nothing affecting them changed.

# Caddie V2: pilot day checklist (3 to 5 golfers, local only)

Status: **draft, 2026-10-21. Not run yet.** Micky's decision (2026-10-21): a local pilot with **3 to 5 consenting golfers**, real face-on and down-the-line videos, replacing the earlier 10-clip framing. Tick the boxes on the day and write down every snag: the pilot exists to find problems in the process before filming the full set.

Background: `LOCAL_PILOT_WORKFLOW.md` (the whole flow and its blockers), `TESTING_PROTOCOL.md` (camera setup, labels), `VIDEO_IMPORT_AND_CONSENT.md` (storage, consent, deletion), `COACH_REVIEW_PROCEDURE.md` (coach sessions), `KEYFRAME_ANNOTATION_GUIDE.md` (K00 labels), `MEDIAPIPE_TELEMETRY_AUDIT.md` (what is blocked and why), `consent/CONSENT_FORM_v1.pdf`, `consent/COACH_CONFIDENTIALITY_v1.pdf`.

**Local only.** No video, frame, landmark, label, or identifier goes to Roboflow, Gemini, Supabase, Google, or any cloud. Pose comes from MediaPipe running offline inside an empty network namespace, with MediaPipe's own usage logger blocked. Roboflow and Gemini stay blocked (`VENDOR_APPROVAL_CRITERIA.md`), and the tool refuses third-party use anyway.

---

## 0. Targets

| | Target |
|---|---|
| Golfers | **3 to 5**, all adults with signed consent. Micky is `C001`, others `C002` onwards |
| Left-handed | **At least one left-handed golfer if available.** If none, report left-handed results as "not measured" (`TESTING_PROTOCOL.md` §4); never mirror a right-handed clip to stand in |
| Skill | A mix if possible (self-reported at import) |
| Clips per golfer | **8 core clips** (table below): 2 views x 2 clubs x 2 swings. Optional: 1 hybrid per view if time allows (up to 10) |
| Extra trouble clips | **3, filmed of Micky only:** `no_swing`, `partial_body`, handheld (§3) |
| Total | about 27 to 43 clips, of which 24 to 40 core |
| No one golfer | more than 50 % of the clips (`TESTING_PROTOCOL.md` §4) |
| K00 key-frame labels | **at least 1 face-on and 1 down-the-line clip per golfer** (6 to 10 clips), all four key frames; more if time allows |

Core clips, per golfer (same matrix for left-handers: the camera positions mirror, `TESTING_PROTOCOL.md` §5):

| View | Club | Swings (keepers) |
|---|---|---|
| face_on | driver | 2 |
| face_on | iron (6 to 8) | 2 |
| down_the_line | driver | 2 |
| down_the_line | iron (6 to 8) | 2 |
| (optional) face_on / down_the_line | hybrid | 1 each |

## 1. One week before

- [ ] **Golfers:** 3 to 5 adults lined up, ideally one left-handed. Nobody else in frame unless they also sign.
- [ ] Send each the **blank** `CONSENT_FORM_v1.pdf` to read. They sign **on the day**, not before (the 90-day clock starts at the consent date).
- [ ] **Coaches:** note where recruitment stands (`TESTING_PROTOCOL.md` §8). The pilot goes ahead without them; coach labeling is then the next step. Before any coach session: signed `COACH_CONFIDENTIALITY_v1.pdf`, `coach-add`, and (remote) the Google Meet review (`COACH_REVIEW_PROCEDURE.md` §4.1).
- [ ] **Laptop:** BitLocker (Windows) or FileVault (Mac) on. Free disk: about **6 GB** (clips plus exported frames for the labeled subset; frames are about 30 MB per labeled clip).
- [ ] **ffmpeg** where the tool runs (`ffmpeg -version`). Without a system ffmpeg: `export GOLFME_EVAL_FFMPEG=$PWD/node_modules/ffmpeg-static/ffmpeg` (no `ffprobe`, so `metadataVerified` stays `null`; spot-check one stripped clip's metadata by hand).
- [ ] **Local pose ready:** `npm install` on `caddie-v2`; `node tools/caddie-eval/fetch-models.mjs --check` prints `sha256 OK` for full and heavy; headless Chromium launches (WSL may need the extra libraries in `tools/caddie-eval/README.md`).
- [ ] **OS isolation works:** `unshare --user --map-root-user --net true && echo ok` prints `ok`. (`pose-local.mjs` uses it automatically. If it fails, tell the assistant before the pilot; don't just pass `--no-netns`.)
- [ ] **Labeling page reaches the browser:** run `node tools/caddie-eval/keyframes.mjs demo`, open the printed `http://127.0.0.1:...` address in an InPrivate/Incognito window in Windows, label one frame of the test pattern, Save, Done. (Synthetic, no person, deleted on exit. Confirms WSL's localhost forwarding on this laptop.)
- [ ] **Data folder** created once, outside any repo and any synced folder, and K00 recorded once:

  ```
  cd <GolfMe checkout>            # on branch caddie-v2
  export GOLFME_EVAL_DATA_DIR=~/golfme-eval-data
  T=tools/caddie-eval/import-clip.mjs
  node $T init
  node $T annotator-add --annotator K00
  ```

- [ ] Print or open the session log (§4), contributor IDs only.

## 2. On the day, before filming

- [ ] **Phone cloud backup off** (iCloud Photos / Google Photos): off, not paused.
- [ ] Phone storage for about 60 clips (retakes).
- [ ] Tripod, clamp, balls or mat. A friend to film the handheld clip.
- [ ] **Consent, per golfer:**
  - [ ] They read the form, ask questions, tick their choices, sign and date it.
  - [ ] Micky writes the Contributor ID, contact line, retention date (consent date + 90 days at most), and countersigns.
  - [ ] Give them a copy. File the original in the identity key (not the data folder).
  - [ ] Record it (copy the office-use block exactly):

    ```
    node $T consent-add --contributor C002 --form-version 1.1 \
      --consent-date 2026-MM-DD --retention-until 2026-MM-DD \
      --adult yes --signed yes \
      --coach-viewing yes --remote-coach-viewing no \
      --roboflow no --gemini no
    ```

    `no` for any box they didn't tick. The tool refuses if `--signed` or `--adult` isn't `yes`, or retention is over 90 days.
- [ ] Face-on tripod: 3 m to 4 m, hand height, portrait, 1x lens. **One test clip**: full body, club at the top, and finish all in frame. Delete it. Repeat the check when moving to down-the-line (behind the hands, on the target line).

## 3. Filming

Record 2 s before address, stop 1 s after the finish, 10 s or less, one swing per clip. Note the phone's file name in the session log right after each keeper. Film one golfer's 8 core clips in one go (face-on driver, face-on iron, then move the tripod: down-the-line driver, down-the-line iron), then the next golfer.

Slot code: `<view>-<club>-<mount>-<hand>-<light>`, e.g. `FO-DR-TRI-RH-DAY`, `DTL-IR-TRI-LH-DAY`. Use the right handedness for whoever swings.

Micky's 3 trouble clips (after his core clips):

| Slot | Condition | Notes |
|---|---|---|
| `FO-IR-HND-RH-DAY` | (handheld) | A friend films, no zoom, no following the ball |
| `FO-IR-TRI-RH-DAY` | `no_swing` | Waggle and setup only |
| `DTL-DR-TRI-RH-DAY` | `partial_body` | Frame so the feet or club head is cut off |

## 4. Session log (scratch, deleted after import)

| # | Contributor | Phone file | Slot code | Condition | fps | Skill (self-reported) | Note (no names, no place names) |
|---|---|---|---|---|---|---|---|
| 1 | C001 | IMG_____.MOV | FO-DR-TRI-RH-DAY | | 30 | | |
| ... | | | | | | | |

## 5. Transfer to the laptop

- [ ] USB cable (Windows: Photos import or File Explorer; Mac: Image Capture) or AirDrop. **Not** email, chat apps, or a shared drive.
- [ ] Into a temporary folder **not** in OneDrive/iCloud/Dropbox and **not** in the repo (e.g. `C:\caddie-tmp\`, `/mnt/c/caddie-tmp/` in WSL).
- [ ] Count the files against the session log.

## 6. Import

One command per clip, from the session log:

```
node $T import --contributor C002 --file /mnt/c/caddie-tmp/IMG_0412.MOV \
  --angle face_on --club driver --mount tripod --handedness left \
  --lighting daylight --skill mid --fps 30 --require-strip
```

- Add `--condition no_swing` / `--condition partial_body` for the trouble clips, `--mount handheld` for the handheld one.
- `--require-strip` refuses if ffmpeg is missing (then do the manual strip and use `--stripped-manually`).
- Write each printed clip ID (`C002-0001`, ...) next to its row until all are in.

## 7. Checks after import

- [ ] `node $T verify` prints `OK`. Fix any "metadata not stripped" before anyone else sees the clip.
- [ ] `node $T status`: the expected clip count and slots, `leftHandedShare` (0 if no left-hander), skill mix.
- [ ] `node $T coach-check` (and `--remote`); `coach-session-check --coach K01` refuses until the coach is recorded. Expected.
- [ ] `node $T third-party-check --processor gemini` reports `vendorVerified: false` and exits 1. Expected.
- [ ] Spot-check two stored clips: no sound, plays normally.
- [ ] Delete the temp folder, phone copies, the phone's "Recently Deleted", and the session log. Cloud backup back on only after that.
- [ ] Calendar: each contributor's retention date, and a weekly `node $T retention`.

## 7a. Local pose run (before any labeling or coach session)

- [ ] Per clip: `node tools/caddie-eval/pose-local.mjs --clip C001-0001` (Full; add `--variant heavy` to compare). It re-runs itself in an empty network namespace.
- [ ] The printed line shows `network blocked: {"odml.pa.googleapis.com":1}` (or `{}`) and `OS isolation: no network interfaces (isolated)`. Anything else: stop and note it.
- [ ] Left/right check on one of Micky's own clips: render the overlay (below); the golfer's lead arm (left, for a right-hander) must be cyan. If orange, stop: the mapping is mirrored.
- [ ] Per clip: `node tools/caddie-eval/run-v2-checks.mjs --clip C001-0001`, then `node tools/caddie-eval/render-overlay.mjs --clip C001-0001` (for coach pass 2).
- [ ] Note any clip a tool refused, and why.

## 7b. K00 key-frame labels (Micky; PROTOTYPE labels, not ground truth)

Follow `KEYFRAME_ANNOTATION_GUIDE.md`. **Label before looking at any overlay or report for that clip**, so labels stay blind to the model.

- [ ] Pick the subset: at least one face-on and one down-the-line clip per golfer.
- [ ] Per clip: `node tools/caddie-eval/keyframes.mjs export --clip C002-0001`, then `node tools/caddie-eval/keyframes.mjs label --clip C002-0001` and open the printed address in an InPrivate/Incognito window.
- [ ] Mark address, top, impact, finish (or `not_in_clip` / `cant_tell`) and all 13 points per labeled frame: golfer's own left/right; V / O / N / X codes. Save, then Done.
- [ ] A mistake found later: reopen with `label`, fix, pick a reason, save (a new version; the old one stays). `keyframes.mjs list --clip <ID>` shows the history.
- [ ] `node $T verify` still prints `OK` (it checks every annotation version).

## 7c. Measurements

- [ ] `node tools/caddie-eval/pilot-report.mjs` (and `--variant heavy` if run). It writes `reports/pilot-report-<variant>-<date>.md` in the data folder: offline check, detection per keypoint per view, accuracy vs K00 (prototype), time / CPU / memory per swing, face-on vs down-the-line. Cells with nothing behind them say "no data"; key-frame identification says "not implemented".
- [ ] Read it. Copy it into `docs/caddie-v2/eval-reports/` only after checking it holds clip IDs and numbers only, and only with Micky's go-ahead.

## 8. What to send coaches

**Nothing by cloud, email, or chat.** Only: the blank labeling sheet pre-filled with clip IDs from `coach-check`; the fault list and phase definitions (`TESTING_PROTOCOL.md` §8); the blank coach agreement to read before signing; the session plan (in person `K01` on Micky's laptop; remote `K02` only by live Google Meet screen-share, no recording or screenshots); the pass-2 sheet with five of six items pre-filled "not implemented, not rated". K00's labels are never shown to coaches before their own pass 1.

Then, per session: `coach-session-check --coach K0X [--remote]` passes; pass 1 blind; pass 2 on the overlay (only body landmark reliability is rateable); labels saved as `labels/<clip ID>-<coach ID>.json`; `verify` passes. Details: `COACH_REVIEW_PROCEDURE.md`.

## 9. Pilot review (before filming the full set)

Write down, without names:

- Consent: time taken, questions the form didn't answer (a wording change means form 1.2).
- Framing: any clip that lost the club or feet unintentionally? Down-the-line set-up time?
- Import: did ffmpeg strip work and `verify` pass first time?
- Pose: any refused run, any unexpected blocked host, any run not OS-isolated?
- K00 labeling: minutes per clip; points that were hard to code (which, which view); corrections needed and why.
- Left-handed: did it work? If nobody was left-handed, is the 15 to 20 % target realistic?
- Go / no-go for the full set and any process change. Pilot clips count toward the full set only if nothing affecting them changed (same form, sheet, camera rules).

# Caddie V2: 10-clip pilot day checklist

Status: **draft, 2026-10-20. Not run yet.** Tick the boxes on the day. The point of the pilot is to find problems in the process before filming the other 66 clips, so write down every snag.

Background: `TESTING_PROTOCOL.md` (camera setup, shot matrix, labels), `VIDEO_IMPORT_AND_CONSENT.md` (storage, consent, deletion), `consent/CONSENT_FORM_v1.pdf` (the form).

**The pilot is local only.** No clip goes to Roboflow, Gemini, Supabase, or any cloud. Both vendors are unverified (`VENDOR_VERIFICATION.md`), so the tool refuses third-party use anyway.

---

## 1. One week before

- [ ] **Contributors:** Micky (`C001`) plus at least one friend (`C002`), all 18+. Ideally one is left-handed (for clip 8). Nobody else will be in frame unless they also sign.
- [ ] Send each friend the **blank** `CONSENT_FORM_v1.pdf` to read in advance. They sign **on the day**, not before (the 90-day clock starts at the consent date).
- [ ] **Coaches:** note where recruitment stands (`TESTING_PROTOCOL.md` §8). The pilot can go ahead without coaches; their labeling then becomes the next step.
- [ ] **Laptop:** BitLocker (Windows) or FileVault (Mac) on. Enough free disk (about 2 GB for 10 clips).
- [ ] **ffmpeg** available where the tool runs (WSL/Linux: `ffmpeg -version`; install with the system package manager if missing). Without it, plan the manual strip in `VIDEO_IMPORT_AND_CONSENT.md` §4.
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
- [ ] `node $T third-party-check --processor gemini` reports `vendorVerified: false` and exits 1. Expected.
- [ ] Spot-check two stored clips in the player: no sound, plays normally.
- [ ] Delete the temporary folder, the phone copies, the phone's "Recently Deleted", and the session log.
- [ ] Turn phone cloud backup back on only after the phone copies are gone.
- [ ] Calendar reminder: each contributor's retention date, and a weekly `node $T retention`.

## 8. What to send coaches

**Nothing by cloud, email, or chat.** Send only:

- The **blank labeling sheet** (columns from `TESTING_PROTOCOL.md` §8 pass 1), pre-filled with the clip IDs from `coach-check`, nothing else. Clip IDs and coach IDs only.
- The fixed fault list and the phase definitions (`TESTING_PROTOCOL.md` §8).
- The session plan: in person (`K01`) on Micky's laptop; remote (`K02`) only by the method Micky has approved (`VIDEO_IMPORT_AND_CONSENT.md` §7).

Then:

- [ ] Pass 1 (blind labels): each coach on their own, without seeing the other's sheet or any Caddie output.
- [ ] Pass 2 (rate Caddie's feedback) **can't use V1 output in the pilot**: producing it means sending clips to Roboflow and Gemini, which is blocked until vendor verification, per-processor opt-ins, and spend approval. For the pilot, either skip pass 2 or dry-run the pass-2 sheet layout without real Caddie output.
- [ ] Labels come back as a sheet keyed by clip ID and coach ID. Save each as `labels/<clip ID>-<coach ID>.json` (or the sheet export) inside the data folder, so withdrawal deletes them.

## 9. Pilot review (before filming the other 66)

Write down, without names:

- Did consent take longer than expected? Any question the form didn't answer? (A wording change means form 1.2.)
- Framing: did any clip lose the club or feet unintentionally?
- Did ffmpeg strip work and `verify` pass first time?
- Labeling time per clip, per coach. Any field coaches found unclear? Any disagreement on clips 1 to 6?
- Did the left-handed slot work? If no left-handed contributor exists, decide whether the 15 to 20 % target is achievable.
- Go / no-go for the full set, and any process change. Pilot clips count toward the 76 only if nothing affecting them changed.

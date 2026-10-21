# Caddie V2: swing-video testing protocol

Status: **draft for Micky's review, 2026-10-20; updated the same day with Micky's testing decisions** (and later that day: Google Meet for remote coaches, pilot pass 2 on the local prototype) (about 76 clips starting with a pilot, since 2026-10-21 of 3 to 5 golfers, 2 coaches, 90-day retention, adults only). Nothing here has been run yet. Every count below is a **target to collect**, not a result. **No coach is recruited yet.**

Related:

- `VIDEO_IMPORT_AND_CONSENT.md`: consent, import, storage, withdrawal, retention. **Read it before filming anyone.**
- `consent/CONSENT_FORM_v1.pdf`: the form every person in frame signs (form version 1.1).
- `PILOT_CHECKLIST.md`: the step-by-step list for the pilot day (3 to 5 golfers).
- `VENDOR_VERIFICATION.md`: what must be checked before any clip goes to Roboflow or Gemini.
- `EVAL_REPORT_TEMPLATE.md`: how the clips and labels turn into metrics.
- `CADDIE_V2_AUDIT.md` §8: the evaluation plan this protocol puts into practice.

---

## 1. Scope

- **Full swings only:** driver, a hybrid, a mid iron (6 to 8). No chipping, pitching, or putting. (A fairway wood can stand in for the hybrid; import it as `--club wood` and note it.)
- **Two supported camera angles:** face-on and down-the-line. A small, deliberate set of **unsuitable** angles tests that Caddie refuses or says "inconclusive".
- **Golfers:** Micky and consenting adult (18+) friends only, mixed skill levels. Never clips from existing GolfMe users.
- **Size:** about **76 clips**, starting with a **local pilot of 3 to 5 golfers** (about 8 core clips each; section 4; Micky's decision 2026-10-21, replacing the 10-clip pilot).
- **Purpose:** measure the current Caddie (V1) and the V2 modules against coach labels. Not for training a model.
- **Time limit:** raw clips are kept **at most 90 days** from each contributor's consent date. Sign consent on the filming day (not earlier) so the clock starts then, and plan so coach labeling and scoring finish well inside 90 days: aim to have both coaches' labels within **6 weeks** of filming.

## 2. Equipment

- An iPhone (or any phone) that records 30 fps and, if possible, 60 and 240 fps slow motion.
- A phone tripod with a clamp, about 1 m to 1.5 m tall.
- A few range balls or a mat, so the club has a real ball to hit.
- A printed or on-screen session log (section 6).
- Printed or digital copies of the blank consent form (`consent/CONSENT_FORM_v1.pdf`), one per person who will appear in frame, plus a copy for them to keep.
- **Before the session: turn off iCloud Photos (or any photo cloud backup) on the filming phone,** or film on a phone without it. Otherwise every clip is uploaded to Apple's cloud automatically, which this process forbids. Move clips to the laptop by USB cable or AirDrop, then delete them from the phone and from "Recently Deleted". See `VIDEO_IMPORT_AND_CONSENT.md` §4.

## 3. Camera setup

Hold the phone in **portrait**, because that's how GolfMe users film. Use the default 1x lens (no ultra-wide: it bends the body at the edges).

### Face-on

- The camera faces the golfer's chest, **square to the target line** (the line from ball to target).
- **Distance:** about 3 m to 4 m from the ball.
- **Height:** about hand height at address (roughly the golfer's belt to chest).
- **Aim:** center the golfer. The whole body, the club at the top of the backswing, and the ball must all stay in frame.
- **Leave space:** don't zoom so tight that the club leaves the frame at the top or the finish.

### Down-the-line

- The camera sits **behind the golfer's hands, on a line parallel to the target line**, pointing at the target.
- **Distance:** about 3 m to 4 m behind the golfer.
- **Height:** about hand height at address.
- **Aim:** the golfer's hands and the ball line up near the vertical middle of the frame. The full body and club stay in frame throughout.

### Tripod vs a friend filming

- **Tripod:** set it up once, check one test clip, don't touch it between swings.
- **Friend filming (handheld):** they stand where the tripod would be, hold the phone with both hands at chest height, and **don't follow the ball** or zoom. Some shake is fine and wanted: real users film like this.

### Recording each clip

- Start recording **at least 2 s before** the golfer sets up at address. Stop **at least 1 s after** the finish.
- Keep each clip at **10 s or less** (Caddie's current limit). Record a small extra set of 10 s to 15 s clips for the 15 s evaluation ("Video length" in the audit's decisions list).
- **One swing per clip.** No practice swings in the clip, except the deliberate "no swing" case.
- **Nobody else in frame** unless they have also signed consent (the deliberate "second person" case).

## 4. What to film: the shot matrix

The import tool turns each clip's labels into a **slot code**, e.g. `FO-DR-TRI-RH-DAY` = face-on, driver, tripod, right-handed, daylight. The table lists target counts per group. These are **targets, not results**. Total: **76 clips**, of which **13 left-handed (17 %)**.

| Group | Angle | Club | Mount | Light | Target clips | Of which left-handed | Why |
|---|---|---|---|---|---|---|---|
| A. Core | face-on, DTL | driver, hybrid, iron | tripod | daylight | 5 per angle per club = **30** | 1 per angle per club = **6** | Clean baseline for every metric |
| B. Handheld | face-on, DTL | driver, hybrid, iron | handheld | daylight | 2 per angle per club = **12** | **2** (one per angle) | How real users film |
| C. Light | face-on, DTL | rotate driver, hybrid, iron | tripod | backlit; overcast or dusk; indoor net | 2 per angle per light = **12** | **2** | Pose confidence in bad light |
| D. Slow motion | face-on, DTL | driver | tripod | daylight | 2 per angle at 240 fps + 2 per angle at 60 fps = **8** | **2** (60 fps, one per angle) | Frame-rate effects |
| E. Trouble cases | see below | any | any | any | 1 to 2 each = **14** | **1** | The gate and angle classifier must say "inconclusive" |
| **Total** | | | | | **76** | **13 (17 %)** | |

Group E, each tagged with `--condition` at import:

- `behind_angle`: camera straight behind the golfer (back to camera).
- `steep_angle`: phone held high, looking down.
- `partial_body`: feet or club head cut off.
- `second_person`: a consenting second person walks or stands in frame.
- `no_swing`: waggle and setup only, no swing.
- `short_clip`: under 2 s, starting mid-backswing.
- `baggy_clothing`: hoodie or loose rain jacket.
- `occlusion`: a bag, cart, or net post hides part of the body.
- `camera_shake`: deliberately shaky handheld.
- A 45-degree "between" angle is imported with `--angle unsuitable` and no condition tag needed.

### Spread across golfers

- **At least 3 contributors**, and **no single contributor more than 50 %** of the clips, so results aren't one person's swing.
- **Skill mix** (self-reported at import with `--skill`, coaches give their own estimate): beginner, mid, and advanced all represented; aim for **each at 15 % or more** of clips where practical.
- **Left-handed at 15 to 20 %** (target 13 of 76) where practical. This needs at least one left-handed contributor who consents. `node tools/caddie-eval/import-clip.mjs status` shows `leftHandedShare`. If no left-handed golfer is available, film those slots right-handed and report left-handed metrics as **"not measured"**. Never count mirrored right-handed clips as left-handed coverage (a mirrored copy may be used as a separate, clearly labeled synthetic check only).
- Mix clothing colors and backgrounds (range mat, grass, net).

### Pilot first (3 to 5 golfers)

Before the full set, film a **local pilot with 3 to 5 consenting golfers** (at least one left-handed if available): per golfer 2 swings each of face-on driver, face-on iron, down-the-line driver, down-the-line iron (8 core clips; hybrid optional), plus 3 trouble clips of Micky. Run it end to end: consent, import, `verify`, local pose, K00 key-frame labels, `pilot-report.mjs`, coach labeling (both passes, both coaches if recruited by then). Fix the process, then film the rest. The step-by-step list for the day is `PILOT_CHECKLIST.md`. Pilot clips count toward the 76 only if the process didn't change in a way that affects them (same form version, same labeling sheet, same camera setup rules).

## 5. Handedness

- Record handedness at import (`--handedness right|left`). Coaches also label it.
- For left-handed golfers the camera positions mirror: face-on still faces the chest; down-the-line still sits behind the hands on the target line.

## 6. Session log (scratch sheet, deleted after import)

Keep one row per clip while filming so the import labels are right. The sheet uses **contributor IDs, never names**. Keep it with the clips on the laptop, and delete it once every clip is imported (the manifest replaces it).

| Session | Date | Contributor | Phone file | Slot code | Conditions | fps | Note (no names) |
|---|---|---|---|---|---|---|---|
| S01 | YYYY-MM-DD | C001 | IMG_0412.MOV | FO-DR-TRI-RH-DAY | | 30 | |

**Location:** write the setting only ("range", "course", "indoor net"), never an address or course name.

## 7. Naming

Don't rename files by hand. The import tool assigns `C001-0001`, `C001-0002`, ... and never stores the phone's file name. Everything else (angle, club, mount, light, conditions, fps) lives in the manifest. Coaches, labels, and reports refer to clips **only by clip ID**.

## 8. Coaches and what they label

### Plan: two coaches, not yet recruited

- **Two qualified golf coaches:** `K01` **in person** and `K02` **remote** if feasible. If no remote coach is feasible, both in person.
- **Status: neither is recruited yet.** Until two are, there is no inter-rater agreement for phases or faults; with one coach, the report says so and validates no threshold.
- Each coach labels **independently**: they don't see each other's labels or discuss specific clips until both have locked pass 1 and pass 2.
- Both do pass 1 (phases, faults, main improvement) and pass 2 (review of the analysis output). **In the pilot, pass 2 rates the local prototype** (section "Pass 2 in the pilot" below), because no V1 output can be produced.
- Coaches are identified only by pseudonymous IDs (`K01`, `K02`). They hold the `coach_reviewer` role in GolfMe (audit §8.2), but labeling happens **outside the app**, on a sheet keyed by clip ID and coach ID, for Milestone 1.
- **Which clips they may see:** only those listed by `coach-session-check` for that coach on that day (in person, or `--remote`; `VIDEO_IMPORT_AND_CONSENT.md` §7). The remote method is **live Google Meet screen-share with no recording** (Micky, 2026-10-20; `COACH_REVIEW_PROCEDURE.md` §3 to §4). No file or cloud sharing.

### Coach recruitment and qualification checklist

For each candidate, Micky confirms and records (in the identity key, not the repo):

1. **Qualification:** a current recognized teaching credential (e.g. PGA, LPGA, or a national golf federation's coaching certification) or documented experience coaching full swings. Micky sets the bar before asking anyone and applies the same bar to both.
2. **Video experience:** comfortable judging face-on **and** down-the-line video, and with frame-by-frame review.
3. **Independence:** not a contributor in the set (or never labels their own swing), and no stake in the result.
4. **Time:** agrees to the workload, roughly 76 clips × (about 5 min pass 1 + 2 min pass 2) plus about 10 % re-labels, **within 6 weeks** of filming (the 90-day retention limit).
5. **Rules accepted** (a short written note they reply "I agree" to; wording not drafted yet): blind labels before seeing Caddie output; the fixed fault list; no screen recording, photos, or copies of clips; delete anything on request (withdrawal); clips and contributors stay confidential; identified only by a coach ID in reports.
6. **Remote coach only:** a setup that works for the chosen method (stable video call and a large screen for screen-share, or a safe place for an encrypted drive and a way to return it).
7. **Payment or thanks:** decided by Micky up front (any fee is spend and needs his approval).
8. **Calibration** before labeling starts: both coaches go through the definitions in this section using **Micky's own practice clips that aren't in the eval set**, agree the fixed fault list and the kappa cut-off (section 9), then label alone. Calibration aligns definitions, not answers.
9. **Coach ID assigned** (`K01`, `K02`), and the `coach_reviewer` role granted if not already held.

### Pass 1: blind labels (before seeing any Caddie output)

| Field | Values | Notes |
|---|---|---|
| `clip_id` | `C001-0001` | |
| `coach_id` | `K01` | |
| `camera_angle` | `face_on` / `down_the_line` / `unsuitable` | If unsuitable, a short reason |
| `handedness` | `right` / `left` | |
| `analyzable` | `yes` / `no` | Full body visible, one real full swing, suitable angle. Drives the quality-gate metric |
| `t_address` | seconds, 3 decimals, or `cant_tell` | Last still moment before the club starts back |
| `t_top` | seconds or `cant_tell` | Moment the **club head** changes direction at the end of the backswing |
| `t_impact` | seconds or `cant_tell` | Frame closest to club-ball contact |
| `t_finish` | seconds or `cant_tell` | First moment of a held, balanced finish. If never held, the last frame of the follow-through |
| `fault_<name>` | `yes` / `no` / `cant_tell_from_angle` | One column per fault in the fixed list below |
| `main_improvement` | one fault name, or `none` | The single most useful thing to work on |
| `main_improvement_reason` | free text, no names | |
| `drill` | drill name or free text | |
| `skill_estimate` | `beginner` / `mid` / `advanced` | |
| `confidence` | `high` / `medium` / `low` | The coach's own confidence in this clip's labels |

**Timing:** use a player that steps **one frame at a time** and shows time (QuickTime Player with arrow keys, or VLC's frame step). Phone gallery scrubbers aren't precise enough. The harness converts seconds to frames with the clip's fps.

**Fixed fault list** (draft; coaches may propose changes before labeling starts, never during):

- `early_extension`: hips move toward the ball in the downswing.
- `sway`: lateral hip slide away from the target in the backswing.
- `loss_of_posture`: spine angle rises or drops noticeably before impact.
- `over_the_top`: the club moves outside the hands' path starting down. DTL only.
- `reverse_pivot`: weight moves toward the target in the backswing.
- `chicken_wing`: lead arm folds through impact.
- `poor_finish_balance`: can't hold the finish.

Some faults can't be seen from one angle. `cant_tell_from_angle` is the right answer there, not a guess.

### Key-frame keypoints (subset)

On a subset of clips, Micky (as `K00`, PROTOTYPE labels; in the pilot at least one face-on and one down-the-line clip per golfer) or a coach marks the 13 body points on the address, top, impact, and finish frames. K00's definitions, visibility codes, and correction rules: `KEYFRAME_ANNOTATION_GUIDE.md`. Use the rules in `scripts/extract-golf-training-frames/ANNOTATION_GUIDE.md`, including **"not visible" when a point is hidden**. Guessing hidden points spoils the abstention metric.

K00 labels live in versioned files `annotations/<clip ID>-K00.vNNN.json` made with `tools/caddie-eval/keyframes.mjs` (decided 2026-10-21: `K00`, recorded with `annotator-add`, not `coach-add`). A coach's keypoints go in the clip's label file as `keyframe_keypoints` (format in the header of `tools/caddie-eval/pose-accuracy.mjs`), golfer's anatomical left/right. `pose-accuracy.mjs` and `pilot-report.mjs` score the local pose against either (`EVAL_REPORT_TEMPLATE.md` §5); K00-based numbers are always marked prototype.

### Pass 2: rate Caddie's output (V1, later; not in the pilot)

Only after pass 1 is locked, coaches see Caddie's result for each clip and rate:

- `rating_main_improvement`: `correct` / `partly` / `wrong` / `harmful`.
- `rating_drill`: same scale.
- `false_faults`: any fault Caddie claimed that the coach says isn't there.
- `rating_note`: free text, no names.

`harmful` means following the advice would likely make the swing worse or risk injury. Every `harmful` rating is listed by clip ID in the report.

### Pass 2 in the pilot: rate the local prototype

Micky's decision (2026-10-20): pass 2 runs in the pilot, on the **local prototype** (`MEDIAPIPE_POC.md`), never on hand-written or invented feedback.

1. **Blind first.** Each coach annotates the original clips in pass 1 without any prototype output. Pass 2 starts only after that coach's pass-1 labels are saved and `verify` passes.
2. **Shown per clip:** the pose overlay video and the gate/angle summary (`COACH_REVIEW_PROCEDURE.md` §5.1). Nothing else.
3. **Rated**, six items, one field each in the clip's label file. The sheet must make clear what the prototype actually does. Today it only produces body landmarks (plus the quality gate and a camera-angle guess), so five of the six items are pre-filled **"not implemented, not rated"**:

| # | Item | Field | Prototype today | Allowed values |
|---|---|---|---|---|
| 1 | Swing-phase identification accuracy | `p2_phase_rating` | **Not implemented** | `not_implemented` only |
| 2 | Body landmark reliability (overlay) | `p2_landmark_rating` | **Implemented** | `reliable` / `mostly_reliable` / `unreliable` / `cant_tell`; plus `p2_landmark_problem_phases` (free text, e.g. "downswing wrists", no names) |
| 3 | Accuracy of observable swing measurements | `p2_measurement_rating` | **Not implemented** | `not_implemented` only |
| 4 | Correctness of identified faults | `p2_fault_rating` | **Not implemented** | `not_implemented` only |
| 5 | Usefulness of coaching explanations | `p2_explanation_rating` | **Not implemented** | `not_implemented` only |
| 6 | Safety and practicality of suggested drills | `p2_drill_rating` | **Not implemented** | `not_implemented` only |

Also required with any pass-2 field: `p2_prototype` (e.g. `mediapipe-full`), and optional `p2_note` (free text, no names). `verify` refuses a rating for an item the prototype doesn't produce (`PROTOTYPE_CAPABILITIES` in `tools/caddie-eval/import-clip.mjs`). When a capability ships, its entry changes in the same commit, and only then can that item be rated.

The quality-gate and camera-angle results are **scored automatically** against the coach's pass-1 `analyzable` and `camera_angle` (`EVAL_REPORT_TEMPLATE.md` §3, §6), so coaches don't rate them separately.

### Micky's usability pass

Micky rates clarity, tone, and "would I act on this" (1 to 5 each). He does **not** judge coaching correctness.

## 9. Inter-rater agreement

Coach labels are only ground truth if coaches agree with each other.

- **Overlap:** both coaches label **every clip** they're allowed to see. If coach time is short, at least **30 %** of clips are double-labeled, chosen at random across groups.
- **Self-consistency:** each coach re-labels about **10 %** of their clips at least a week later, without seeing their first labels.
- **How agreement is computed** (in the report, section 2):
  - Camera angle, handedness, `analyzable`, each fault: **Cohen's kappa** for two coaches (Fleiss' kappa for three or more). `cant_tell` counts as its own category; its rate is reported separately.
  - Phase times: **mean absolute difference in milliseconds** per phase, and share of double-labeled clips within ±67 ms (2 frames at 30 fps).
  - Main improvement: **percent exact agreement**.
- **Disagreement is tracked, not resolved.** A clip where the coaches disagree on a field is marked **ambiguous for that field**, and both labels are kept. There is **no forced consensus**: no tie-break, no discussion to settle a clip, no averaging of categorical labels. Ambiguous clips are scored separately, never silently dropped. Every disagreement is listed in the report by clip ID, field, and each coach's answer.
- **Scoring against two coaches:** headline metrics use only fields where both coaches agree ("agreed truth"). Each metric is also reported against **each coach separately**, so a reader can see whether Caddie sides with one coach. For phase times, agreed truth is the mean of the two coaches' times only when they're within ±67 ms of each other; otherwise the clip is ambiguous for that phase.
- **When labels are too unreliable:** if a field's kappa is below a cut-off agreed with the coaches **before** labeling starts (a starting proposal is 0.6, itself a placeholder), metrics using that field are reported as "labels not reliable enough" and no threshold may be validated from them.

## 10. Session checklist

1. Consent form v1.1 signed and dated **on the day**, and recorded (`consent-add --form-version 1.1 --signed yes ...`) for every person who will appear in frame. Adults (18+) only.
2. iCloud Photos (or other photo cloud backup) off on the filming phone.
3. Tripod position checked with one test clip; full body and club visible at the top and finish.
4. Session log open; contributor IDs only.
5. Film the planned slots, then the trouble cases.
6. Transfer by cable or AirDrop to the laptop. Import each clip (`import`), then `verify`.
7. Delete the clips from the phone and "Recently Deleted", and delete the session log.
8. Check `status`: left-handed share, skill mix, and per-slot counts against section 4.
9. Put each contributor's retention date in a calendar; run `retention` weekly.

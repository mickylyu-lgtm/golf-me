# Caddie V2: swing-video testing protocol

Status: **draft for Micky's review, 2026-10-20.** Nothing here has been run yet. Every count below is a **target to collect**, not a result.

Related:

- `VIDEO_IMPORT_AND_CONSENT.md`: consent, import, storage, withdrawal, retention. **Read it before filming anyone.**
- `EVAL_REPORT_TEMPLATE.md`: how the clips and labels turn into metrics.
- `CADDIE_V2_AUDIT.md` §8: the evaluation plan this protocol puts into practice.

---

## 1. Scope

- **Full swings only:** driver, a fairway wood or hybrid, a mid iron (6 to 8). No chipping, pitching, or putting.
- **Two supported camera angles:** face-on and down-the-line. A small, deliberate set of **unsuitable** angles tests that Caddie refuses or says "inconclusive".
- **Golfers:** Micky and consenting adult friends only, beginner to mid-handicap first. Never clips from existing GolfMe users.
- **Purpose:** measure the current Caddie (V1) and the V2 modules against coach labels. Not for training a model.

## 2. Equipment

- An iPhone (or any phone) that records 30 fps and, if possible, 60 and 240 fps slow motion.
- A phone tripod with a clamp, about 1 m to 1.5 m tall.
- A few range balls or a mat, so the club has a real ball to hit.
- A printed or on-screen session log (section 6).
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

The import tool turns each clip's labels into a **slot code**, e.g. `FO-DR-TRI-RH-DAY` = face-on, driver, tripod, right-handed, daylight. The table lists target counts per group. These are **targets, not results**. Totals land in the audit's proposed 60 to 100 clips.

| Group | Angle | Club | Mount | Light | Target clips | Why |
|---|---|---|---|---|---|---|
| A. Core | face-on, DTL | driver, wood/hybrid, iron | tripod | daylight | 4 per angle per club = **24** | Clean baseline for every metric |
| B. Handheld | face-on, DTL | driver, wood/hybrid, iron | handheld | daylight | 2 per angle per club = **12** | How real users film |
| C. Light | face-on, DTL | any (rotate) | tripod | backlit, overcast or dusk, indoor net | 2 per angle per light = **12** | Pose confidence in bad light |
| D. Left-handed | face-on, DTL | driver, iron | tripod | daylight | 2 per angle per club = **8** | Handedness handling. Only if a left-handed contributor consents |
| E. Slow motion | face-on, DTL | driver | tripod | daylight | 2 per angle = **4** at 240 fps, **4** at 60 fps | Frame rate effects |
| F. Trouble cases | see below | any | any | any | 1 to 2 each = **about 12** | The gate and angle classifier must say "inconclusive" |

Group F, each tagged with `--condition` at import:

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

Spread across golfers:

- **At least 3 contributors**, mixing beginner and mid-handicap (self-reported).
- **No single contributor more than 50 %** of the clips, so results aren't one person's swing.
- Mix clothing colors and backgrounds (range mat, grass, net).

### Pilot first

Before the full set, film a **pilot of about 10 clips** (one contributor, groups A and F). Run them through import, labeling, and the report template end to end. Fix the process, then film the rest.

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

## 8. What coaches label

Coaches are identified only by pseudonymous IDs (`K01`, `K02`, ...). They must hold the `coach_reviewer` role in GolfMe (audit §8.2), but labeling happens **outside the app**, on a sheet, for Milestone 1.

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

On about 20 clips, coaches (or Micky, since this is geometry, not coaching) mark the 13 body points on the address, top, and impact frames. Use the rules in `scripts/extract-golf-training-frames/ANNOTATION_GUIDE.md`, including **"not visible" when a point is hidden**. Guessing hidden points spoils the abstention metric.

### Pass 2: rate Caddie's output

Only after pass 1 is locked, coaches see Caddie's result for each clip and rate:

- `rating_main_improvement`: `correct` / `partly` / `wrong` / `harmful`.
- `rating_drill`: same scale.
- `false_faults`: any fault Caddie claimed that the coach says isn't there.
- `rating_note`: free text, no names.

`harmful` means following the advice would likely make the swing worse or risk injury. Every `harmful` rating is listed by clip ID in the report.

### Micky's usability pass

Micky rates clarity, tone, and "would I act on this" (1 to 5 each). He does **not** judge coaching correctness.

## 9. Inter-rater agreement

Coach labels are only ground truth if coaches agree with each other.

- **Overlap:** two coaches label every clip if possible. If coach time is short, at least **30 %** of clips are double-labeled, chosen at random across groups.
- **Self-consistency:** each coach re-labels about **10 %** of their clips at least a week later, without seeing their first labels.
- **How agreement is computed** (in the report, section 2):
  - Camera angle, handedness, `analyzable`, each fault: **Cohen's kappa** for two coaches (Fleiss' kappa for three or more). `cant_tell` counts as its own category; its rate is reported separately.
  - Phase times: **mean absolute difference in milliseconds** per phase, and share of double-labeled clips within ±67 ms (2 frames at 30 fps).
  - Main improvement: **percent exact agreement**.
- **Disagreement:** a clip where coaches disagree on a field is marked **ambiguous for that field**. Ambiguous clips are scored separately, never silently dropped. A third coach, or a short discussion between the two, may produce a consensus label; the report says which clips were settled that way.
- **When labels are too unreliable:** if a field's kappa is below a cut-off agreed with the coaches **before** labeling starts (a starting proposal is 0.6, itself a placeholder), metrics using that field are reported as "labels not reliable enough" and no threshold may be validated from them.

## 10. Session checklist

1. Consent signed and recorded (`consent-add`) for every person who will appear in frame.
2. iCloud Photos (or other photo cloud backup) off on the filming phone.
3. Tripod position checked with one test clip; full body and club visible at the top and finish.
4. Session log open; contributor IDs only.
5. Film the planned slots, then the trouble cases.
6. Transfer by cable or AirDrop to the laptop. Import each clip (`import`), then `verify`.
7. Delete the clips from the phone and "Recently Deleted", and delete the session log.

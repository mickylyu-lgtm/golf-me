# Caddie V2: key-frame annotation guide (K00, guide version 1.0)

Status: **2026-10-21. Tools built and tested on synthetic data; no real clip labeled yet.**

> **These are PROTOTYPE labels, not validated ground truth.** One person (Micky, `K00`) marks body points so the local pose source can be measured during the pilot. Nobody checks them independently, and they encode one person's reading of each frame. Every file says `"label_status": "prototype_not_validated"`, and every report that uses them says so. They can show where MediaPipe clearly fails. They can't validate a threshold, and they're never quoted as accuracy against ground truth. Coach labels (`K01`, `K02`) stay the reference for coaching fields.

Related: `TESTING_PROTOCOL.md` §8 (phase definitions, shared with the coach sheet), `scripts/extract-golf-training-frames/ANNOTATION_GUIDE.md` (the original point rules this follows), `EVAL_REPORT_TEMPLATE.md` §4a, §5 (where the numbers go), `tools/caddie-eval/lib/annotations.mjs` (the validator).

## 1. Who K00 is, and why not `coach-add`

`K00` is Micky's annotator ID (Micky's decision, 2026-10-21). It's recorded once with its own record type:

```
node tools/caddie-eval/import-clip.mjs annotator-add --annotator K00
```

This writes `annotators/K00.json` in the data folder: ID, role `owner_prototype_annotator`, scope `keyframe_keypoints`, label status, date. No name. It is **not** a coach record, on purpose:

- `coach-add` records a signed **coach confidentiality agreement** and clears the coach for sessions. Micky signs no such agreement (he runs the study and already holds the data), so a coach record would claim something false.
- A coach record would let K00 pass `coach-session-check` and count as a coach in inter-rater agreement. K00 must never do either. `coach-add` now refuses `K00`.
- Scope is narrower: K00 labels **geometry only** (13 body points on 4 key frames). No faults, phases for coaching, ratings, or drills.

## 2. The 13 points

The same 13 as the pose contract (`src/lib/caddie/v2/types.ts`), with the definitions from the original `ANNOTATION_GUIDE.md`:

| Point | Where to click |
|---|---|
| `nose` | Tip of the nose if visible. If only the back or side of the head shows, the centre of the visible head mass, not a guessed nose behind it (then use `occluded`) |
| `left_shoulder`, `right_shoulder` | The bony point of the shoulder (acromion), where the arm visibly pivots, not the shirt's edge |
| `left_elbow`, `right_elbow` | The outer point of the elbow joint at its bend |
| `left_wrist`, `right_wrist` | The centre of the wrist joint, between the base of the hand and the forearm. With a glove or overlapping grip, the centre of the wrist crease |
| `left_hip`, `right_hip` | The bony point of the hip (greater trochanter), usually the widest point of the hip in fitted clothing |
| `left_knee`, `right_knee` | Centre of the knee joint |
| `left_ankle`, `right_ankle` | Centre of the ankle joint, at the leg and foot junction |

**Left and right are the golfer's own sides, never screen sides.** The left shoulder is the golfer's left shoulder whichever way they face, whether they're right- or left-handed, face-on or down-the-line. For a right-handed golfer the left side is the lead side (towards the target). The page colours left points cyan and right points orange, like the overlay. If unsure, work it out from the feet and knees, not from which hand is lower on the grip.

**Known mismatch:** MediaPipe's own hip and shoulder landmarks were trained on its own convention, which may sit a little off these anatomical points (the hip especially). A small, consistent offset is a label-convention effect, not a model error. It shows up as lower PCK@0.1 with normal PCK@0.2.

## 3. The 4 key frames

Same definitions as the coach sheet (`TESTING_PROTOCOL.md` §8), so the numbers line up. Pick the **single exported frame** that best matches; the page shows frame numbers and times.

| Key frame | Definition | If it can't be labeled |
|---|---|---|
| `address` | The last still frame before the club starts back | `not_in_clip` if the clip starts after the takeaway |
| `top` | The frame where the **club head** changes direction at the end of the backswing | `cant_tell` if the club is hidden or blurred so the turn can't be placed within a few frames |
| `impact` | The frame closest to club-ball contact | `cant_tell` if contact falls between frames and neither is clearly closer; `not_in_clip` for a no-swing clip |
| `finish` | The first frame of a held, balanced finish. If never held, the last frame of the follow-through | `not_in_clip` if the clip ends before it |

They must be in order (address before top before impact before finish). Each key frame gets its status: `labeled`, `not_in_clip`, or `cant_tell`. A `labeled` key frame needs all 13 points.

## 4. Visibility codes (every point gets one)

| Code | Key | Meaning | Position |
|---|---|---|---|
| `visible` | V | Clearly seen; you can put the joint centre within a few pixels | Required |
| `occluded` | O | Partly hidden (behind the body, the club, baggy clothing), but you can reason where it is from what is visible: the limb's direction, the other joints | Required: your best estimate |
| `not_visible` | N | Can't be located even by reasoning: fully hidden, or blurred beyond use | **None.** Don't place a point |
| `out_of_frame` | X | Outside the picture | **None** |

The rule from the original guide stands: **never place a point you can't reason about.** A guessed position spoils the abstention metric. When unsure between `occluded` and `not_visible`, choose `not_visible`.

How each code is scored (`pose-accuracy.mjs`): `visible` points are the only ones in PCK; `occluded` points are reported in their own columns (how often the model is confident there, and how close); `not_visible` and `out_of_frame` test **honest abstention** (the model should not be confident). Torso length for normalising uses the shoulder and hip points, `visible` or `occluded`; frames that used an estimate are counted.

## 5. Corrections

Labels are **append-only versions**: `annotations/<clip ID>-K00.v001.json`, `.v002.json`, and so on, in the data folder. A version is never overwritten (the file is created with the exclusive flag). To correct one, reopen the clip in the labeling page, fix it, choose a **reason**, and save. That writes the next version with:

```
"correction": { "reason": "misplaced_point" | "wrong_frame" | "visibility_code" | "left_right_swap" | "guide_change" | "other",
                "note": "<at most 200 characters, required for other, no names>",
                "date": "YYYY-MM-DD", "supersedes_version": <previous> }
```

The scorer and the report always use the **latest valid version**. `verify` checks the whole chain: versions 1, 2, 3 with no gaps, each valid, each correction dated no earlier than what it corrects. A broken chain is reported, never silently skipped. `node tools/caddie-eval/keyframes.mjs list --clip <ID>` shows the history.

Correct when you find a real error (a misplaced point, a wrong frame, a wrong code, a left/right swap), or when this guide changes (`guide_change`). Don't re-label just because the model disagrees: the page never shows model output, and labels should stay blind to it.

## 6. Workflow (per clip)

1. `node tools/caddie-eval/keyframes.mjs export --clip C001-0001`. Writes every analysis frame as a JPEG into `derived/C001-0001/frames/` on the **same timeline as the pose run** (same fps cap and long-side cap), so frame N here is frame N there. From the stored local clip only; deleted with the clip by `withdraw` and `retention`.
2. `node tools/caddie-eval/keyframes.mjs label --clip C001-0001`. Prints a `http://127.0.0.1:<port>/?t=<token>` address. Open it in a **private (InPrivate/Incognito) browser window** on the same computer. From WSL, Windows' browser reaches it through WSL's localhost forwarding (on by default; **not yet tested on Micky's laptop**, so try `keyframes.mjs demo` first).
3. For each key frame: step to it (arrow keys, Shift for 10), press its button and "use this frame", then go through the 13 points: click to place (`visible`), or press O and click (`occluded`), N, or X. Set `not_in_clip` / `cant_tell` where needed.
4. Save. The server validates everything and refuses with a list of problems if anything is missing or inconsistent. Press **Done** to stop the server.

The page: served only on 127.0.0.1; every request needs the per-session token; a Host check blocks DNS-rebinding; no external resources (CSP `'self'`); nothing in browser storage, no downloads, no clipboard; frames sent with `Cache-Control: no-store`. It shows the frames and your own points, never MediaPipe output.

Practice first, with no real data: `node tools/caddie-eval/keyframes.mjs demo` (a synthetic test pattern in a temp folder, deleted when you stop). The pattern has no person, so practise the clicks and the save, not the anatomy.

## 7. Which clips

At least one face-on and one down-the-line clip per golfer, all four key frames where possible. More if time allows; label them all before looking at any report. For timing: about 13 points x 4 frames per clip; expect roughly 10 to 15 minutes per clip (estimate, not measured).

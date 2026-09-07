# GolfMe Swing Model v2 — Annotation Guide

For labeling the frames this folder's `extract-golf-training-frames` script
selects. Read this before labeling anything — the single most important rule
is at the top, not buried at the bottom.

## The critical rule: never guess

**If you cannot confidently see exactly where a point is, mark it
unavailable/not-visible (per Roboflow's own keypoint-annotation convention
for a skipped/occluded point) — do not place it where you *think* it
probably is.**

This is the whole reason v2 exists. The current production model has no way
to say "I can't see this" at the label level, so it was trained to always
guess — a hidden wrist during a hands-crossed-over-the-body moment gets a
confident-looking position anyway, and that fabricated position quietly
produces a wrong joint angle downstream (`src/lib/swingAssessment.ts`
computes real angles from whatever keypoints it's given, and has no way to
know one of them was actually a guess). A model trained on honest
"unavailable" labels for genuinely occluded points learns to output *low
confidence* for those points instead of a confident wrong answer — which is
exactly what lets the existing confidence-threshold logic
(`MIN_KEYPOINT_CONFIDENCE` in `swingAssessment.ts`, and the server-side
`ROBOFLOW_MIN_SUCCESS_RATIO` in `analyze-swing`) work as intended instead of
silently passing bad data through.

When in doubt, don't guess. A dataset with more honest "unavailable" labels
is more valuable than one with more confident-looking wrong ones.

## Body keypoints

Same 13 landmarks the current production model already tracks (COCO-style),
so v2 stays a drop-in upgrade for everything already built on this shape
(`src/lib/swingAssessment.ts`'s geometry, the skeleton overlay in
`CaddieSwingReplay.tsx`).

| Keypoint | Exact location |
|---|---|
| Nose / head center | Tip of the nose if visible face-on; if only the back/side of the head is visible, the center of the visible head mass — not an estimated nose position behind it. |
| Left / right shoulder | The bony point of the shoulder (acromion) — where the arm visibly pivots, not the fabric edge of a shirt sleeve. |
| Left / right elbow | The outer point of the elbow joint at its visible bend. |
| Left / right wrist | The center of the wrist joint, between the base of the hand and the forearm. |
| Left / right hip | The bony point of the hip (greater trochanter) — usually visible as the widest point of the hip when clothing is fitted; estimate conservatively (see "partial occlusion" below) under baggy clothing. |
| Left / right knee | Center of the visible knee joint. |
| Left / right ankle | Center of the visible ankle joint, at the leg/foot junction. |

**Left/right is the golfer's own left/right, not screen-left/screen-right.**
For a down-the-line shot of a right-handed golfer, their "left shoulder" may
be the one closer to the camera — label by anatomy, not by which side of the
frame it happens to be on. A club-swinging arm doesn't reliably tell you
handedness either (some golfers are photographed mid-lesson holding a club
opposite their normal hand) — infer left/right from the body itself (which
foot/knee/hip is anatomically left), not from which hand holds the club.

## Golf-specific keypoints

| Keypoint | Exact location | Notes |
|---|---|---|
| Grip / hands center | Midpoint between both hands where they hold the grip, NOT the butt-end of the club. | Use this as the single hand point unless left/right hands are separately, reliably distinguishable (see below). |
| Club shaft midpoint | The visual midpoint of the straight shaft segment between the grip and the clubhead — not the midpoint of the whole club including the head. | For a heavily bent/blurred shaft, place it at the midpoint of whatever straight segment is actually visible, and lower your own confidence call (mark it, but flag borderline cases per your labeling tool's confidence/review flag if it has one). |
| Club head | Center of the clubhead's visible mass (driver head, iron face, wedge — whatever club is in use), not the leading edge or the ball-contact point specifically. | The ball is a separate object, not part of this keypoint, even at the moment of impact. |

### Optional: separate left/right hand points

Only label separate left-hand / right-hand points (instead of one grip
center) where they are **individually, confidently** identifiable as two
distinct visible points — most commonly at Address and early
takeaway, before the hands overlap into one grip silhouette. The instant they
visually merge into a single mass (which is most of the swing, for most grip
styles), switch back to the single grip-center point rather than guessing
two separate positions inside one blob. Decide per-project, based on an early
labeling batch, whether separate hands are reliable enough across enough
frames to be worth keeping as their own keypoints at all — if most frames end
up single-point anyway, simplify the schema down to grip-center only rather
than carrying two rarely-populated fields.

## Occlusion rules (apply to every keypoint above)

- **Fully visible** — label normally, as precisely as you can.
- **Partially occluded** (e.g., a hip mostly hidden by a loose jacket, a
  wrist half-behind the torso) — label your best-confidence estimate of the
  joint's *actual* anatomical position, reasoning from what IS visible
  (the visible portion of the limb, its trajectory) — this is still a real
  estimate of a real point, not a guess about a point you can't reason about
  at all. If you genuinely can't tell even with that reasoning, treat it as
  fully occluded instead (below) rather than forcing a low-confidence guess.
- **Fully occluded** (a wrist entirely hidden behind the body during a
  cross-over moment, a club fully hidden behind the golfer during
  down-the-line backswing) — **mark unavailable**. Do not place a point.
  This is the case the critical rule above exists for.
- **Out of frame** — same as fully occluded: mark unavailable, don't
  extrapolate a position outside the visible image.

## Camera-angle-specific notes

- **Face-on**: both shoulders/hips/knees usually visible but foreshortened;
  the trail-side (far side) elbow/wrist are the ones most likely to need a
  partial/full-occlusion call during the backswing.
  - **Down-the-line**: body joints mostly stack near-vertically and overlap
  more (a real challenge for this angle specifically); the club is often
  clearer here at the top of the swing, but can disappear entirely behind
  the body during transition — a common genuinely-unavailable case, not a
  labeling mistake.

## Club-model scoping note

Whether club keypoints end up in the *same* Roboflow project as the body
keypoints or a *separate* one is an open engineering decision (see the
tradeoffs write-up already discussed for this project) — label according to
whichever your current Roboflow project schema defines. The anatomical rules
above hold either way.

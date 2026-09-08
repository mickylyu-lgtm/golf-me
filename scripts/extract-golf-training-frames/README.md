# extract-golf-training-frames

Offline, local-only tool for building the GolfMe Swing Model v2 training
dataset. Picks a small, diverse set of frames from each source swing video,
tracks everything in a persistent manifest, and groups videos into
sessions/diversity-groups so a later train/val/test split can avoid leakage
— never every frame, never part of the live app (this doesn't touch
`supabase/functions/analyze-swing`, `api/extract-frames.ts`, or any
production upload path), and **no automatic Roboflow upload** (that's a
deliberate later phase, not yet built).

## Usage

Default, no flags — scans `~/Desktop/training_data/raw_videos` (including
subfolders) for videos not already in the manifest, writes selected frames to
`~/Desktop/training_data/selected_frames`, and updates
`~/Desktop/training_data/dataset-manifest.json`:

```
npx tsx scripts/extract-golf-training-frames/index.ts
```

Run it again any time you drop new videos into `raw_videos/` — it's always
safe to re-run over the whole folder. Videos already recorded in the manifest
(by content hash, not filename) are skipped entirely; exact-duplicate videos
(same content, re-exported/re-downloaded under a different name) are
detected and skipped too.

Override the defaults if you need to (e.g. for a test run against a scratch
folder):

- `--input` / `--output` — source video folder / selected-frames output folder.
- `--manifest` — path to the persistent JSON manifest.
- `--session-metadata` — path to the optional manual session-tagging file.
- `--session-overrides` — path to the optional manual session-grouping override file.
- `--fps 10` — how densely to sample *candidate* frames before selecting from
  them.
- `--min-frames 10` / `--max-frames 25` — how many frames to keep per video.
- `--min-gap-seconds 0.15` — minimum time between any two selected frames.

## What you get

```
selected_frames/
  my-swing-01/
    manifest.json          <- per-video: which frames, timestamps, scores (legacy format, kept for backward compat)
    frame_01_0.00s.jpg
    frame_02_0.34s.jpg
    ...

dataset-manifest.json      <- the source of truth: every video ever seen, its
                               hash, session id, duration, per-frame
                               diagnostics, and processing status
session-metadata.json      <- optional, hand-edited: handedness/camera
                               angle/lighting/notes per session id
session-overrides.json     <- optional, hand-edited: force a specific
                               video -> session id mapping
```

Nothing here ever deletes or overwrites frames/annotations already on disk.

## How selection works

1. **Active-window trim** — the same `freezedetect`-based technique already
   used in production's `api/extract-frames.ts` finds the real swing motion
   and skips idle stance-before / walk-off-after time.
2. **Dense candidate sampling** — extracts frames across that window at
   `--fps` into a scratch folder (never written to `--output` directly).
3. **Difference scoring** — each candidate gets a cheap "how much changed
   since the last frame" score (a small 24×24 grayscale thumbnail, mean
   absolute pixel difference via `sharp`).
4. **Diversity fill** — always keeps the first candidate (an Address anchor)
   and the last (a Finish anchor), then greedily fills most of the frame
   budget by descending difference score, skipping anything within
   `--min-gap-seconds` of an already-picked frame.
5. **Hard-example fill** — reserves the rest of the budget (~20%, min 2
   frames) for the *blurriest* remaining candidates (lowest
   variance-of-Laplacian, a classic no-reference blur metric), so genuinely
   hard frames survive into the dataset instead of being selected past in
   favor of easier, sharper neighbors. See `diagnostics.ts` for what this
   can and can't detect — it's pixel statistics, not a pose/object model, so
   it can flag "this frame is blurry/dark/low-contrast" but NOT "the club is
   behind the golfer's body" or "hands are overlapping." Use
   `session-metadata.json` to hand-tag things pixel stats can't see.

## Session/diversity-group identification

Every video gets a `sessionId` (in `dataset-manifest.json`), re-derived from
the **whole** manifest on every run — automatic, filename+timestamp-based
heuristic clustering (see `sessions.ts` for the full reasoning): videos are
grouped if they share a normalized filename "source signature" (which
app/device produced them) and land within `SESSION_GAP_HOURS` (4h) of each
other. The heuristic is deliberately biased toward **merging** when
uncertain — treating one real filming session as two separate groups is the
dangerous failure mode (it would let a later train/val/test split treat
clips from the same golfer/camera/lighting as independent diversity), while
over-merging two genuinely different sessions just makes the split slightly
more conservative than strictly necessary. If the heuristic gets a real
session wrong, fix it explicitly in `session-overrides.json` rather than
tuning the threshold.

## Next steps (outside this script)

This only prepares candidate images — it doesn't label anything, and it
doesn't touch Roboflow at all yet. After running it:

1. Review each video's selected frames; discard any that are truly
   unusable (motion blur so severe nothing is identifiable, golfer entirely
   out of frame, etc.) — a handful of hard-but-labelable frames are exactly
   what the dataset wants, a handful of *unlabelable* ones aren't.
2. Optionally fill in `session-metadata.json` (handedness, camera angle,
   lighting, notes) for sessions where that context is known.
3. When ready to label, upload the keepers to your Roboflow project(s) using
   `ANNOTATION_GUIDE.md` in this same folder — this is still a manual step;
   automatic upload is a deliberate future phase, not yet approved/built.
4. When you eventually split train/val/test, split by `sessionId` from
   `dataset-manifest.json`, never by individual frame — that's the whole
   point of tracking it.

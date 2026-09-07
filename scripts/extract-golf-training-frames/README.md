# extract-golf-training-frames

Offline tool for building the GolfMe Swing Model v2 training dataset. Picks a
small, diverse set of frames from each source swing video, ready for you to
upload and label in Roboflow — never every frame, and never part of the live
app (this doesn't touch `supabase/functions/analyze-swing`, `api/extract-frames.ts`,
or any production upload path; it's a standalone local script you run against
your own footage).

## Usage

```
npx tsx scripts/extract-golf-training-frames/index.ts \
  --input ./raw-swings \
  --output ./training-frames
```

- `--input` — a folder of source swing video files (`.mov`, `.mp4`, `.m4v`, `.avi`, `.mkv`).
- `--output` — where selected frames get written, one subfolder per video.

Optional tuning flags (defaults shown):

- `--fps 10` — how densely to sample *candidate* frames before selecting from
  them. Higher catches faster motion more precisely but costs more time per
  video; rarely worth going above ~15 for a swing that's only a few seconds long.
- `--min-frames 10` / `--max-frames 25` — how many frames to keep per video.
  The tool will relax the spacing rule below to hit `--min-frames` if a clip
  is very short or low-motion, but will never exceed `--max-frames`.
- `--min-gap-seconds 0.15` — minimum time between any two selected frames,
  so near-duplicates a couple of frames apart are never both kept. If a
  video's candidates barely differ in score (a smooth, evenly-paced swing),
  raising this — or lowering `--max-frames` — makes the selection noticeably
  more concentrated on the highest-motion moments instead of near-uniform
  spacing; see "How selection works" below for why.

## What you get

```
training-frames/
  manifest.json                 <- batch summary (video count, total frames)
  my-swing-01/
    manifest.json                <- per-video: which frames, timestamps, scores
    frame_01_0.00s.jpg
    frame_02_0.34s.jpg
    ...
```

Run it again against a new batch of videos any time — each run is
independent per video, so you can build the dataset up incrementally without
re-processing footage you've already extracted from. Track progress toward
the ~2,000–5,000 frame / ~100–300 video target via the top-level
`manifest.json`'s `totalFramesSelected`.

## How selection works

1. **Active-window trim** — the same `freezedetect`-based technique already
   used in production's `api/extract-frames.ts` finds the real swing motion
   and skips idle stance-before / walk-off-after time, so candidates are only
   ever drawn from the actual swing.
2. **Dense candidate sampling** — extracts frames across that window at
   `--fps` into a scratch folder (not written to `--output` directly).
3. **Difference scoring** — each candidate gets a cheap "how much changed
   since the last frame" score (a small 24×24 grayscale thumbnail, mean
   absolute pixel difference via `sharp`). No pose model, no Roboflow call,
   no cost — this is pure image comparison.
4. **Diverse selection** — always keeps the first candidate (an Address
   anchor) and the last (a Finish anchor), then greedily fills the rest by
   descending difference score, skipping anything within `--min-gap-seconds`
   of an already-picked frame. The fast-moving downswing/impact stretch
   naturally scores higher than a held stance or a paused top-of-backswing,
   so picks cluster there rather than spreading evenly by default — *unless*
   you're asking for close to as many frames as there are candidates, in
   which case there's little room to be selective (see the tuning note above).

## Next steps (outside this script)

This only prepares candidate images — it doesn't label anything. After
running it:

1. Review each video's selected frames; discard any that are truly
   unusable (motion blur so severe nothing is identifiable, golfer entirely
   out of frame, etc.) — a handful of hard-but-labelable frames are exactly
   what the dataset wants, a handful of *unlabelable* ones aren't.
2. Upload the keepers to your Roboflow project and label them using
   `ANNOTATION_GUIDE.md` in this same folder.
3. Keep every frame from one source video in the same train/val/test split
   when you get there (see the project brief's Phase 7) — this script's
   per-video folder structure already keeps that grouping obvious.

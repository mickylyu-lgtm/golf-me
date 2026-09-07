// Offline dataset-building tool for GolfMe Swing Model v2 (see
// scripts/extract-golf-training-frames/README.md). Selects a small, diverse
// set of frames per source swing video for human labeling in Roboflow --
// deliberately NOT every frame, and deliberately NOT part of the live app:
// this never touches supabase/functions/analyze-swing, api/extract-frames.ts,
// or any production upload path. Run manually, locally, against a folder of
// your own swing videos:
//
//   npx tsx scripts/extract-golf-training-frames/index.ts \
//     --input ./raw-swings --output ./training-frames
//
// Algorithm (per video):
//   1. Detect the real "active" (motion) window the same way
//      api/extract-frames.ts already does for production (ffmpeg
//      freezedetect) -- skips idle stance-before/walk-off-after time so
//      candidates are only ever drawn from the actual swing.
//   2. Extract dense CANDIDATE frames across that window at --fps (default
//      10) -- these are scratch files, never written to --output directly.
//   3. Score each candidate's visual difference from the previous one
//      (small grayscale thumbnail, mean absolute pixel difference via
//      sharp) -- a cheap proxy for "how much changed," so the fast-moving
//      downswing/impact stretch naturally scores higher than a held
//      Address stance or a paused Top of backswing.
//   4. Greedily select up to --max-frames, always forcing the very first
//      candidate (an Address anchor) and very last (a Finish anchor),
//      enforcing --min-gap-seconds between any two picks so near-duplicate
//      frames a few frames apart are never both chosen, then filling the
//      rest by descending difference score -- naturally spreads picks
//      across backswing/top/downswing/impact/follow-through without any
//      phase-detection model, exactly the "timestamp spacing + frame
//      difference" combination the project brief asked for.
//   5. Writes the selected frames as JPEGs to
//      <output>/<video-basename>/frame_NN_<timestamp>s.jpg, plus a
//      per-video manifest.json (timestamps + scores, for later bookkeeping
//      and for a labeler to sanity-check what got picked and why).
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
// Same cast-at-the-boundary reasoning as api/extract-frames.ts -- ffmpeg-
// static's own .d.ts resolves to a namespace object under this project's
// tsconfig, not the plain string its runtime export actually is.
import ffmpegPathImport from "ffmpeg-static";

const ffmpegPath = ffmpegPathImport as unknown as string;

const VIDEO_EXTENSIONS = new Set([".mov", ".mp4", ".m4v", ".avi", ".mkv"]);
const DEFAULT_CANDIDATE_FPS = 10;
const DEFAULT_MIN_FRAMES = 10;
const DEFAULT_MAX_FRAMES = 25;
const DEFAULT_MIN_GAP_SECONDS = 0.15;
const THUMBNAIL_SIZE = 24; // small on purpose -- this only needs to capture "how much moved," not fine detail

// Same freezedetect-based trimming as api/extract-frames.ts (a deliberate,
// independent copy -- this script must never import from api/ or
// supabase/functions, which are production code with their own deploy
// targets and secrets). See that file's own comments for why freezedetect
// specifically: a single cheap decode-only ffmpeg pass, no Roboflow/Gemini
// cost, conservative (any ambiguous result falls back to the whole clip
// rather than risking cutting off a real Address or Follow-through).
const FREEZE_NOISE = "0.001";
const FREEZE_MIN_DURATION_SECONDS = 0.5;
const ACTIVE_WINDOW_BUFFER_SECONDS = 0.75;
const MIN_ACTIVE_WINDOW_SECONDS = 1.5;

interface Args {
  input: string;
  output: string;
  fps: number;
  minFrames: number;
  maxFrames: number;
  minGapSeconds: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const input = get("--input");
  const output = get("--output");
  if (!input || !output) {
    console.error("Usage: npx tsx scripts/extract-golf-training-frames/index.ts --input <dir> --output <dir> [--fps 10] [--min-frames 10] [--max-frames 25] [--min-gap-seconds 0.15]");
    process.exit(1);
  }
  return {
    input,
    output,
    fps: Number(get("--fps") ?? DEFAULT_CANDIDATE_FPS),
    minFrames: Number(get("--min-frames") ?? DEFAULT_MIN_FRAMES),
    maxFrames: Number(get("--max-frames") ?? DEFAULT_MAX_FRAMES),
    minGapSeconds: Number(get("--min-gap-seconds") ?? DEFAULT_MIN_GAP_SECONDS),
  };
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static did not resolve a binary path"));
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

function parseDurationSeconds(ffmpegLog: string): number | undefined {
  const m = ffmpegLog.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

interface ActiveWindow {
  startSeconds: number;
  endSeconds: number;
}

async function detectActiveWindow(inputPath: string): Promise<ActiveWindow | undefined> {
  const log = await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-vf",
    `freezedetect=n=${FREEZE_NOISE}:d=${FREEZE_MIN_DURATION_SECONDS}`,
    "-map",
    "0:v",
    "-f",
    "null",
    "-",
  ]);
  const duration = parseDurationSeconds(log);
  if (!duration || duration <= 0) return undefined;

  const starts = [...log.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  if (starts.length === 0) return undefined;

  const freezeIntervals: ActiveWindow[] = starts.map((start, i) => ({
    startSeconds: start,
    endSeconds: i < ends.length ? ends[i] : duration,
  }));
  const sorted = [...freezeIntervals].sort((a, b) => a.startSeconds - b.startSeconds);
  const gaps: ActiveWindow[] = [];
  let cursor = 0;
  for (const interval of sorted) {
    if (interval.startSeconds > cursor) gaps.push({ startSeconds: cursor, endSeconds: interval.startSeconds });
    cursor = Math.max(cursor, interval.endSeconds);
  }
  if (cursor < duration) gaps.push({ startSeconds: cursor, endSeconds: duration });
  if (gaps.length === 0) return undefined;

  const longest = gaps.reduce((a, b) => (b.endSeconds - b.startSeconds > a.endSeconds - a.startSeconds ? b : a));
  if (longest.endSeconds - longest.startSeconds < MIN_ACTIVE_WINDOW_SECONDS) return undefined;

  const paddedStart = Math.max(0, longest.startSeconds - ACTIVE_WINDOW_BUFFER_SECONDS);
  const paddedEnd = Math.min(duration, longest.endSeconds + ACTIVE_WINDOW_BUFFER_SECONDS);
  if (paddedStart <= 0.05 && paddedEnd >= duration - 0.05) return undefined;
  return { startSeconds: paddedStart, endSeconds: paddedEnd };
}

interface Candidate {
  path: string;
  timestampSeconds: number;
  diffScore: number; // mean absolute grayscale pixel difference vs the previous candidate, 0-255
}

async function scoreCandidates(files: { path: string; timestampSeconds: number }[]): Promise<Candidate[]> {
  const thumbs: Buffer[] = [];
  for (const f of files) {
    const buf = await sharp(f.path).resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "fill" }).grayscale().raw().toBuffer();
    thumbs.push(buf);
  }
  return files.map((f, i) => {
    if (i === 0) return { ...f, diffScore: Infinity }; // first candidate always "maximally different" -- guarantees it's eligible as the Address anchor
    let sum = 0;
    const a = thumbs[i - 1];
    const b = thumbs[i];
    for (let p = 0; p < a.length; p++) sum += Math.abs(a[p] - b[p]);
    return { ...f, diffScore: sum / a.length };
  });
}

// Forces the first and last candidates in (Address/Finish anchors), then
// greedily fills the rest by descending diffScore, skipping any candidate
// within minGapSeconds of an already-selected one -- naturally spreads
// picks across the swing instead of clustering around whichever single
// moment has the single highest score.
function selectDiverseFrames(candidates: Candidate[], minFrames: number, maxFrames: number, minGapSeconds: number): Candidate[] {
  if (candidates.length === 0) return [];
  const selected: Candidate[] = [candidates[0]];
  if (candidates.length > 1) selected.push(candidates[candidates.length - 1]);

  const isFarEnough = (t: number) => selected.every((s) => Math.abs(s.timestampSeconds - t) >= minGapSeconds);
  const ranked = [...candidates]
    .filter((c) => c !== candidates[0] && c !== candidates[candidates.length - 1])
    .sort((a, b) => b.diffScore - a.diffScore);

  for (const c of ranked) {
    if (selected.length >= maxFrames) break;
    if (!isFarEnough(c.timestampSeconds)) continue;
    selected.push(c);
  }
  // Relax the gap constraint only if we're still short of the minimum --
  // a very short/low-motion clip shouldn't silently produce too few frames
  // to be useful for labeling.
  if (selected.length < minFrames) {
    for (const c of ranked) {
      if (selected.length >= minFrames) break;
      if (selected.includes(c)) continue;
      selected.push(c);
    }
  }
  return selected.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

async function processVideo(videoPath: string, outputRoot: string, args: Args): Promise<{ name: string; selected: number; candidates: number }> {
  const name = path.basename(videoPath, path.extname(videoPath));
  const scratchDir = await mkdtemp(path.join(tmpdir(), "golf-frames-"));
  try {
    const activeWindow = await detectActiveWindow(videoPath).catch((err) => {
      console.error(`  [${name}] active-window detection failed, using the whole clip`, err instanceof Error ? err.message : err);
      return undefined;
    });

    const extractArgs = ["-y", "-i", videoPath];
    if (activeWindow) {
      extractArgs.push("-ss", activeWindow.startSeconds.toFixed(3), "-t", (activeWindow.endSeconds - activeWindow.startSeconds).toFixed(3));
    }
    extractArgs.push("-vf", `fps=${args.fps}`, "-q:v", "2", path.join(scratchDir, "candidate_%05d.jpg"));
    await runFfmpeg(extractArgs);

    const frameStartOffset = activeWindow?.startSeconds ?? 0;
    const files = (await readdir(scratchDir)).filter((f) => f.startsWith("candidate_")).sort();
    if (files.length === 0) {
      console.warn(`  [${name}] no candidate frames extracted -- skipping`);
      return { name, selected: 0, candidates: 0 };
    }

    const candidateMeta = files.map((f, i) => ({ path: path.join(scratchDir, f), timestampSeconds: Number((frameStartOffset + i / args.fps).toFixed(3)) }));
    const scored = await scoreCandidates(candidateMeta);
    const chosen = selectDiverseFrames(scored, args.minFrames, args.maxFrames, args.minGapSeconds);

    const videoOutDir = path.join(outputRoot, name);
    await mkdir(videoOutDir, { recursive: true });
    const manifestEntries: { file: string; timestampSeconds: number; diffScore: number }[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const c = chosen[i];
      const outName = `frame_${String(i + 1).padStart(2, "0")}_${c.timestampSeconds.toFixed(2)}s.jpg`;
      await writeFile(path.join(videoOutDir, outName), await readFile(c.path));
      manifestEntries.push({ file: outName, timestampSeconds: c.timestampSeconds, diffScore: Number.isFinite(c.diffScore) ? Math.round(c.diffScore * 100) / 100 : null! });
    }
    await writeFile(
      path.join(videoOutDir, "manifest.json"),
      JSON.stringify(
        {
          sourceVideo: path.basename(videoPath),
          activeWindow: activeWindow ?? null,
          candidateCount: scored.length,
          candidateFps: args.fps,
          selectedCount: chosen.length,
          frames: manifestEntries,
        },
        null,
        2,
      ),
    );
    console.log(`  [${name}] ${scored.length} candidates -> ${chosen.length} selected`);
    return { name, selected: chosen.length, candidates: scored.length };
  } finally {
    await rm(scratchDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const allFiles = await readdir(args.input);
  const videos = allFiles.filter((f) => VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase()));
  if (videos.length === 0) {
    console.error(`No video files found in ${args.input} (looked for: ${[...VIDEO_EXTENSIONS].join(", ")})`);
    process.exit(1);
  }
  await mkdir(args.output, { recursive: true });
  console.log(`Found ${videos.length} video(s). Extracting up to ${args.maxFrames} frames each (min ${args.minFrames})...`);

  const results = [];
  for (const video of videos) {
    console.log(`Processing ${video}...`);
    results.push(await processVideo(path.join(args.input, video), args.output, args));
  }

  const totalSelected = results.reduce((sum, r) => sum + r.selected, 0);
  await writeFile(
    path.join(args.output, "manifest.json"),
    JSON.stringify({ videoCount: videos.length, totalFramesSelected: totalSelected, perVideo: results }, null, 2),
  );
  console.log(`\nDone. ${totalSelected} frames selected across ${videos.length} video(s) -> ${args.output}`);
  console.log(`(Target for the whole v1 dataset: ~2,000-5,000 frames from ~100-300 videos -- run this against each new batch of source videos and check the running total in ${args.output}/manifest.json.)`);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

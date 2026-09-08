// Offline dataset-building tool for GolfMe Swing Model v2 (see
// scripts/extract-golf-training-frames/README.md). Selects a small, diverse
// set of frames per source swing video for human labeling in Roboflow --
// deliberately NOT every frame, and deliberately NOT part of the live app:
// this never touches supabase/functions/analyze-swing, api/extract-frames.ts,
// or any production upload path.
//
// Default (no flags) usage -- scans ~/Desktop/training_data/raw_videos
// (including subfolders) for videos not yet in the persistent manifest,
// writes selected frames to ~/Desktop/training_data/selected_frames, and
// updates ~/Desktop/training_data/dataset-manifest.json:
//
//   npx tsx scripts/extract-golf-training-frames/index.ts
//
// Run again any time you drop new videos into raw_videos/ -- already-known
// videos (by content hash) are skipped, so this is always safe to re-run
// over the whole folder rather than tracking "what's new" yourself.
//
// Pipeline per new video:
//   1. Exact-duplicate check via SHA-256 file hash (hash.ts) against every
//      video already recorded in the manifest -- re-uploads/re-exports of a
//      clip you've already processed are skipped entirely, no re-extraction.
//   2. Detect the real "active" (motion) window the same way
//      api/extract-frames.ts already does for production (ffmpeg
//      freezedetect) -- skips idle stance-before/walk-off-after time.
//   3. Extract dense CANDIDATE frames across that window at --fps (default
//      10) into a scratch dir -- never written to --output directly.
//   4. Score + select frames (selection.ts): a diversity-driven greedy pass
//      (frame-to-frame visual difference, anchored at first/last) plus a
//      reserved hard-example quota (blurriest remaining candidates), so the
//      dataset doesn't skew toward only the easy, static-looking frames.
//   5. Compute brightness/contrast/blur diagnostics per selected frame
//      (diagnostics.ts, pure pixel stats via sharp -- no model).
//   6. Assign a session/diversity-group id (sessions.ts) -- an automatic
//      heuristic based on filename source pattern + timestamp clustering,
//      re-derived across the WHOLE manifest every run (so adding new videos
//      can correct earlier grouping). Session ids are what a later
//      train/val/test split must group by to avoid leakage -- never split
//      individual frames from the same session across sets.
//   7. Write selected frames + a per-video manifest.json to
//      <output>/<video>/, and update the persistent top-level manifest.
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeImageDiagnostics } from "./diagnostics.ts";
import { detectActiveWindow, extractCandidateFrames, type ActiveWindow } from "./ffmpeg.ts";
import { type DatasetManifest, type FrameRecord, loadManifest, saveManifest, type VideoRecord } from "./manifest.ts";
import {
  DEFAULT_MANIFEST_PATH,
  DEFAULT_RAW_VIDEOS_DIR,
  DEFAULT_SELECTED_FRAMES_DIR,
  DEFAULT_SESSION_METADATA_PATH,
  DEFAULT_SESSION_OVERRIDES_PATH,
} from "./paths.ts";
import { hashFile } from "./hash.ts";
import { assignSessions, ensureSessionMetadataStubs, loadSessionOverrides, parseFilenameTimestamp, type VideoTimestamp } from "./sessions.ts";
import { scoreCandidates, selectDiverseFrames } from "./selection.ts";

const VIDEO_EXTENSIONS = new Set([".mov", ".mp4", ".m4v", ".avi", ".mkv"]);
const DEFAULT_CANDIDATE_FPS = 10;
const DEFAULT_MIN_FRAMES = 10;
const DEFAULT_MAX_FRAMES = 25;
const DEFAULT_MIN_GAP_SECONDS = 0.15;

interface Args {
  input: string;
  output: string;
  manifestPath: string;
  sessionMetadataPath: string;
  sessionOverridesPath: string;
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
  return {
    input: get("--input") ?? DEFAULT_RAW_VIDEOS_DIR,
    output: get("--output") ?? DEFAULT_SELECTED_FRAMES_DIR,
    manifestPath: get("--manifest") ?? DEFAULT_MANIFEST_PATH,
    sessionMetadataPath: get("--session-metadata") ?? DEFAULT_SESSION_METADATA_PATH,
    sessionOverridesPath: get("--session-overrides") ?? DEFAULT_SESSION_OVERRIDES_PATH,
    fps: Number(get("--fps") ?? DEFAULT_CANDIDATE_FPS),
    minFrames: Number(get("--min-frames") ?? DEFAULT_MIN_FRAMES),
    maxFrames: Number(get("--max-frames") ?? DEFAULT_MAX_FRAMES),
    minGapSeconds: Number(get("--min-gap-seconds") ?? DEFAULT_MIN_GAP_SECONDS),
  };
}

interface DiscoveredVideo {
  key: string; // path relative to the raw_videos root, e.g. "batch_02/foo.mp4" or "foo.mp4"
  absPath: string;
  filename: string;
  mtimeMs: number;
}

async function discoverVideos(root: string, subdir = ""): Promise<DiscoveredVideo[]> {
  const dirAbs = path.join(root, subdir);
  let entries;
  try {
    entries = await readdir(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: DiscoveredVideo[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relPath = subdir ? path.join(subdir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      results.push(...(await discoverVideos(root, relPath)));
    } else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const absPath = path.join(root, relPath);
      const st = await stat(absPath);
      results.push({ key: relPath, absPath, filename: entry.name, mtimeMs: st.mtimeMs });
    }
  }
  return results;
}

// Top-level loose files keep their original bare output-folder name (backward
// compatible with the ~20 videos already processed before this rewrite);
// files inside a subfolder get the subfolder baked into the name so two
// videos with the same basename in different subfolders can't collide.
function outputFolderName(key: string): string {
  const dir = path.dirname(key);
  const base = path.basename(key, path.extname(key));
  return dir === "." ? base : `${dir.split(path.sep).join("__")}__${base}`;
}

function baseRecord(d: { key: string; filename: string }, timestampMs: number, timestampSource: "filename" | "mtime", hash: string, fps: number, overrides: Partial<VideoRecord>): VideoRecord {
  const frames = overrides.frames ?? [];
  return {
    key: d.key,
    filename: d.filename,
    hash,
    sessionId: null,
    timestampMs,
    timestampSource,
    durationSeconds: null,
    extractedAt: new Date().toISOString(),
    candidateFrameCount: 0,
    candidateFps: fps,
    activeWindow: null,
    duplicateOf: null,
    status: "failed",
    errorMessage: null,
    ...overrides,
    frames,
    selectedFrameCount: frames.length,
  };
}

async function processVideo(d: DiscoveredVideo, hash: string, timestampMs: number, timestampSource: "filename" | "mtime", outputRoot: string, args: Args): Promise<VideoRecord> {
  const scratchDir = await mkdtemp(path.join(tmpdir(), "golf-frames-"));
  let durationSeconds: number | undefined;
  let activeWindow: ActiveWindow | undefined;
  try {
    const detected = await detectActiveWindow(d.absPath).catch((err) => {
      console.error(`  [${d.key}] active-window detection failed, using the whole clip:`, err instanceof Error ? err.message : err);
      return { durationSeconds: undefined, activeWindow: undefined };
    });
    durationSeconds = detected.durationSeconds;
    activeWindow = detected.activeWindow;

    const frameStartOffset = activeWindow?.startSeconds ?? 0;
    const files = await extractCandidateFrames(d.absPath, scratchDir, args.fps, activeWindow);
    if (files.length === 0) {
      console.warn(`  [${d.key}] no candidate frames extracted -- skipping`);
      return baseRecord(d, timestampMs, timestampSource, hash, args.fps, {
        status: "no-candidate-frames",
        durationSeconds: durationSeconds ?? null,
        activeWindow: activeWindow ?? null,
      });
    }

    const candidateMeta = files.map((f, i) => ({ path: path.join(scratchDir, f), timestampSeconds: Number((frameStartOffset + i / args.fps).toFixed(3)) }));
    const scored = await scoreCandidates(candidateMeta);
    const chosen = selectDiverseFrames(scored, args.minFrames, args.maxFrames, args.minGapSeconds);

    const outDir = path.join(outputRoot, outputFolderName(d.key));
    await mkdir(outDir, { recursive: true });
    const frames: FrameRecord[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const { candidate, reason } = chosen[i];
      const outName = `frame_${String(i + 1).padStart(2, "0")}_${candidate.timestampSeconds.toFixed(2)}s.jpg`;
      await writeFile(path.join(outDir, outName), await readFile(candidate.path));
      frames.push({
        file: outName,
        timestampSeconds: candidate.timestampSeconds,
        diffScore: Number.isFinite(candidate.diffScore) ? Math.round(candidate.diffScore * 100) / 100 : null,
        brightnessMean: candidate.diagnostics.brightnessMean,
        contrastStdDev: candidate.diagnostics.contrastStdDev,
        blurVariance: candidate.diagnostics.blurVariance,
        diagnosticFlags: candidate.diagnostics.flags,
        selectionReason: reason,
      });
    }
    await writeFile(
      path.join(outDir, "manifest.json"),
      JSON.stringify(
        {
          sourceVideo: d.filename,
          key: d.key,
          activeWindow: activeWindow ?? null,
          candidateCount: scored.length,
          candidateFps: args.fps,
          selectedCount: chosen.length,
          frames,
        },
        null,
        2,
      ),
    );
    console.log(`  [${d.key}] ${scored.length} candidates -> ${chosen.length} selected`);
    return baseRecord(d, timestampMs, timestampSource, hash, args.fps, {
      status: "processed",
      durationSeconds: durationSeconds ?? null,
      activeWindow: activeWindow ?? null,
      candidateFrameCount: scored.length,
      frames,
    });
  } catch (err) {
    console.error(`  [${d.key}] extraction failed:`, err instanceof Error ? err.message : err);
    return baseRecord(d, timestampMs, timestampSource, hash, args.fps, {
      status: "failed",
      durationSeconds: durationSeconds ?? null,
      activeWindow: activeWindow ?? null,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await rm(scratchDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Adopts frames a pre-existing (pre-manifest) run of this script already
// selected, without re-running ffmpeg or touching the frame files on disk --
// covers the ~20 videos processed before this rewrite. Only runs the first
// time a given video is seen; every subsequent run just re-reads the
// manifest record like any other already-processed video.
async function backfillVideo(d: DiscoveredVideo, hash: string, timestampMs: number, timestampSource: "filename" | "mtime", outDir: string, args: Args): Promise<VideoRecord> {
  const old = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"));
  const oldFrames: { file: string; timestampSeconds: number; diffScore: number | null }[] = old.frames ?? [];
  const frames: FrameRecord[] = [];
  for (let i = 0; i < oldFrames.length; i++) {
    const f = oldFrames[i];
    let diag;
    try {
      diag = await computeImageDiagnostics(path.join(outDir, f.file));
    } catch (err) {
      console.warn(`  [${d.key}] diagnostics failed for backfilled frame ${f.file}:`, err instanceof Error ? err.message : err);
      diag = { brightnessMean: 0, contrastStdDev: 0, blurVariance: 0, flags: ["diagnostic-failed"] };
    }
    frames.push({
      file: f.file,
      timestampSeconds: f.timestampSeconds,
      diffScore: f.diffScore ?? null,
      brightnessMean: diag.brightnessMean,
      contrastStdDev: diag.contrastStdDev,
      blurVariance: diag.blurVariance,
      diagnosticFlags: diag.flags,
      // The pre-manifest format didn't record why a frame was picked --
      // best-effort reconstruction: first/last are the anchors, everything
      // else was the old pure-diversity greedy fill.
      selectionReason: i === 0 ? "anchor-start" : i === oldFrames.length - 1 ? "anchor-end" : "diversity",
    });
  }
  console.log(`  [${d.key}] adopted ${frames.length} pre-existing selected frame(s) from before this pipeline rewrite`);
  return baseRecord(d, timestampMs, timestampSource, hash, old.candidateFps ?? args.fps, {
    status: "processed-backfill",
    durationSeconds: null,
    activeWindow: old.activeWindow ?? null,
    candidateFrameCount: old.candidateCount ?? frames.length,
    frames,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.input, { recursive: true });
  await mkdir(args.output, { recursive: true });

  const manifest: DatasetManifest = await loadManifest(args.manifestPath);
  const discovered = await discoverVideos(args.input);

  if (discovered.length === 0) {
    console.log(`No video files found in ${args.input} (looked for: ${[...VIDEO_EXTENSIONS].join(", ")}).`);
  } else {
    console.log(`Found ${discovered.length} video(s) under ${args.input}. Checking against the manifest...`);
  }

  // hash -> key, for exact-duplicate detection. Seeded from every video the
  // manifest already considers real (processed or adopted via backfill) so
  // a duplicate of something from a PAST run is caught too, not just
  // duplicates within this run's batch.
  const hashToKey = new Map<string, string>();
  for (const [key, v] of Object.entries(manifest.videos)) {
    if (v.hash && (v.status === "processed" || v.status === "processed-backfill")) hashToKey.set(v.hash, key);
  }

  let processedCount = 0;
  let backfilledCount = 0;
  let duplicateCount = 0;
  let failedCount = 0;
  let unchangedCount = 0;

  for (const d of [...discovered].sort((a, b) => a.key.localeCompare(b.key))) {
    const existing = manifest.videos[d.key];
    const hash = await hashFile(d.absPath);
    const timestampMs = parseFilenameTimestamp(d.filename) ?? d.mtimeMs;
    const timestampSource: "filename" | "mtime" = parseFilenameTimestamp(d.filename) !== undefined ? "filename" : "mtime";

    if (existing && existing.hash === hash && (existing.status === "processed" || existing.status === "processed-backfill" || existing.status === "skipped-duplicate")) {
      unchangedCount++;
      continue;
    }

    const duplicateOfKey = hashToKey.get(hash);
    if (duplicateOfKey && duplicateOfKey !== d.key) {
      console.log(`  [${d.key}] exact duplicate of already-processed "${duplicateOfKey}" -- skipping extraction`);
      manifest.videos[d.key] = baseRecord(d, timestampMs, timestampSource, hash, args.fps, {
        status: "skipped-duplicate",
        duplicateOf: duplicateOfKey,
      });
      duplicateCount++;
      continue;
    }

    const outDir = path.join(args.output, outputFolderName(d.key));
    const preExistingManifest = !existing && (await stat(path.join(outDir, "manifest.json")).catch(() => null));

    let record: VideoRecord;
    if (preExistingManifest) {
      record = await backfillVideo(d, hash, timestampMs, timestampSource, outDir, args);
      backfilledCount++;
    } else {
      console.log(`Processing ${d.key}...`);
      record = await processVideo(d, hash, timestampMs, timestampSource, args.output, args);
      if (record.status === "processed") processedCount++;
      else failedCount++;
    }
    manifest.videos[d.key] = record;
    if (record.hash && (record.status === "processed" || record.status === "processed-backfill")) hashToKey.set(record.hash, d.key);
  }

  // Re-derive session grouping across the WHOLE manifest (not just this
  // run's videos) every run -- adding new footage can legitimately change
  // where a gap-based cluster boundary falls for older videos too, and this
  // is cheap (no ffmpeg/sharp work, just filenames + timestamps).
  const overrides = await loadSessionOverrides(args.sessionOverridesPath);
  const allVideoTimestamps: VideoTimestamp[] = Object.values(manifest.videos).map((v) => ({
    key: v.key,
    filename: v.filename,
    timestampMs: v.timestampMs,
    timestampSource: v.timestampSource,
  }));
  const assignments = assignSessions(allVideoTimestamps, overrides);
  for (const { key, sessionId } of assignments) {
    if (manifest.videos[key]) manifest.videos[key].sessionId = sessionId;
  }
  const sessionIds = [...new Set(assignments.map((a) => a.sessionId))].sort();
  await ensureSessionMetadataStubs(args.sessionMetadataPath, sessionIds);

  await saveManifest(args.manifestPath, manifest);

  // Summary.
  const allRecords = Object.values(manifest.videos);
  const totalSelected = allRecords.reduce((sum, v) => sum + v.selectedFrameCount, 0);
  const sessionCounts = new Map<string, number>();
  for (const v of allRecords) {
    if (!v.sessionId) continue;
    sessionCounts.set(v.sessionId, (sessionCounts.get(v.sessionId) ?? 0) + 1);
  }
  const flagCounts = new Map<string, number>();
  for (const v of allRecords) {
    for (const f of v.frames) {
      for (const flag of f.diagnosticFlags) flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
    }
  }

  console.log(`\nThis run: ${processedCount} processed, ${backfilledCount} adopted from pre-existing output, ${duplicateCount} duplicate(s) skipped, ${unchangedCount} unchanged, ${failedCount} failed.`);
  console.log(`Manifest totals: ${allRecords.length} video(s) tracked, ${totalSelected} selected frame(s), ${sessionCounts.size} session(s)/diversity group(s).`);
  console.log("Videos per session:");
  for (const [id, count] of [...sessionCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${id}: ${count} video(s)`);
  if (flagCounts.size > 0) {
    console.log("Diagnostic flags across all selected frames (not exclusions, just visibility):");
    for (const [flag, count] of [...flagCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${flag}: ${count} frame(s)`);
  }
  const failedRecords = allRecords.filter((v) => v.status === "failed" || v.status === "no-candidate-frames");
  if (failedRecords.length > 0) {
    console.log("Videos needing attention:");
    for (const v of failedRecords) console.log(`  ${v.key}: ${v.status}${v.errorMessage ? ` -- ${v.errorMessage}` : ""}`);
  }
  console.log(`\nManifest: ${args.manifestPath}`);
  console.log(`Session metadata (optional manual tagging -- handedness/camera angle/lighting/notes): ${args.sessionMetadataPath}`);
  console.log(`Session overrides (optional manual correction of the automatic grouping): ${args.sessionOverridesPath}`);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

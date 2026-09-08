// ffmpeg helpers -- a deliberate, independent copy of the same
// freezedetect-based active-window trimming api/extract-frames.ts uses in
// production. This file must never import from api/ or supabase/functions
// (production code, its own deploy targets/secrets); this script is
// standalone and local-only.
import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
// Same cast-at-the-boundary reasoning as api/extract-frames.ts --
// ffmpeg-static's own .d.ts resolves to a namespace object under this
// project's tsconfig, not the plain string its runtime export actually is.
import ffmpegPathImport from "ffmpeg-static";

const ffmpegPath = ffmpegPathImport as unknown as string;

const FREEZE_NOISE = "0.001";
const FREEZE_MIN_DURATION_SECONDS = 0.5;
const ACTIVE_WINDOW_BUFFER_SECONDS = 0.75;
const MIN_ACTIVE_WINDOW_SECONDS = 1.5;

export function runFfmpeg(args: string[]): Promise<string> {
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

export interface ActiveWindow {
  startSeconds: number;
  endSeconds: number;
}

export interface ActiveWindowResult {
  durationSeconds: number | undefined;
  activeWindow: ActiveWindow | undefined;
}

export async function detectActiveWindow(inputPath: string): Promise<ActiveWindowResult> {
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
  if (!duration || duration <= 0) return { durationSeconds: duration, activeWindow: undefined };

  const starts = [...log.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  if (starts.length === 0) return { durationSeconds: duration, activeWindow: undefined };

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
  if (gaps.length === 0) return { durationSeconds: duration, activeWindow: undefined };

  const longest = gaps.reduce((a, b) => (b.endSeconds - b.startSeconds > a.endSeconds - a.startSeconds ? b : a));
  if (longest.endSeconds - longest.startSeconds < MIN_ACTIVE_WINDOW_SECONDS) return { durationSeconds: duration, activeWindow: undefined };

  const paddedStart = Math.max(0, longest.startSeconds - ACTIVE_WINDOW_BUFFER_SECONDS);
  const paddedEnd = Math.min(duration, longest.endSeconds + ACTIVE_WINDOW_BUFFER_SECONDS);
  if (paddedStart <= 0.05 && paddedEnd >= duration - 0.05) return { durationSeconds: duration, activeWindow: undefined };
  return { durationSeconds: duration, activeWindow: { startSeconds: paddedStart, endSeconds: paddedEnd } };
}

export async function extractCandidateFrames(videoPath: string, scratchDir: string, fps: number, activeWindow: ActiveWindow | undefined): Promise<string[]> {
  await mkdir(scratchDir, { recursive: true });
  const extractArgs = ["-y", "-i", videoPath];
  if (activeWindow) {
    extractArgs.push("-ss", activeWindow.startSeconds.toFixed(3), "-t", (activeWindow.endSeconds - activeWindow.startSeconds).toFixed(3));
  }
  extractArgs.push("-vf", `fps=${fps}`, "-q:v", "2", path.join(scratchDir, "candidate_%05d.jpg"));
  await runFfmpeg(extractArgs);
  return (await readdir(scratchDir)).filter((f) => f.startsWith("candidate_")).sort();
}

// Server-side video trimming for Caddie's crop-before-analyze flow. Runs on
// Vercel's Node.js runtime (needs ffmpeg) — same reasoning, and the exact
// same fetch/temp-file/ffmpeg plumbing, as extract-frames.ts.
//
// Why this exists: analyze-swing previously passed a golfer-picked
// startSeconds/endSeconds straight through to extract-frames as a sampling
// window, but left the ORIGINAL, untrimmed source video as
// caddie_analyses.source_media_url — reported live as "the crop isn't
// applied" once someone went back to actually watch the saved analysis
// (CaddieSwingReplay played the whole original clip, not just the picked
// window). This endpoint produces a REAL trimmed file; analyze-swing
// re-uploads its output as the row's actual source_media_url, so the
// stored video always matches what was analyzed and what a golfer sees on
// replay — not just what got sampled for pose data.
//
// Auth: internal-only, same as extract-frames.ts — every request must
// carry `Authorization: Bearer <FRAME_EXTRACT_SECRET>` (the same shared
// secret, deliberately not a second one: this endpoint has the identical
// trust boundary, server-to-server, analyze-swing is the only caller).
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPathImport from "ffmpeg-static";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Keep this small guard self-contained in each serverless entry. Vercel emits
// these routes as JavaScript without packaging the browser src/ TypeScript
// import. tests/caddieUploadServer.test.ts exercises isolated emitted modules
// with the same boundary cases as src/lib/caddieUploadLimit.ts.
// The source file, not only a selected crop, must fit this limit.
// Exactly 10 seconds is rejected. Unknown/invalid duration fails closed.
const MAX_CADDIE_UPLOAD_SECONDS = 10;
type CaddieDurationRejection = "too_long" | "unreadable";
function caddieDurationRejection(duration: unknown): CaddieDurationRejection | null {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return "unreadable";
  return duration >= MAX_CADDIE_UPLOAD_SECONDS ? "too_long" : null;
}
// Server routes inspect source-container metadata, before trusting a crop.
// Never return/log the input: ffmpeg metadata can contain private information.
function sourceDurationFromFfmpeg(log: string): number | undefined {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : undefined;
}

const ffmpegPath = ffmpegPathImport as unknown as string;

export const config = {
  api: { bodyParser: { sizeLimit: "200mb" } },
};

const MAX_TRIM_SECONDS = 15; // generous slack over analyze-swing's own 10s cap — a backstop, not the real gate

// Same contract as api/extract-frames.ts (duplicated on purpose — see the
// comment there): ffmpeg's stderr is never returned or logged, because for a
// phone video it echoes container metadata (GPS location, device, time).
export type FfmpegFailureToken = "decode_failed" | "no_video_stream" | "resources_exhausted" | "internal";

export class FfmpegError extends Error {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderrTail: string;
  constructor(exitCode: number | null, signal: string | null, stderrTail: string) {
    super("ffmpeg failed");
    this.name = "FfmpegError";
    this.exitCode = exitCode;
    this.signal = signal;
    this.stderrTail = stderrTail;
  }
}

export function classifyFfmpegFailure(err: unknown): { status: number; token: FfmpegFailureToken } {
  if (!(err instanceof FfmpegError)) return { status: 500, token: "internal" };
  const tail = err.stderrTail;
  if (err.signal === "SIGKILL" || /Cannot allocate memory|ENOMEM|ENOSPC|No space left on device/i.test(tail)) {
    return { status: 500, token: "resources_exhausted" };
  }
  if (/matches no streams|does not contain any stream|no video stream/i.test(tail)) return { status: 422, token: "no_video_stream" };
  if (
    /Invalid data found when processing input|moov atom not found|could not find codec parameters|Error while decoding|Invalid NAL|Unknown format|Decoder \(codec [^)]*\) not found|Could not open codec|Error opening input|Unsupported codec|Failed to open codec/i.test(
      tail,
    )
  ) {
    return { status: 422, token: "decode_failed" };
  }
  return { status: 500, token: "internal" };
}

// timeoutMs: kill ffmpeg (SIGKILL) if it runs longer — used to bound the
// network read below.
function runFfmpeg(args: string[], timeoutMs?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static did not resolve a binary path"));
    const proc = spawn(ffmpegPath, args);
    const timer = timeoutMs ? setTimeout(() => proc.kill("SIGKILL"), timeoutMs) : undefined;
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000); // only the tail is ever inspected
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new FfmpegError(code, signal, stderr.slice(-4000)));
    });
  });
}

// The one re-encode both paths run: frame-accurate cut of [start, start+duration).
function trimArgs(input: string, start: number, duration: number, output: string, inputOptions: string[] = []): string[] {
  return [
    "-y",
    ...inputOptions,
    "-ss",
    start.toFixed(3),
    "-i",
    input,
    "-t",
    duration.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    output,
  ];
}

// ---- Range read (2026-11-08) ----
// A window picked from a LONG recording used to cost a download of the
// whole original (90 MB for a 60 s fixture) before ffmpeg seeked into it.
// ffmpeg now reads the signed URL itself: with the input-side -ss it asks
// Storage only for the container index and the bytes around the window
// (33.6 of 90.7 MB on the H.264 fixture, 29.4 of 91.5 MB on HEVC; scratchpad
// trim-bench/). Same ffmpeg arguments, so the same output.
//
// Guard rails:
//  * -f mov: only QuickTime/MP4 (every iPhone/Android camera file). Other
//    containers fall back to the full download, which probes as before.
//    Pinning the demuxer also means a file that is really a playlist can't
//    make ffmpeg open other URLs; drefs (mov external references) are off by
//    default; protocols are limited to https over tls/tcp.
//  * bounded: each network read/write gives up after RANGE_RW_TIMEOUT_US
//    (with ffmpeg's own reconnects for a dropped connection), and the whole
//    ffmpeg run is killed after RANGE_READ_TIMEOUT_MS.
//  * ANY failure of this path (network, timeout, an odd file) falls back
//    once to the old full download + local file, whose result and error
//    tokens are exactly as before; nothing about the range attempt's error
//    reaches the caller (no stderr, no URL).
export const RANGE_READ_TIMEOUT_MS = 45_000;
const RANGE_RW_TIMEOUT_US = 15_000_000;
export function rangeInputOptions(protocols = "https,tls,tcp"): string[] {
  return [
    "-protocol_whitelist",
    protocols,
    "-rw_timeout",
    String(RANGE_RW_TIMEOUT_US),
    "-reconnect",
    "1",
    "-reconnect_on_network_error",
    "1",
    "-reconnect_delay_max",
    "4",
    "-f",
    "mov",
  ];
}

class SourceDurationError extends Error {
  readonly status: number;
  readonly token: string;
  constructor(reason: "too_long" | "unreadable") {
    super("source_duration_rejected");
    this.status = reason === "too_long" ? 413 : 422;
    this.token = reason === "too_long" ? "video_too_long" : "duration_unreadable";
  }
}
function checkSourceDuration(log: string): void {
  const reason = caddieDurationRejection(sourceDurationFromFfmpeg(log));
  if (reason) throw new SourceDurationError(reason);
}

export type TrimSource = "range" | "full";

// Trims `videoUrl`'s window into `outputPath`: the range read first, then
// (once) the full download. Throws only the full path's errors, classified
// by the caller as before. `protocols` is for local tests (plain http).
export async function trimWindowToFile(
  videoUrl: string,
  start: number,
  duration: number,
  workDir: string,
  outputPath: string,
  opts: { protocols?: string; rangeTimeoutMs?: number; enforceSourceLimit?: boolean } = {},
): Promise<{ source: TrimSource; rangeFailure?: string }> {
  let rangeFailure: string | undefined;
  try {
    const log = await runFfmpeg(trimArgs(videoUrl, start, duration, outputPath, rangeInputOptions(opts.protocols)), opts.rangeTimeoutMs ?? RANGE_READ_TIMEOUT_MS);
    if (opts.enforceSourceLimit) checkSourceDuration(log);
    const { size } = await stat(outputPath);
    if (size > 0) return { source: "range" };
    rangeFailure = "empty_output";
  } catch (err) {
    if (err instanceof SourceDurationError) throw err;
    rangeFailure = err instanceof FfmpegError ? (err.signal === "SIGKILL" ? "timeout" : classifyFfmpegFailure(err).token) : "spawn";
  }
  await rm(outputPath, { force: true }).catch(() => {});

  let videoRes: Response;
  try {
    videoRes = await fetch(videoUrl);
  } catch {
    // The thrown error's message embeds the signed URL: token only.
    throw new SourceFetchError();
  }
  if (!videoRes.ok) throw new SourceFetchError(videoRes.status);
  const inputPath = path.join(workDir, "input.mov");
  await writeFile(inputPath, new Uint8Array(await videoRes.arrayBuffer()));
  const log = await runFfmpeg(trimArgs(inputPath, start, duration, outputPath));
  if (opts.enforceSourceLimit) checkSourceDuration(log);
  return { source: "full", rangeFailure };
}

class SourceFetchError extends Error {
  readonly sourceStatus?: number;
  constructor(sourceStatus?: number) {
    super("source_fetch_failed");
    this.name = "SourceFetchError";
    this.sourceStatus = sourceStatus;
  }
}

// Health audit P2-9 (defense in depth): analyze-swing, the only caller,
// now only ever passes this project's own Supabase Storage URLs (a signed
// caddie-media URL or a public community-media URL). Refuse anything else
// so a leaked FRAME_EXTRACT_SECRET can't turn this into a general fetcher.
function isAllowedVideoUrl(videoUrl: string): boolean {
  try {
    const u = new URL(videoUrl);
    return u.protocol === "https:" && u.hostname.endsWith(".supabase.co") && u.pathname.startsWith("/storage/v1/object/");
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const expectedSecret = process.env.FRAME_EXTRACT_SECRET;
  const authHeader = req.headers.authorization ?? "";
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { videoUrl, startSeconds, endSeconds } = (req.body ?? {}) as {
    videoUrl?: string;
    startSeconds?: number;
    endSeconds?: number;
  };
  if (!videoUrl || typeof videoUrl !== "string") return res.status(400).json({ error: "videoUrl is required" });
  if (!isAllowedVideoUrl(videoUrl)) return res.status(400).json({ error: "videoUrl is not an allowed source" });
  if (typeof startSeconds !== "number" || typeof endSeconds !== "number" || endSeconds <= startSeconds) {
    return res.status(400).json({ error: "startSeconds/endSeconds are required and endSeconds must exceed startSeconds" });
  }
  const clampedStart = Math.max(0, startSeconds);
  const clampedDuration = Math.min(MAX_TRIM_SECONDS, endSeconds - clampedStart);

  let workDir: string | undefined;
  try {
    workDir = await mkdtemp(path.join(tmpdir(), "swing-trim-"));
    const outputPath = path.join(workDir, "output.mp4");

    // Re-encodes rather than stream-copying (-c copy) — a copy-trim can
    // only cut on a source keyframe, which can land a full GOP (often
    // 1-2s on phone video) away from the golfer's actual chosen boundary.
    // This is meant to be a precise crop, not a fast-but-approximate one,
    // and these clips are short enough that re-encoding stays quick.
    const startedAt = Date.now();
    let trimmed: { source: TrimSource; rangeFailure?: string };
    try {
      trimmed = await trimWindowToFile(videoUrl, clampedStart, clampedDuration, workDir, outputPath, { enforceSourceLimit: true });
    } catch (err) {
      if (err instanceof SourceFetchError) {
        return res.status(502).json({ error: "source_fetch_failed", ...(err.sourceStatus ? { sourceStatus: err.sourceStatus } : {}) });
      }
      throw err;
    }
    if (trimmed.rangeFailure) console.error("[trim-video] range read failed, used the full download", { error: trimmed.rangeFailure });

    const outputBytes = await readFile(outputPath);
    res.setHeader("Content-Type", "video/mp4");
    // Telemetry for analyze-swing's video_trimmed log line (tokens only).
    res.setHeader("X-Trim-Source", trimmed.source);
    res.setHeader("X-Trim-Ms", String(Date.now() - startedAt));
    return res.status(200).send(outputBytes);
  } catch (err) {
    if (err instanceof SourceDurationError) return res.status(err.status).json({ error: err.token });
    // A classified token only — never ffmpeg's stderr or a thrown message.
    const { status, token } = classifyFfmpegFailure(err);
    console.error("[trim-video] failed", {
      error: token,
      exitCode: err instanceof FfmpegError ? err.exitCode : undefined,
      signal: err instanceof FfmpegError ? err.signal : undefined,
      errorName: err instanceof Error ? err.name : typeof err,
    });
    return res.status(status).json({ error: token });
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

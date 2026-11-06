// Server-side video-frame extraction for Caddie's Roboflow pipeline.
// Runs on Vercel's Node.js serverless runtime (NOT edge) because it needs
// ffmpeg, which a Deno Edge Function can't run reliably — see the
// analyze-swing Supabase Edge Function, which calls this endpoint as an
// internal step rather than doing frame extraction itself.
//
// Auth: this is a public HTTP endpoint by default (Vercel functions have
// no built-in access control), so every request must carry
// `Authorization: Bearer <FRAME_EXTRACT_SECRET>` — a shared secret set as
// a Vercel env var here AND a Supabase Edge Function secret on the
// analyze-swing side. This function is never called from the browser.
//
// Extracting JPEG frames (rather than re-encoding the source video) means
// ffmpeg only has to DECODE the input, not transcode it — it handles
// H.264 and HEVC/.mov equally well for this purpose, so there's no
// separate "convert MOV to MP4 first" step needed here.
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// ffmpeg-static's own type declarations resolve to a namespace object in
// Vercel's build, not the plain string its runtime export actually is —
// cast at the boundary rather than fight the package's .d.ts.
import ffmpegPathImport from "ffmpeg-static";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ffmpegPath = ffmpegPathImport as unknown as string;

export const config = {
  api: { bodyParser: { sizeLimit: "200mb" } },
};

// Upper bound on a caller-requested maxLongSide (analyze-swing asks for 720).
const MAX_LONG_SIDE_LIMIT = 4096;
const MIN_LONG_SIDE_LIMIT = 160;
const MAX_DURATION_SECONDS = 11; // hard ceiling — analyze-swing's own 10s upload-time limit is the real gate, this is just a backstop with 1s of slack for metadata/rounding imprecision
const DEFAULT_FPS = 8;

// --- Motion-based active-window trimming (2026-08-22 credit-efficiency
// pass). A 10s upload can still hold several seconds of the golfer just
// standing over the ball before starting, or walking off after — analyzing
// those idle seconds at full fps burns Roboflow calls for zero signal.
// ffmpeg's own `freezedetect` filter (a single cheap decode-only pass,
// spends zero Roboflow credits) flags the STILL stretches; whatever's left
// between them is the actual swing motion. Deliberately conservative: any
// ambiguous result falls back to analyzing the whole clip untrimmed rather
// than risk cutting off a real Address or Follow-through position.
const FREEZE_NOISE = "0.001"; // ffmpeg's own freezedetect default tolerance
const FREEZE_MIN_DURATION_SECONDS = 0.5; // a stance held even briefly still counts as "still" — short on purpose since recommended clips are now only 4-8s
const ACTIVE_WINDOW_BUFFER_SECONDS = 0.75; // padding kept on each side of the detected motion so a real backswing start / follow-through end is never clipped
const MIN_ACTIVE_WINDOW_SECONDS = 1.5; // an address-to-follow-through swing rarely fits under this; a shorter "active" read is more likely bad detection than a real swing, so it isn't trusted

// ffmpeg's stderr is NEVER returned to the caller or logged: for a phone
// video it echoes the container metadata (QuickTime GPS location, device
// make/model, creation time). A failure is reduced to one of these tokens
// (also duplicated in api/trim-video.ts — Vercel's ESM build makes a shared
// relative import between function files fragile); analyze-swing maps the
// token + HTTP status to its failure category.
export type FfmpegFailureToken = "decode_failed" | "no_video_stream" | "resources_exhausted" | "internal";

export class FfmpegError extends Error {
  readonly exitCode: number | null;
  readonly signal: string | null;
  // Kept only in memory for classifyFfmpegFailure(); never serialized.
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

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static did not resolve a binary path"));
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      // freezedetect parsing reads the whole log, so only a runaway one is
      // cut (keeping its tail).
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
    });
    proc.on("error", reject);
    proc.on("close", (code, signal) => {
      if (code === 0) resolve(stderr);
      else reject(new FfmpegError(code, signal, stderr.slice(-4000)));
    });
  });
}

// `ffmpeg -i <file>` with no output exits non-zero by design but prints the
// stream info we want; resolve with stderr either way.
function probeFfmpeg(inputPath: string): Promise<string> {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve("");
    const proc = spawn(ffmpegPath, ["-hide_banner", "-i", inputPath]);
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", () => resolve(stderr));
    proc.on("close", () => resolve(stderr));
  });
}

// Long side of the first video stream, in pixels. Only the LONG side is
// used, so rotation metadata (portrait phone video stored landscape) doesn't
// matter here.
function parseVideoLongSide(ffmpegLog: string): number | undefined {
  const m = ffmpegLog.match(/Stream #\d+:\d+[^\n]*?: Video: [^\n]*?, (\d{2,5})x(\d{2,5})/);
  if (!m) return undefined;
  const longSide = Math.max(Number(m[1]), Number(m[2]));
  return Number.isFinite(longSide) && longSide > 0 ? longSide : undefined;
}

// Width/height from a baseline or progressive JPEG's SOF marker.
function jpegSize(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return undefined;
    const marker = bytes[i + 1];
    const length = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return undefined;
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

// Runs the freezedetect pass and returns the padded active (motion) window,
// or undefined if detection was inconclusive/not worth trusting — callers
// treat undefined as "analyze the whole clip, untrimmed."
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
  if (starts.length === 0) return undefined; // no still stretches detected — nothing to trim, or motion throughout

  const freezeIntervals: ActiveWindow[] = starts.map((start, i) => ({
    startSeconds: start,
    endSeconds: i < ends.length ? ends[i] : duration, // an unmatched trailing freeze_start means "frozen through EOF"
  }));

  // The active (non-frozen) gaps are the complement of the freeze
  // intervals within [0, duration] — a golf swing clip should produce at
  // most a couple of these (e.g. still-then-swing, or still-swing-still);
  // the longest gap is taken as the actual swing.
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
  // Padding already covers essentially the whole clip — trimming would
  // save nothing worth the extra complexity in the response; treat as untrimmed.
  if (paddedStart <= 0.05 && paddedEnd >= duration - 0.05) return undefined;
  return { startSeconds: paddedStart, endSeconds: paddedEnd };
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

  const { videoUrl, fps, startSeconds, endSeconds, maxLongSide } = (req.body ?? {}) as {
    videoUrl?: string;
    fps?: number;
    // Optional: downscale frames so their long side is at most this many
    // pixels (smaller Roboflow payloads). The response then carries
    // coordinateScale, the factor that maps a frame pixel back to a source-
    // video pixel — Caddie's replay overlay draws keypoints against the
    // video's own videoWidth/videoHeight, so the caller MUST apply it.
    // Omitted = full-size frames, exactly as before.
    maxLongSide?: number;
    // When both are provided, extraction targets exactly this window (used
    // for analyze-swing's adaptive dense pass around the impact region) and
    // freezedetect-based active-window trimming is skipped entirely — the
    // caller has already decided the window it wants.
    startSeconds?: number;
    endSeconds?: number;
  };
  if (!videoUrl || typeof videoUrl !== "string") return res.status(400).json({ error: "videoUrl is required" });
  if (!isAllowedVideoUrl(videoUrl)) return res.status(400).json({ error: "videoUrl is not an allowed source" });
  const targetFps = Math.min(Math.max(fps ?? DEFAULT_FPS, 1), 30);
  const explicitWindow =
    typeof startSeconds === "number" && typeof endSeconds === "number" && endSeconds > startSeconds
      ? { startSeconds: Math.max(0, startSeconds), endSeconds }
      : undefined;

  const targetLongSide =
    typeof maxLongSide === "number" && Number.isFinite(maxLongSide)
      ? Math.round(Math.min(Math.max(maxLongSide, MIN_LONG_SIDE_LIMIT), MAX_LONG_SIDE_LIMIT))
      : undefined;

  let workDir: string | undefined;
  try {
    let videoRes: Response;
    try {
      videoRes = await fetch(videoUrl);
    } catch {
      // The thrown error's message embeds the signed URL: token only.
      return res.status(502).json({ error: "source_fetch_failed" });
    }
    if (!videoRes.ok) return res.status(502).json({ error: "source_fetch_failed", sourceStatus: videoRes.status });
    const videoBytes = new Uint8Array(await videoRes.arrayBuffer());

    workDir = await mkdtemp(path.join(tmpdir(), "swing-frames-"));
    const inputPath = path.join(workDir, "input.mov");
    await writeFile(inputPath, videoBytes);

    // Spends zero Roboflow credits — a decode-only ffmpeg pass over an
    // already-short (<=~11s) clip. Any failure here just means "skip
    // trimming," never blocks the actual extraction below. Skipped
    // entirely when the caller already specified an explicit window.
    let activeWindow: ActiveWindow | undefined = explicitWindow;
    if (!activeWindow) {
      try {
        activeWindow = await detectActiveWindow(inputPath);
      } catch (err) {
        console.error("[extract-frames] active-window detection failed, analyzing the whole clip", { error: classifyFfmpegFailure(err).token });
      }
    }

    const extractArgs = ["-y", "-i", inputPath];
    if (activeWindow) {
      extractArgs.push("-ss", activeWindow.startSeconds.toFixed(3), "-t", (activeWindow.endSeconds - activeWindow.startSeconds).toFixed(3));
    } else {
      // -t caps how much of the source ffmpeg reads, independent of
      // whatever duration the caller's own upload-time validation already
      // enforced — a hard backstop against an unexpectedly long file.
      extractArgs.push("-t", String(MAX_DURATION_SECONDS));
    }
    // Downscale only when asked and only when the source is actually larger
    // (never upscale). The box fit keeps the aspect ratio, so one uniform
    // factor maps frame pixels back to source pixels on both axes. If the
    // source size can't be read, frames stay full size (scale 1).
    let sourceLongSide: number | undefined;
    if (targetLongSide) {
      sourceLongSide = parseVideoLongSide(await probeFfmpeg(inputPath));
    }
    const downscale = !!targetLongSide && !!sourceLongSide && sourceLongSide > targetLongSide;
    const videoFilter = downscale
      ? `fps=${targetFps},scale=w=${targetLongSide}:h=${targetLongSide}:force_original_aspect_ratio=decrease:force_divisible_by=2`
      : `fps=${targetFps}`;
    extractArgs.push("-vf", videoFilter, "-q:v", "3", path.join(workDir, "frame_%05d.jpg"));
    await runFfmpeg(extractArgs);

    const frameStartOffset = activeWindow?.startSeconds ?? 0;
    const files = (await readdir(workDir)).filter((f) => f.startsWith("frame_")).sort();

    // Measured from the actual output frame, not assumed from the filter.
    let coordinateScale = 1;
    if (downscale && sourceLongSide && files.length > 0) {
      const size = jpegSize(await readFile(path.join(workDir, files[0])));
      const outLongSide = size ? Math.max(size.width, size.height) : targetLongSide!;
      coordinateScale = Number((sourceLongSide / outLongSide).toFixed(6));
    }
    const frames = await Promise.all(
      files.map(async (name, i) => {
        const bytes = await readFile(path.join(workDir!, name));
        return {
          frameIndex: i,
          timestampSeconds: Number((frameStartOffset + i / targetFps).toFixed(3)),
          base64: bytes.toString("base64"),
        };
      }),
    );

    return res.status(200).json({
      analysisFps: targetFps,
      frameCount: frames.length,
      // Multiply a keypoint's x/y by this to get source-video pixels. 1 when
      // frames weren't downscaled.
      coordinateScale,
      frames,
      activeWindowTrim: activeWindow ? { startSeconds: activeWindow.startSeconds, endSeconds: activeWindow.endSeconds } : null,
    });
  } catch (err) {
    // A classified token only — never ffmpeg's stderr (video metadata) or a
    // thrown message (may embed the signed URL).
    const { status, token } = classifyFfmpegFailure(err);
    console.error("[extract-frames] failed", {
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

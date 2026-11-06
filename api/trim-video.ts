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
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPathImport from "ffmpeg-static";
import type { VercelRequest, VercelResponse } from "@vercel/node";

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

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static did not resolve a binary path"));
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000); // only the tail is ever inspected
    });
    proc.on("error", reject);
    proc.on("close", (code, signal) => {
      if (code === 0) resolve(stderr);
      else reject(new FfmpegError(code, signal, stderr.slice(-4000)));
    });
  });
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
    let videoRes: Response;
    try {
      videoRes = await fetch(videoUrl);
    } catch {
      // The thrown error's message embeds the signed URL: token only.
      return res.status(502).json({ error: "source_fetch_failed" });
    }
    if (!videoRes.ok) return res.status(502).json({ error: "source_fetch_failed", sourceStatus: videoRes.status });
    const videoBytes = new Uint8Array(await videoRes.arrayBuffer());

    workDir = await mkdtemp(path.join(tmpdir(), "swing-trim-"));
    const inputPath = path.join(workDir, "input.mov");
    const outputPath = path.join(workDir, "output.mp4");
    await writeFile(inputPath, videoBytes);

    // Re-encodes rather than stream-copying (-c copy) — a copy-trim can
    // only cut on a source keyframe, which can land a full GOP (often
    // 1-2s on phone video) away from the golfer's actual chosen boundary.
    // This is meant to be a precise crop, not a fast-but-approximate one,
    // and these clips are short enough that re-encoding stays quick.
    await runFfmpeg([
      "-y",
      "-ss",
      clampedStart.toFixed(3),
      "-i",
      inputPath,
      "-t",
      clampedDuration.toFixed(3),
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
      outputPath,
    ]);

    const outputBytes = await readFile(outputPath);
    res.setHeader("Content-Type", "video/mp4");
    return res.status(200).send(outputBytes);
  } catch (err) {
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

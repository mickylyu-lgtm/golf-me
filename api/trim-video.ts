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
  if (typeof startSeconds !== "number" || typeof endSeconds !== "number" || endSeconds <= startSeconds) {
    return res.status(400).json({ error: "startSeconds/endSeconds are required and endSeconds must exceed startSeconds" });
  }
  const clampedStart = Math.max(0, startSeconds);
  const clampedDuration = Math.min(MAX_TRIM_SECONDS, endSeconds - clampedStart);

  let workDir: string | undefined;
  try {
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) return res.status(502).json({ error: `Failed to fetch source video (${videoRes.status})` });
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
    console.error("[trim-video] failed", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

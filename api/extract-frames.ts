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

const MAX_DURATION_SECONDS = 20; // hard ceiling — analyze-swing's own video-length limit is the real gate, this is just a backstop
const DEFAULT_FPS = 8;

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static did not resolve a binary path"));
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
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

  const { videoUrl, fps } = (req.body ?? {}) as { videoUrl?: string; fps?: number };
  if (!videoUrl || typeof videoUrl !== "string") return res.status(400).json({ error: "videoUrl is required" });
  const targetFps = Math.min(Math.max(fps ?? DEFAULT_FPS, 1), 15);

  let workDir: string | undefined;
  try {
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) return res.status(502).json({ error: `Failed to fetch source video (${videoRes.status})` });
    const videoBytes = new Uint8Array(await videoRes.arrayBuffer());

    workDir = await mkdtemp(path.join(tmpdir(), "swing-frames-"));
    const inputPath = path.join(workDir, "input.mov");
    await writeFile(inputPath, videoBytes);

    // -t caps how much of the source ffmpeg reads, independent of whatever
    // duration the caller's own upload-time validation already enforced —
    // a hard backstop against an unexpectedly long file.
    await runFfmpeg([
      "-y",
      "-t",
      String(MAX_DURATION_SECONDS),
      "-i",
      inputPath,
      "-vf",
      `fps=${targetFps}`,
      "-q:v",
      "3",
      path.join(workDir, "frame_%05d.jpg"),
    ]);

    const files = (await readdir(workDir)).filter((f) => f.startsWith("frame_")).sort();
    const frames = await Promise.all(
      files.map(async (name, i) => {
        const bytes = await readFile(path.join(workDir!, name));
        return {
          frameIndex: i,
          timestampSeconds: Number((i / targetFps).toFixed(3)),
          base64: bytes.toString("base64"),
        };
      }),
    );

    return res.status(200).json({ analysisFps: targetFps, frameCount: frames.length, frames });
  } catch (err) {
    console.error("[extract-frames] failed", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

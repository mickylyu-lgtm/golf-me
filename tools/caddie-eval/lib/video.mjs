// Local video decoding for the Caddie V2 eval tools: ffmpeg decodes a stored
// clip into raw RGBA frames streamed over a pipe. No frame is written to
// disk. No network. Pure helpers are exported for unit tests.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EvalError, FFMPEG_ENV } from "../import-clip.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Default analysis cap: decode at the clip's own rate, but never above this. */
export const DEFAULT_MAX_FPS = 60;
/** Default long-side cap in pixels for frames handed to the model. */
export const DEFAULT_MAX_SIDE = 1280;
/** Safety cap on frames per clip (15 s at 60 fps is 900). */
export const DEFAULT_MAX_FRAMES = 1200;

/**
 * ffmpeg to use: $GOLFME_EVAL_FFMPEG, else `ffmpeg` on PATH, else the
 * ffmpeg-static binary already in node_modules (a GolfMe dependency).
 */
export function resolveFfmpeg(env = process.env) {
  const candidates = [env[FFMPEG_ENV], "ffmpeg", path.join(REPO, "node_modules", "ffmpeg-static", "ffmpeg")].filter(Boolean);
  for (const bin of candidates) {
    const r = spawnSync(bin, ["-version"], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8", timeout: 10_000 });
    if (r.status === 0) return { bin, version: (r.stdout.split("\n")[0] || "").trim() };
  }
  throw new EvalError("ffmpeg not found (set GOLFME_EVAL_FFMPEG, install ffmpeg, or run npm install for ffmpeg-static)");
}

/** ffmpeg -vf chain: optional fps resample, then a long-side downscale that keeps even dimensions. */
export function buildVideoFilter({ fps, maxSide }) {
  if (!(Number.isFinite(maxSide) && maxSide >= 64)) throw new EvalError("max side must be at least 64 pixels");
  const parts = [];
  if (fps !== null && fps !== undefined) {
    if (!(Number.isFinite(fps) && fps > 0 && fps <= 1000)) throw new EvalError("fps must be a positive number up to 1000");
    parts.push(`fps=${fps}`);
  }
  const m = Math.floor(maxSide);
  parts.push(`scale=w='if(gte(iw,ih),min(${m},iw),-2)':h='if(gte(iw,ih),-2,min(${m},ih))':flags=area`);
  return parts.join(",");
}

/**
 * Parses ffmpeg's stderr banner from a probe run: the input video stream
 * (size, fps, rotation), duration, and the rawvideo output size.
 */
export function parseFfmpegProbe(stderr) {
  const text = String(stderr);
  const inputIdx = text.indexOf("Input #0");
  const outputIdx = text.indexOf("Output #0");
  const inputPart = inputIdx >= 0 ? text.slice(inputIdx, outputIdx > inputIdx ? outputIdx : undefined) : "";
  const outputPart = outputIdx >= 0 ? text.slice(outputIdx) : "";

  const dur = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(inputPart);
  const durationSeconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null;

  const inLine = /Stream #0:\d+[^\n]*?: Video: ([^\n]*)/.exec(inputPart);
  let inputWidth = null;
  let inputHeight = null;
  let inputFps = null;
  let codec = null;
  if (inLine) {
    codec = inLine[1].split(/[\s,(]/)[0] || null;
    const size = /(?:^|[\s,])(\d{2,5})x(\d{2,5})(?=[\s,[]|$)/.exec(inLine[1]);
    if (size) [inputWidth, inputHeight] = [Number(size[1]), Number(size[2])];
    const fps = /([\d.]+)\s*fps/.exec(inLine[1]) ?? /([\d.]+)\s*tbr/.exec(inLine[1]);
    if (fps) inputFps = Number(fps[1]);
  }
  const rot = /rotation of (-?[\d.]+) degrees/.exec(inputPart);
  const outLine = /Stream #0:\d+[^\n]*?: Video: rawvideo[^\n]*?[\s,](\d{2,5})x(\d{2,5})(?=[\s,[]|$)/.exec(outputPart);
  return {
    codec,
    durationSeconds,
    inputWidth,
    inputHeight,
    inputFps,
    rotationDegrees: rot ? Number(rot[1]) : 0,
    outputWidth: outLine ? Number(outLine[1]) : null,
    outputHeight: outLine ? Number(outLine[2]) : null,
  };
}

function runProbe(ffmpeg, file, filter) {
  const args = ["-hide_banner", "-nostdin", "-i", file, "-map", "0:v:0", "-an", "-sn", "-dn"];
  if (filter) args.push("-vf", filter);
  args.push("-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-y", "/dev/null");
  const r = spawnSync(ffmpeg, args, { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], timeout: 60_000 });
  if (r.status !== 0) throw new EvalError("ffmpeg could not read the clip's video stream");
  return parseFfmpegProbe(r.stderr);
}

/**
 * Probes the clip and settles the analysis plan: fps (the clip's own, capped
 * at maxFps, unless fps is given) and the decoded frame size.
 */
export function planDecode(ffmpeg, file, { fps = null, maxFps = DEFAULT_MAX_FPS, maxSide = DEFAULT_MAX_SIDE } = {}) {
  const first = runProbe(ffmpeg, file, null);
  if (!first.inputWidth || !first.inputHeight) throw new EvalError("could not read the clip's frame size");
  let analysisFps = fps;
  if (analysisFps === null) {
    if (!first.inputFps) throw new EvalError("could not read the clip's frame rate; pass --fps");
    analysisFps = Math.min(first.inputFps, maxFps);
  }
  const filter = buildVideoFilter({ fps: analysisFps, maxSide });
  const second = runProbe(ffmpeg, file, filter);
  if (!second.outputWidth || !second.outputHeight) throw new EvalError("could not read the decoded frame size");
  return {
    filter,
    analysisFps,
    width: second.outputWidth,
    height: second.outputHeight,
    source: {
      codec: first.codec,
      width: first.inputWidth,
      height: first.inputHeight,
      fps: first.inputFps,
      rotationDegrees: first.rotationDegrees,
      durationSeconds: first.durationSeconds,
    },
  };
}

/**
 * Splits a byte stream into fixed-size frames without quadratic copying.
 * Yields a fresh Buffer per frame. Throws on a trailing partial frame.
 */
export async function* chunkFrames(stream, frameBytes) {
  if (!(Number.isInteger(frameBytes) && frameBytes > 0)) throw new EvalError("frame size must be a positive integer");
  let frame = Buffer.allocUnsafe(frameBytes);
  let filled = 0;
  for await (const chunk of stream) {
    let offset = 0;
    while (offset < chunk.length) {
      const n = Math.min(frameBytes - filled, chunk.length - offset);
      chunk.copy(frame, filled, offset, offset + n);
      filled += n;
      offset += n;
      if (filled === frameBytes) {
        yield frame;
        frame = Buffer.allocUnsafe(frameBytes);
        filled = 0;
      }
    }
  }
  if (filled !== 0) throw new EvalError(`decoder ended mid-frame (${filled} of ${frameBytes} bytes)`);
}

/**
 * Decodes `file` with the plan from planDecode() and yields
 * { index, timestampSeconds, rgba } frames, up to maxFrames. The ffmpeg child
 * is killed on early exit. `onSpawn(pid)` lets a resource monitor see it.
 * `stats` (optional object) receives { frames, truncated } when decoding ends.
 */
export async function* decodeFrames(ffmpeg, file, plan, { maxFrames = DEFAULT_MAX_FRAMES, onSpawn, stats = {} } = {}) {
  if (!fs.existsSync(file)) throw new EvalError("clip file not found");
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", file, "-map", "0:v:0", "-an", "-sn", "-dn",
    "-vf", plan.filter, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"];
  const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
  onSpawn?.(child.pid);
  let stderr = "";
  child.stderr.on("data", (d) => {
    if (stderr.length < 4000) stderr += d;
  });
  const exited = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
  let index = 0;
  let truncated = false;
  try {
    for await (const rgba of chunkFrames(child.stdout, plan.width * plan.height * 4)) {
      if (index >= maxFrames) {
        truncated = true;
        break;
      }
      yield { index, timestampSeconds: index / plan.analysisFps, rgba };
      index++;
    }
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  const { code, signal } = await exited;
  stats.frames = index;
  stats.truncated = truncated;
  if (!truncated && code !== 0 && signal !== "SIGKILL") throw new EvalError(`ffmpeg decode failed (${code ?? signal}): ${stderr.trim().slice(0, 300)}`);
}

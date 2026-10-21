#!/usr/bin/env node
// Renders the local pose on top of a stored clip, so a coach can judge body
// landmark reliability in pilot pass 2 (TESTING_PROTOCOL.md §8). Output:
// derived/<clip ID>/overlay-mediapipe-<variant>.mp4 in the data folder only
// (deleted by withdraw/retention like everything derived). Shown to coaches
// the same way as the clip itself (in person, or the Meet screen-share), and
// only for clips coach-session-check lists. Never shared as a file.
//
// Drawn: the 13 keypoints and bones whose confidence passes the quality
// gate's keypoint threshold (provisional). Golfer's left side cyan, right
// side orange, torso cross-links white. A keypoint below the threshold is
// NOT drawn (it is "not observed"). A red border marks frames the quality
// gate rejects. Nothing else: no phases, angles, faults, or text.
//
// Usage: node tools/caddie-eval/render-overlay.mjs --clip C001-0001 [--variant full|heavy]
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { QG_MIN_KEYPOINT_CONFIDENCE, assessFrameQuality } from "../../src/lib/caddie/v2/qualityGate.ts";
import { EvalError, assertLocalProcessingAllowed, auditEvent, defaultDataDir, todayIso } from "./import-clip.mjs";
import { decodeFrames, planDecode, resolveFfmpeg } from "./lib/video.mjs";
import { validatePoseSequence } from "./run-v2-checks.mjs";

const CYAN = [0, 220, 255];
const ORANGE = [255, 150, 0];
const WHITE = [255, 255, 255];
const RED = [230, 30, 30];

export const BONES = [
  ["left_shoulder", "left_elbow", CYAN],
  ["left_elbow", "left_wrist", CYAN],
  ["left_shoulder", "left_hip", CYAN],
  ["left_hip", "left_knee", CYAN],
  ["left_knee", "left_ankle", CYAN],
  ["right_shoulder", "right_elbow", ORANGE],
  ["right_elbow", "right_wrist", ORANGE],
  ["right_shoulder", "right_hip", ORANGE],
  ["right_hip", "right_knee", ORANGE],
  ["right_knee", "right_ankle", ORANGE],
  ["left_shoulder", "right_shoulder", WHITE],
  ["left_hip", "right_hip", WHITE],
];

function sideColor(name) {
  return name.startsWith("left_") ? CYAN : name.startsWith("right_") ? ORANGE : WHITE;
}

function disc(rgba, w, h, cx, cy, r, [cr, cg, cb]) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = (y * w + x) * 4;
      rgba[i] = cr;
      rgba[i + 1] = cg;
      rgba[i + 2] = cb;
      rgba[i + 3] = 255;
    }
  }
}

function line(rgba, w, h, a, b, r, color) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(rgba, w, h, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r, color);
  }
}

function border(rgba, w, h, px, color) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= px && x < w - px && y >= px && y < h - px) continue;
      const i = (y * w + x) * 4;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = 255;
    }
  }
}

/**
 * Draws one PoseFrame (source_pixels, same size as the buffer) onto an RGBA
 * buffer in place. Returns { drawnKeypoints, usable }.
 */
export function drawPoseFrame(rgba, w, h, frame, { minConfidence = QG_MIN_KEYPOINT_CONFIDENCE } = {}) {
  const scale = Math.max(w, h) / 1280;
  const lineR = Math.max(1.5, 2.5 * scale);
  const dotR = Math.max(3, 5 * scale);
  const ok = (name) => {
    const kp = frame.keypoints[name];
    return kp && kp.confidence >= minConfidence ? kp : null;
  };
  for (const [a, b, color] of BONES) {
    const ka = ok(a);
    const kb = ok(b);
    if (ka && kb) line(rgba, w, h, ka, kb, lineR, color);
  }
  let drawnKeypoints = 0;
  for (const name of Object.keys(frame.keypoints)) {
    const kp = ok(name);
    if (!kp) continue;
    disc(rgba, w, h, kp.x, kp.y, dotR, sideColor(name));
    drawnKeypoints++;
  }
  const usable = assessFrameQuality(frame).usable;
  if (!usable) border(rgba, w, h, Math.max(4, Math.round(6 * scale)), RED);
  return { drawnKeypoints, usable };
}

function write(stream, buf) {
  if (stream.write(buf)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      stream.off("drain", onDrain);
      reject(err);
    };
    const onDrain = () => {
      stream.off("error", onError);
      resolve();
    };
    stream.once("drain", onDrain);
    stream.once("error", onError);
  });
}

export async function renderOverlay(dataDir, clipId, { variant = "full", today = todayIso(), env = process.env } = {}) {
  const { file, derivedDir, layout } = await assertLocalProcessingAllowed(dataDir, clipId, { today });
  const poseFile = path.join(derivedDir, `pose-mediapipe-${variant}.json`);
  const runFile = path.join(derivedDir, `pose-mediapipe-${variant}.run.json`);
  if (!fs.existsSync(poseFile) || !fs.existsSync(runFile)) throw new EvalError(`${clipId}: run pose-local.mjs --variant ${variant} first`);
  const seq = JSON.parse(fs.readFileSync(poseFile, "utf8"));
  const problems = validatePoseSequence(seq);
  if (problems.length) throw new EvalError(`${clipId}: pose file is malformed: ${problems.join("; ")}`);
  if (seq.coordinateSpace !== "source_pixels") throw new EvalError("overlay needs a source_pixels sequence");
  const run = JSON.parse(fs.readFileSync(runFile, "utf8"));
  const ffmpeg = resolveFfmpeg(env);
  const plan = planDecode(ffmpeg.bin, file, { fps: run.decode.analysisFps, maxSide: Math.max(run.decode.width, run.decode.height) });
  if (plan.width !== seq.sourceWidth || plan.height !== seq.sourceHeight) throw new EvalError("decoded size differs from the pose run; re-run pose-local.mjs");

  const byIndex = new Map(seq.frames.map((f) => [f.frameIndex, f]));
  const out = path.join(derivedDir, `overlay-mediapipe-${variant}.mp4`);
  const tmp = path.join(derivedDir, `.overlay-${variant}.${process.pid}.mp4`);
  const enc = spawn(
    ffmpeg.bin,
    ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${plan.width}x${plan.height}`, "-r", String(plan.analysisFps),
      "-i", "pipe:0", "-an", "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-map_metadata", "-1", "-movflags", "+faststart", tmp],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  enc.stderr.on("data", (d) => {
    if (stderr.length < 2000) stderr += d;
  });
  const done = new Promise((resolve) => enc.on("close", resolve));
  let frames = 0;
  let unusable = 0;
  try {
    for await (const f of decodeFrames(ffmpeg.bin, file, plan, { maxFrames: run.decode.frames })) {
      const pf = byIndex.get(f.index) ?? { keypoints: {}, personConfidence: null };
      if (!drawPoseFrame(f.rgba, plan.width, plan.height, pf).usable) unusable++;
      await write(enc.stdin, f.rgba);
      frames++;
    }
    enc.stdin.end();
    const code = await done;
    if (code !== 0) throw new EvalError(`ffmpeg could not encode the overlay: ${stderr.trim().slice(0, 300)}`);
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, out);
  } finally {
    if (enc.exitCode === null) enc.kill("SIGKILL");
    fs.rmSync(tmp, { force: true });
  }
  auditEvent(layout, { action: "overlay_rendered_locally", clipId, variant, frames }, today);
  return { clipId, variant, frames, unusableFrames: unusable, file: path.relative(layout.root, out) };
}

async function main(argv) {
  const { values } = parseArgs({ args: argv, options: { clip: { type: "string" }, variant: { type: "string" } } });
  if (!values.clip) throw new EvalError("--clip C001-0001 is required");
  const r = await renderOverlay(defaultDataDir(), values.clip, { variant: values.variant ?? "full" });
  process.stdout.write(`Wrote ${r.file} (${r.frames} frames, ${r.unusableFrames} flagged unusable with a red border). Local only; never send it.\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`render-overlay: ${err instanceof EvalError ? err.message : `unexpected error: ${err?.stack ?? err}`}\n`);
      process.exit(1);
    },
  );
}

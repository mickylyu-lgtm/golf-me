#!/usr/bin/env node
// Caddie V2 local pose extractor (LOCAL_PILOT_WORKFLOW.md step 6).
//
// Runs MediaPipe Pose Landmarker (@mediapipe/tasks-vision, exact-pinned
// devDependency) inside the headless Chromium that playwright-core drives,
// fully offline:
// - the page is served from a fake origin (http://caddie-eval.invalid) and
//   EVERY request is answered by Playwright from an allowlist of local files
//   (the page, the MediaPipe bundle and WASM, the model, the current frame).
//   Anything else is aborted and counted, WebSockets are closed, service
//   workers are blocked, and DNS is mapped to nothing as a second layer.
//   MediaPipe 1.x ships a usage logger that POSTs to odml.pa.googleapis.com;
//   it is blocked like everything else and shows up in the run file;
// - frames are decoded by ffmpeg into memory and handed to the page one at a
//   time. No frame is written to disk;
// - the clip must pass assertLocalProcessingAllowed() (manifest entry, active
//   consent, stripped, sha256 intact) and the model file must match the
//   sha256 in models/models.json.
//
// Writes to <data dir>/derived/<clip ID>/ only (deleted by withdraw/retention):
//   mediapipe-<variant>.raw.json   all 33 landmarks per pose per frame
//   pose-mediapipe-<variant>.json  PoseSequence v1 (13 keypoints) via the adapter
//   pose-mediapipe-<variant>.run.json  provenance, timing, CPU/memory, network log
//
// Usage: node tools/caddie-eval/pose-local.mjs --clip C001-0001 [--variant full|heavy]
//          [--fps N] [--max-side 1280] [--max-frames 1200] [--num-poses 2] [--delegate CPU|GPU]
// Env: GOLFME_EVAL_DATA_DIR, GOLFME_EVAL_MODEL_DIR, GOLFME_EVAL_FFMPEG,
//      GOLFME_EVAL_CHROMIUM (browser binary), GOLFME_EVAL_CHROMIUM_LIB_DIR (extra
//      shared libraries for WSL; defaults to ~/.cache/golfme-chromium-libs/root/usr/lib/x86_64-linux-gnu if present).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { adaptMediaPipeRun, MEDIAPIPE_ADAPTER_VERSION } from "../../src/lib/caddie/v2/mediapipeAdapter.ts";
import { EvalError, assertLocalProcessingAllowed, auditEvent, defaultDataDir, todayIso, writeDataJson } from "./import-clip.mjs";
import { resolveVerifiedModel } from "./lib/models.mjs";
import { hardwareSummary, startResourceMonitor } from "./lib/resources.mjs";
import { DEFAULT_MAX_FRAMES, DEFAULT_MAX_SIDE, decodeFrames, planDecode, resolveFfmpeg } from "./lib/video.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
export const OFFLINE_ORIGIN = "http://caddie-eval.invalid";
export const RUN_SCHEMA = 1;
const MP_DIR = path.join(REPO, "node_modules", "@mediapipe", "tasks-vision");

const CONTENT_TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".task": "application/octet-stream" };

/** The fixed allowlist: URL path on the fake origin -> local file. */
export function buildAllowlist(modelPath) {
  const map = new Map();
  map.set("/index.html", path.join(HERE, "pose-page", "index.html"));
  map.set("/mp/vision_bundle.mjs", path.join(MP_DIR, "vision_bundle.mjs"));
  for (const f of fs.readdirSync(path.join(MP_DIR, "wasm"))) map.set(`/mp/wasm/${f}`, path.join(MP_DIR, "wasm", f));
  map.set("/model/pose.task", modelPath);
  return map;
}

/** Decides one request: serve from the allowlist, serve the current frame, or block. */
export function routeDecision(url, allowlist) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { action: "block", host: "unparseable" };
  }
  if (u.origin !== OFFLINE_ORIGIN) return { action: "block", host: u.protocol === "data:" ? "data:" : u.host || u.protocol };
  if (/^\/frame\/\d+$/.test(u.pathname)) return { action: "frame", index: Number(u.pathname.slice(7)) };
  const file = allowlist.get(u.pathname);
  return file ? { action: "file", file } : { action: "block", host: `${u.host}${u.pathname}` };
}

function chromiumLibDir(env) {
  if (env.GOLFME_EVAL_CHROMIUM_LIB_DIR) return env.GOLFME_EVAL_CHROMIUM_LIB_DIR;
  const def = path.join(os.homedir(), ".cache", "golfme-chromium-libs", "root", "usr", "lib", "x86_64-linux-gnu");
  return fs.existsSync(def) ? def : null;
}

/** Launches Chromium with every network path closed. */
export async function openOfflinePage({ modelPath, env = process.env }) {
  const libDir = chromiumLibDir(env);
  const launchEnv = { ...env };
  if (libDir) launchEnv.LD_LIBRARY_PATH = [libDir, env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  const browser = await chromium.launch({
    executablePath: env.GOLFME_EVAL_CHROMIUM || undefined,
    env: launchEnv,
    args: ["--host-resolver-rules=MAP * ~NOTFOUND", "--disable-background-networking", "--no-pings", "--disable-domain-reliability"],
  });
  const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
  const allowlist = buildAllowlist(modelPath);
  const network = { allowedRequests: 0, framesServed: 0, blocked: {}, blockedWebSockets: 0 };
  const frameSlot = { index: -1, rgba: null };
  await context.route("**/*", async (route) => {
    const d = routeDecision(route.request().url(), allowlist);
    if (d.action === "file") {
      network.allowedRequests++;
      return route.fulfill({ status: 200, body: fs.readFileSync(d.file), contentType: CONTENT_TYPES[path.extname(d.file)] ?? "application/octet-stream" });
    }
    if (d.action === "frame" && d.index === frameSlot.index && frameSlot.rgba) {
      network.framesServed++;
      return route.fulfill({ status: 200, body: frameSlot.rgba, contentType: "application/octet-stream" });
    }
    const host = d.host ?? "frame-mismatch";
    network.blocked[host] = (network.blocked[host] ?? 0) + 1;
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket(/.*/, (ws) => {
    network.blockedWebSockets++;
    ws.close();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(180_000);
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e).slice(0, 300)));
  await page.goto(`${OFFLINE_ORIGIN}/index.html`);
  await page.waitForFunction(() => window.__caddieReady === true);
  return { browser, page, network, frameSlot, consoleErrors, chromiumVersion: browser.version(), extraLibs: Boolean(libDir) };
}

export function summarizeMs(values) {
  if (!values.length) return { count: 0, mean: null, median: null, p95: null, max: null, min: null };
  const s = [...values].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
  const r = (v) => Math.round(v * 100) / 100;
  return { count: s.length, mean: r(s.reduce((a, b) => a + b, 0) / s.length), median: r(at(0.5)), p95: r(at(0.95)), max: r(s[s.length - 1]), min: r(s[0]) };
}

const round6 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);

/** The whole extraction for one clip. Returns the run summary (also written to disk). */
export async function extractPose(dataDir, clipId, opts = {}, env = process.env) {
  const variant = opts.variant ?? "full";
  const today = opts.today ?? todayIso();
  const tStart = process.hrtime.bigint();
  const { entry, file, derivedDir, layout } = await assertLocalProcessingAllowed(dataDir, clipId, { today });
  const model = await resolveVerifiedModel(variant, { env });
  const ffmpeg = resolveFfmpeg(env);
  const plan = planDecode(ffmpeg.bin, file, { fps: opts.fps ?? null, maxSide: opts.maxSide ?? DEFAULT_MAX_SIDE });
  const runtimeVersion = JSON.parse(fs.readFileSync(path.join(MP_DIR, "package.json"), "utf8")).version;

  const monitor = startResourceMonitor();
  let session;
  const rawFrames = [];
  const inferMs = [];
  const roundTripMs = [];
  const decodeStats = {};
  let init;
  try {
    session = await openOfflinePage({ modelPath: model.path, env });
    init = await session.page.evaluate((o) => window.__caddieInit(o), { numPoses: opts.numPoses ?? 2, delegate: opts.delegate ?? "CPU" });
    let lastTs = -1;
    for await (const f of decodeFrames(ffmpeg.bin, file, plan, { maxFrames: opts.maxFrames ?? DEFAULT_MAX_FRAMES, stats: decodeStats })) {
      session.frameSlot.index = f.index;
      session.frameSlot.rgba = f.rgba;
      // detectForVideo needs strictly increasing integer-ish millisecond timestamps.
      const timestampMs = Math.max(lastTs + 1, Math.round(f.timestampSeconds * 1000));
      lastTs = timestampMs;
      const t0 = process.hrtime.bigint();
      const r = await session.page.evaluate((a) => window.__caddieDetect(a), { index: f.index, timestampMs, width: plan.width, height: plan.height });
      roundTripMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
      inferMs.push(r.inferMs);
      rawFrames.push({
        frameIndex: f.index,
        timestampSeconds: round6(f.timestampSeconds),
        inferMs: Math.round(r.inferMs * 100) / 100,
        poses: r.poses.map((p) => p.map((l) => l.map(round6))),
      });
    }
    await session.page.evaluate(() => window.__caddieClose());
    // Give MediaPipe's logger flush (on close) a moment to hit the block list, so it is recorded.
    await new Promise((r) => setTimeout(r, 300));
  } finally {
    if (session) await session.browser.close();
  }
  const resources = monitor.stop();

  const raw = {
    schema: RUN_SCHEMA,
    clipId,
    model: model.info.file.replace(/\.task$/, ""),
    runtimeVersion,
    frameWidth: plan.width,
    frameHeight: plan.height,
    analysisFps: plan.analysisFps,
    framesRequested: rawFrames.length,
    frames: rawFrames,
  };
  const adapted = adaptMediaPipeRun(raw, { backendVersion: `${raw.model}@tasks-vision-${runtimeVersion}+sha256:${model.sha256.slice(0, 12)}` });
  if (adapted.status !== "ok") throw new EvalError(`adapter refused the run: ${adapted.invalidReason}`);

  const wallSeconds = Number(process.hrtime.bigint() - tStart) / 1e9;
  const n = rawFrames.length;
  const run = {
    schema: RUN_SCHEMA,
    tool: "tools/caddie-eval/pose-local.mjs",
    clipId,
    variant,
    createdOn: today,
    prototype: "local MediaPipe pose only. Not Caddie V1, not coaching output.",
    provenance: {
      runtime: `@mediapipe/tasks-vision@${runtimeVersion}`,
      model: model.info.file,
      modelSha256: model.sha256,
      modelUrl: model.info.url,
      adapterVersion: MEDIAPIPE_ADAPTER_VERSION,
      chromium: session?.chromiumVersion ?? null,
      chromiumExtraLibs: session?.extraLibs ?? false,
      ffmpeg: ffmpeg.version.slice(0, 80),
      delegate: opts.delegate ?? "CPU",
      numPoses: opts.numPoses ?? 2,
      wasm: init?.wasmFile ? path.basename(String(init.wasmFile)) : null,
    },
    clip: {
      captureIntent: { angle: entry.capture?.angle ?? null, handedness: entry.capture?.handedness ?? null, fps: entry.capture?.fps ?? null },
      source: plan.source,
    },
    decode: { analysisFps: plan.analysisFps, width: plan.width, height: plan.height, frames: n, truncated: decodeStats.truncated === true },
    adapterStats: adapted.stats,
    performance: {
      wallSecondsTotal: Math.round(wallSeconds * 1000) / 1000,
      modelLoadMs: init ? Math.round(init.loadMs) : null,
      inferenceMsPerFrame: summarizeMs(inferMs),
      roundTripMsPerFrame: summarizeMs(roundTripMs),
      wallMsPerFrame: n ? Math.round((wallSeconds * 1000 * 100) / n) / 100 : null,
      realtimeFactor: plan.source.durationSeconds ? Math.round((wallSeconds / plan.source.durationSeconds) * 100) / 100 : null,
      note: "inference = detectForVideo only; round trip adds frame transfer into the page. Wall total includes hashing, probing, browser start, and writing files.",
    },
    resources,
    hardware: hardwareSummary(),
    network: { ...session.network, pageErrors: session.consoleErrors },
  };

  writeDataJson(layout, path.join(derivedDir, `mediapipe-${variant}.raw.json`), raw);
  writeDataJson(layout, path.join(derivedDir, `pose-mediapipe-${variant}.json`), adapted.sequence);
  writeDataJson(layout, path.join(derivedDir, `pose-mediapipe-${variant}.run.json`), run);
  auditEvent(layout, { action: "pose_extracted_locally", clipId, variant, frames: n }, today);
  return run;
}

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      clip: { type: "string" },
      variant: { type: "string" },
      fps: { type: "string" },
      "max-side": { type: "string" },
      "max-frames": { type: "string" },
      "num-poses": { type: "string" },
      delegate: { type: "string" },
    },
  });
  if (!values.clip) throw new EvalError("--clip C001-0001 is required");
  const num = (v, name) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new EvalError(`${name} must be a positive number`);
    return n;
  };
  const delegate = values.delegate ?? "CPU";
  if (!["CPU", "GPU"].includes(delegate)) throw new EvalError("--delegate must be CPU or GPU");
  const run = await extractPose(defaultDataDir(), values.clip, {
    variant: values.variant ?? "full",
    fps: num(values.fps, "--fps") ?? null,
    maxSide: num(values["max-side"], "--max-side"),
    maxFrames: num(values["max-frames"], "--max-frames"),
    numPoses: num(values["num-poses"], "--num-poses"),
    delegate,
  });
  const p = run.performance;
  process.stdout.write(
    `${run.clipId} ${run.variant}: ${run.decode.frames} frames at ${run.decode.width}x${run.decode.height}, ${run.decode.analysisFps} fps\n` +
      `  inference ms/frame: median ${p.inferenceMsPerFrame.median}, p95 ${p.inferenceMsPerFrame.p95}; wall ${p.wallSecondsTotal} s\n` +
      `  frames with no pose: ${run.adapterStats.framesWithNoPose}; with several poses: ${run.adapterStats.framesWithMultiplePoses}\n` +
      `  network blocked: ${JSON.stringify(run.network.blocked)}\n` +
      `Next: node tools/caddie-eval/run-v2-checks.mjs --clip ${run.clipId} --variant ${run.variant}\n`,
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`pose-local: ${err instanceof EvalError ? err.message : `unexpected error: ${err?.stack ?? err}`}\n`);
      process.exit(1);
    },
  );
}

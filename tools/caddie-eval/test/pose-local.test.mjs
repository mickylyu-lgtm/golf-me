// node --test tools/caddie-eval/test/*.test.mjs
// Extractor plumbing: offline routing, ffmpeg banner parsing, frame
// chunking, resource parsing, model hash checks. No browser, no network, no
// real video. The real end-to-end run is opt-in (CADDIE_EVAL_SMOKE=1, see
// the last test) and uses a synthetic ffmpeg test pattern, never a person.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { EvalError, sha256File } from "../import-clip.mjs";
import { OFFLINE_ORIGIN, buildAllowlist, routeDecision, summarizeMs } from "../pose-local.mjs";
import { buildVideoFilter, chunkFrames, parseFfmpegProbe } from "../lib/video.mjs";
import { parseProcStat, parseStatusRss, processRole, startResourceMonitor } from "../lib/resources.mjs";
import { assertModelDirOutsideRepo, loadModelsManifest, resolveVerifiedModel } from "../lib/models.mjs";
import { tmp } from "./helpers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("offline routing: only the allowlist and the current frame are served; everything else is blocked", () => {
  const allow = buildAllowlist("/models/pose_landmarker_full.task");
  for (const p of ["/index.html", "/mp/vision_bundle.mjs", "/mp/wasm/vision_wasm_internal.wasm", "/model/pose.task"]) {
    assert.equal(routeDecision(`${OFFLINE_ORIGIN}${p}`, allow).action, "file", p);
  }
  assert.deepEqual(routeDecision(`${OFFLINE_ORIGIN}/frame/42`, allow), { action: "frame", index: 42 });
  assert.deepEqual(routeDecision("https://odml.pa.googleapis.com/v1/log", allow), { action: "block", host: "odml.pa.googleapis.com" });
  assert.equal(routeDecision("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm/x.wasm", allow).action, "block");
  assert.equal(routeDecision(`${OFFLINE_ORIGIN}/../../etc/passwd`, allow).action, "block");
  assert.equal(routeDecision(`${OFFLINE_ORIGIN}/frame/1/../../model/pose.task`, allow).action, "file", "URL normalization resolves .. before matching");
  assert.equal(routeDecision("file:///home/x/clip.mov", allow).action, "block");
  assert.equal(routeDecision("http://caddie-eval.invalid.attacker.com/index.html", allow).action, "block");
  assert.equal(routeDecision("not a url", allow).action, "block");
  for (const file of allow.values()) {
    if (!file.endsWith(".task")) assert.ok(fs.existsSync(file), `${file} exists (npm install done?)`);
  }
});

test("summarizeMs", () => {
  assert.deepEqual(summarizeMs([]), { count: 0, mean: null, median: null, p95: null, max: null, min: null });
  const s = summarizeMs([10, 20, 30, 40]);
  assert.equal(s.count, 4);
  assert.equal(s.mean, 25);
  assert.equal(s.max, 40);
});

const IPHONE_BANNER = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'C001-0001.mov':
  Duration: 00:00:07.48, start: 0.000000, bitrate: 15872 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 1920x1080, 15600 kb/s, 59.94 fps, 59.94 tbr, 600 tbn (default)
      Side data:
        displaymatrix: rotation of -90.00 degrees
Stream mapping:
  Stream #0:0 -> #0:0 (hevc (native) -> rawvideo (native))
Output #0, rawvideo, to '/dev/null':
  Stream #0:0(und): Video: rawvideo (RGBA / 0x41424752), rgba(pc, gbr/unknown/unknown, progressive), 720x1280, q=2-31, 2211840 kb/s, 59.94 fps, 59.94 tbn (default)
`;

test("ffmpeg banner parsing: size, fps, rotation, duration, decoded size", () => {
  const p = parseFfmpegProbe(IPHONE_BANNER);
  assert.equal(p.codec, "hevc");
  assert.deepEqual([p.inputWidth, p.inputHeight, p.inputFps], [1920, 1080, 59.94]);
  assert.equal(p.rotationDegrees, -90);
  assert.equal(p.durationSeconds, 7.48);
  assert.deepEqual([p.outputWidth, p.outputHeight], [720, 1280]);
  const none = parseFfmpegProbe("garbage");
  assert.equal(none.inputWidth, null);
  assert.equal(none.outputWidth, null);
});

test("video filter: fps then a long-side cap with even dimensions; rejects nonsense", () => {
  assert.equal(buildVideoFilter({ fps: 30, maxSide: 1280 }), "fps=30,scale=w='if(gte(iw,ih),min(1280,iw),-2)':h='if(gte(iw,ih),-2,min(1280,ih))':flags=area");
  assert.ok(!buildVideoFilter({ fps: null, maxSide: 640 }).includes("fps="));
  assert.throws(() => buildVideoFilter({ fps: 0, maxSide: 640 }), EvalError);
  assert.throws(() => buildVideoFilter({ fps: 30, maxSide: 10 }), EvalError);
  assert.throws(() => buildVideoFilter({ fps: "30;rm", maxSide: 640 }), EvalError);
});

test("frame chunking: reassembles frames across arbitrary chunk boundaries; refuses a partial tail", async () => {
  const frameBytes = 10;
  const data = Buffer.from(Array.from({ length: 30 }, (_, i) => i));
  const chunks = [data.subarray(0, 3), data.subarray(3, 17), data.subarray(17, 18), data.subarray(18)];
  const frames = [];
  for await (const f of chunkFrames(Readable.from(chunks), frameBytes)) frames.push([...f]);
  assert.equal(frames.length, 3);
  assert.deepEqual(frames[1], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  await assert.rejects(async () => {
    for await (const f of chunkFrames(Readable.from([data.subarray(0, 25)]), frameBytes)) void f;
  }, /mid-frame/);
});

test("/proc parsing: command names with spaces and parentheses; RSS; roles", () => {
  const stat = "4242 (chrome-headless (x) shell) S 4200 4242 4242 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 9 0 12345 1000 300";
  const p = parseProcStat(stat);
  assert.deepEqual([p.pid, p.comm, p.ppid, p.utimeTicks, p.stimeTicks], [4242, "chrome-headless (x) shell", 4200, 250, 50]);
  assert.equal(parseProcStat("nonsense"), null);
  assert.equal(parseStatusRss("Name:\tnode\nVmRSS:\t  123456 kB\n"), 123456 * 1024);
  assert.equal(parseStatusRss("Name:\tnode\n"), null);
  assert.equal(processRole("chrome-headless-shell"), "chromium");
  assert.equal(processRole("ffmpeg"), "ffmpeg");
  assert.equal(processRole("node"), "node");
});

test("resource monitor: reports wall, CPU, and peak memory without crashing", async () => {
  const m = startResourceMonitor({ intervalMs: 20 });
  let x = 0;
  for (let i = 0; i < 2e6; i++) x += i;
  await new Promise((r) => setTimeout(r, 60));
  const s = m.stop();
  assert.ok(x > 0);
  assert.ok(s.wallSeconds > 0);
  assert.ok(s.cpuSeconds.node > 0);
  assert.ok(s.peakRssBytes.node > 0);
  assert.ok(s.samples >= 2);
});

test("models: manifest pins Full and Heavy by sha256; a wrong or misplaced file is refused", async () => {
  const m = loadModelsManifest();
  assert.equal(m.runtime.version, "1.1.0");
  for (const v of ["full", "heavy"]) {
    assert.match(m.models[v].sha256, /^[0-9a-f]{64}$/);
    assert.ok(m.models[v].url.startsWith("https://storage.googleapis.com/mediapipe-models/pose_landmarker/"));
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, "..", "..", "..", "package.json"), "utf8"));
  assert.equal(pkg.devDependencies["@mediapipe/tasks-vision"], m.runtime.version, "manifest and package.json agree, exact pin");
  assert.ok(!("@mediapipe/tasks-vision" in (pkg.dependencies ?? {})), "never a runtime dependency");

  const dir = tmp("caddie-eval-models-");
  fs.writeFileSync(path.join(dir, m.models.full.file), "not the model");
  await assert.rejects(resolveVerifiedModel("full", { dir, manifest: m }), /does not match the sha256/);
  await assert.rejects(resolveVerifiedModel("heavy", { dir, manifest: m }), /model file missing/);
  await assert.rejects(resolveVerifiedModel("lite", { dir, manifest: m }), /unknown model variant/);
  const fake = { ...m, models: { full: { ...m.models.full, sha256: await sha256File(path.join(dir, m.models.full.file)) } } };
  assert.equal((await resolveVerifiedModel("full", { dir, manifest: fake })).variant, "full");
  assert.throws(() => assertModelDirOutsideRepo(HERE), /inside the GolfMe repo/);
});

// Opt-in end-to-end run: real headless Chromium + MediaPipe + model on a
// synthetic ffmpeg test pattern (no person in it). Needs the cached model
// files, Chromium, and ffmpeg. CADDIE_EVAL_SMOKE=1 node --test ...
test("smoke: extractor + runner end to end on a synthetic clip, offline", { skip: process.env.CADDIE_EVAL_SMOKE !== "1" }, async () => {
  const { resolveFfmpeg } = await import("../lib/video.mjs");
  const { initDataDir, addConsent, importClip, todayIso } = await import("../import-clip.mjs");
  const { extractPose } = await import("../pose-local.mjs");
  const { runV2ChecksForClip } = await import("../run-v2-checks.mjs");
  const { spawnSync } = await import("node:child_process");
  const ff = resolveFfmpeg().bin;
  const root = tmp("caddie-eval-smoke-");
  const src = path.join(root, "synthetic.mp4");
  const r = spawnSync(ff, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", src]);
  assert.equal(r.status, 0);
  const dataDir = path.join(root, "data");
  const today = todayIso();
  initDataDir(dataDir);
  addConsent(dataDir, { contributor: "C001", formVersion: "1.1", consentDate: today, retentionUntil: new Date(Date.parse(today) + 30 * 864e5).toISOString().slice(0, 10), adult: true, affirmativeConsent: true, coachViewing: false, remoteCoachViewing: false, thirdPartyRoboflow: false, thirdPartyGemini: false }, today);
  const e = await importClip(dataDir, { contributor: "C001", file: src, angle: "face_on", club: "driver", mount: "tripod", handedness: "right", lighting: "daylight", skill: "mid", conditions: ["no_swing"], requireStrip: true }, { GOLFME_EVAL_FFMPEG: ff, GOLFME_EVAL_FFPROBE: "/nonexistent" }, today);
  const run = await extractPose(dataDir, e.clipId, { variant: "full", today });
  assert.equal(run.decode.frames, 60);
  assert.equal(run.adapterStats.framesWithNoPose, 60, "a test pattern has no person");
  assert.equal(run.network.allowedRequests >= 4, true);
  for (const host of Object.keys(run.network.blocked)) assert.ok(!host.startsWith("caddie-eval.invalid"), `unexpected local miss ${host}`);
  assert.equal(run.network.externalRequestsAllowed, 0);
  for (const b of run.network.blockedRequests) assert.ok(run.network.expectedBlockedHosts.includes(b.host), `unexpected blocked host ${b.host}`);
  assert.equal(typeof run.network.osIsolation.isolated, "boolean", "isolation evidence recorded (true when run under unshare --net)");
  const checks = await runV2ChecksForClip(dataDir, e.clipId, { today });
  assert.equal(checks.qualityGate.status, "inconclusive");
});

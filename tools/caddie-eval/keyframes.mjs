#!/usr/bin/env node
// Caddie V2 key-frame export and local labeling (LOCAL_PILOT_WORKFLOW.md step 9).
//
// Micky labels the 13 body points on the address, top, impact, and finish
// frames as annotator K00. These are PROTOTYPE labels for measuring the local
// pose source, NOT validated ground truth. Rules:
// docs/caddie-v2/KEYFRAME_ANNOTATION_GUIDE.md.
//
// export  Decodes a stored clip with ffmpeg into JPEG frames under
//         <data dir>/derived/<clip ID>/frames/ (deleted by withdraw and
//         retention), on the SAME timeline as pose-local.mjs (same fps cap and
//         long-side cap), so frame N here is frame N of the pose run. Local clip only.
// label   Serves a labeling page on 127.0.0.1 only, for this clip's frames.
//         Open the printed URL in a private browser window. The page has no
//         external resources (CSP: 'self' only), shows NO model output (labels
//         stay blind), keeps nothing in browser storage, and saves through the
//         server, which validates every version and writes it append-only to
//         annotations/<clip ID>-K00.vNNN.json. A correction is a new version
//         with a reason. Every request needs the per-session token; the Host
//         header must be the loopback address (blocks DNS rebinding).
// list    Prints the versions for a clip.
// demo    The whole labeling flow on a throwaway synthetic test pattern (no
//         person) in a temp folder, deleted on exit. For practice and to check
//         the browser can reach the WSL loopback before pilot day.
//
// Usage: node tools/caddie-eval/keyframes.mjs export --clip C001-0001 [--max-side 1280] [--fps N] [--quality 3] [--force]
//        node tools/caddie-eval/keyframes.mjs label  --clip C001-0001 [--port 0]
//        node tools/caddie-eval/keyframes.mjs list   --clip C001-0001
//        node tools/caddie-eval/keyframes.mjs demo   [--port 0]
// Env: GOLFME_EVAL_DATA_DIR, GOLFME_EVAL_FFMPEG.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  EvalError,
  addAnnotator,
  addConsent,
  assertLocalProcessingAllowed,
  auditEvent,
  defaultDataDir,
  importClip,
  initDataDir,
  readAnnotator,
  todayIso,
  writeDataJson,
} from "./import-clip.mjs";
import {
  ANNOTATION_GUIDE_VERSION,
  ANNOTATION_KEYPOINTS,
  ANNOTATION_LABEL_STATUS,
  CORRECTION_REASONS,
  KEYFRAME_EVENTS,
  KEYFRAME_STATUSES,
  MAX_NOTE_CHARS,
  VISIBILITY_CODES,
  annotationFileName,
  buildNextVersion,
  readAnnotationChain,
  validateAnnotation,
} from "./lib/annotations.mjs";
import { DEFAULT_MAX_FRAMES, DEFAULT_MAX_SIDE, planDecode, resolveFfmpeg } from "./lib/video.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE_DIR = path.join(HERE, "label-page");
export const FRAMES_SCHEMA = 1;
export const FRAME_FILE_RE = /^frame-(\d{5})\.jpg$/;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function frameFileName(index) {
  return `frame-${String(index).padStart(5, "0")}.jpg`;
}

/**
 * Exports every analysis frame of one clip as JPEG into derived/<clip>/frames/.
 * Written to a temp folder next to it first, then renamed, so a failed export
 * leaves nothing half-done.
 */
export async function exportFrames(dataDir, clipId, opts = {}, env = process.env) {
  const today = opts.today ?? todayIso();
  const { file, derivedDir, layout } = await assertLocalProcessingAllowed(dataDir, clipId, { today });
  const quality = opts.quality ?? 3;
  if (!(Number.isInteger(quality) && quality >= 2 && quality <= 10)) throw new EvalError("--quality must be an integer 2 (best) to 10");
  const ffmpeg = resolveFfmpeg(env);
  const maxSide = opts.maxSide ?? DEFAULT_MAX_SIDE;
  const plan = planDecode(ffmpeg.bin, file, { fps: opts.fps ?? null, maxSide });
  const outDir = path.join(derivedDir, "frames");
  if (fs.existsSync(outDir)) {
    if (!opts.force) throw new EvalError(`${clipId}: frames already exported; pass --force to re-export (labels keep pointing at frame indices, so only re-export with the same settings)`);
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(derivedDir, { recursive: true, mode: 0o700 });
  const tmpDir = fs.mkdtempSync(path.join(derivedDir, ".frames-tmp-"));
  try {
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", file, "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", plan.filter,
      "-frames:v", String(opts.maxFrames ?? DEFAULT_MAX_FRAMES), "-q:v", String(quality), "-start_number", "0", "-f", "image2", path.join(tmpDir, "frame-%05d.jpg")];
    const r = await new Promise((resolve) => {
      const child = spawn(ffmpeg.bin, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (d) => {
        if (stderr.length < 4000) stderr += d;
      });
      child.on("close", (code) => resolve({ code, stderr }));
    });
    if (r.code !== 0) throw new EvalError(`ffmpeg frame export failed: ${r.stderr.trim().slice(0, 300)}`);
    const names = fs.readdirSync(tmpDir).filter((n) => FRAME_FILE_RE.test(n)).sort();
    if (!names.length) throw new EvalError("ffmpeg exported no frames");
    names.forEach((n, i) => {
      if (n !== frameFileName(i)) throw new EvalError("exported frames are not numbered 0..N-1");
      fs.chmodSync(path.join(tmpDir, n), 0o600);
    });
    fs.renameSync(tmpDir, outDir);
    fs.chmodSync(outDir, 0o700);
    const index = {
      schema: FRAMES_SCHEMA,
      tool: "tools/caddie-eval/keyframes.mjs export",
      clipId,
      createdOn: today,
      analysisFps: plan.analysisFps,
      frameWidth: plan.width,
      frameHeight: plan.height,
      frameCount: names.length,
      maxSide,
      jpegQuality: quality,
      filter: plan.filter,
      source: plan.source,
      note: "Frame N has t = N / analysisFps, the same timeline as pose-local.mjs with the same --fps / --max-side. Local only; deleted with the clip.",
    };
    writeDataJson(layout, path.join(outDir, "frames.json"), index);
    auditEvent(layout, { action: "keyframes_exported_locally", clipId, frames: names.length }, today);
    return index;
  } finally {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function readFramesIndex(derivedDir) {
  const file = path.join(derivedDir, "frames", "frames.json");
  if (!fs.existsSync(file)) throw new EvalError("no exported frames; run keyframes.mjs export first");
  const idx = JSON.parse(fs.readFileSync(file, "utf8"));
  if (idx.schema !== FRAMES_SCHEMA || !Number.isInteger(idx.frameCount) || idx.frameCount < 1) throw new EvalError("frames.json has an unknown shape");
  return idx;
}

/**
 * Validates a draft from the page and writes it as the next version.
 * The server, not the page, sets frame_source (from frames.json), version,
 * dates, and the correction block. Returns { version, file } or throws with
 * the problem list.
 */
export function saveAnnotationDraft(layout, clipId, annotatorId, body, framesIndex, today = todayIso()) {
  if (typeof body !== "object" || body === null) throw new EvalError("body must be a JSON object");
  const chain = readAnnotationChain(layout.annotations, clipId, annotatorId);
  if (chain.problems.length) throw new EvalError(`existing annotations are invalid; fix them first: ${chain.problems.join("; ")}`);
  const previous = chain.latest;
  const draft = {
    frame_source: {
      export_schema: framesIndex.schema,
      analysis_fps: framesIndex.analysisFps,
      frame_width: framesIndex.frameWidth,
      frame_height: framesIndex.frameHeight,
      frame_count: framesIndex.frameCount,
    },
    keyframes: body.keyframes,
  };
  const rec = buildNextVersion({ clipId, annotatorId, draft, previous, correction: body.correction, today });
  const problems = validateAnnotation(rec, { clipId, annotatorId, version: rec.version, previous });
  if (problems.length) {
    const err = new EvalError(`annotation refused: ${problems.length} problem(s)`);
    err.problems = problems;
    throw err;
  }
  fs.mkdirSync(layout.annotations, { recursive: true, mode: 0o700 });
  const file = path.join(layout.annotations, annotationFileName(clipId, annotatorId, rec.version));
  fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600, flag: "wx" }); // never overwrite a version
  auditEvent(layout, { action: rec.version === 1 ? "keyframe_annotation_saved" : "keyframe_annotation_corrected", clipId, annotatorId, version: rec.version }, today);
  return { version: rec.version, file: path.basename(file) };
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function tokenOk(given, token) {
  if (typeof given !== "string" || given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

/**
 * Starts the labeling server for one clip. Returns { url, port, token, close, refused }.
 * Bound to 127.0.0.1 only.
 */
export async function startLabelServer(dataDir, clipId, { annotatorId = "K00", port = 0, today = todayIso(), log = () => {} } = {}) {
  const { entry, derivedDir, layout } = await assertLocalProcessingAllowed(dataDir, clipId, { today });
  if (!readAnnotator(layout, annotatorId)) throw new EvalError(`no annotator record for ${annotatorId}; run: node tools/caddie-eval/import-clip.mjs annotator-add --annotator ${annotatorId}`);
  const framesIndex = readFramesIndex(derivedDir);
  const framesDir = path.join(derivedDir, "frames");
  const token = randomBytes(24).toString("hex");
  const refused = { count: 0, reasons: {} };
  let boundPort = null;
  let closeResolve;
  const closed = new Promise((r) => {
    closeResolve = r;
  });

  const send = (res, status, body, type = "application/json; charset=utf-8") => {
    res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type });
    res.end(body);
  };
  const refuse = (res, status, reason) => {
    refused.count++;
    refused.reasons[reason] = (refused.reasons[reason] ?? 0) + 1;
    log(`refused request: ${reason}`);
    send(res, status, JSON.stringify({ error: reason }));
  };
  const state = () => {
    const chain = readAnnotationChain(layout.annotations, clipId, annotatorId);
    return {
      clipId,
      annotatorId,
      labelStatus: ANNOTATION_LABEL_STATUS,
      guideVersion: ANNOTATION_GUIDE_VERSION,
      captureIntent: { angle: entry.capture?.angle ?? null, handedness: entry.capture?.handedness ?? null },
      frames: { count: framesIndex.frameCount, fps: framesIndex.analysisFps, width: framesIndex.frameWidth, height: framesIndex.frameHeight },
      keypoints: ANNOTATION_KEYPOINTS,
      events: KEYFRAME_EVENTS,
      statuses: KEYFRAME_STATUSES,
      visibilityCodes: VISIBILITY_CODES,
      correctionReasons: CORRECTION_REASONS,
      maxNoteChars: MAX_NOTE_CHARS,
      latest: chain.latest,
      versions: chain.versions.map((v) => ({ version: v.version, created_on: v.created_on, correction: v.correction })),
      chainProblems: chain.problems,
    };
  };

  const server = http.createServer((req, res) => {
    const allowedHosts = [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`];
    if (!allowedHosts.includes(req.headers.host ?? "")) return refuse(res, 421, "host header is not the loopback address");
    let u;
    try {
      u = new URL(req.url, `http://${req.headers.host}`);
    } catch {
      return refuse(res, 400, "bad URL");
    }
    if (req.method === "GET") {
      if (!tokenOk(u.searchParams.get("t"), token)) return refuse(res, 403, "missing or wrong session token");
      if (u.pathname === "/") {
        const html = fs.readFileSync(path.join(PAGE_DIR, "index.html"), "utf8").replaceAll("{{TOKEN}}", token);
        return send(res, 200, html, "text/html; charset=utf-8");
      }
      if (u.pathname === "/app.js") return send(res, 200, fs.readFileSync(path.join(PAGE_DIR, "app.js")), "text/javascript; charset=utf-8");
      if (u.pathname === "/app.css") return send(res, 200, fs.readFileSync(path.join(PAGE_DIR, "app.css")), "text/css; charset=utf-8");
      if (u.pathname === "/api/state") return send(res, 200, JSON.stringify(state()));
      const m = /^\/frames\/(frame-\d{5}\.jpg)$/.exec(u.pathname);
      if (m && Number(FRAME_FILE_RE.exec(m[1])[1]) < framesIndex.frameCount) {
        const f = path.join(framesDir, m[1]);
        if (fs.existsSync(f)) return send(res, 200, fs.readFileSync(f), "image/jpeg");
      }
      return refuse(res, 404, "not found");
    }
    if (req.method === "POST") {
      if (!tokenOk(req.headers["x-caddie-token"], token)) return refuse(res, 403, "missing or wrong session token header");
      const origin = req.headers.origin;
      if (origin !== undefined && !allowedHosts.map((h) => `http://${h}`).includes(origin)) return refuse(res, 403, "cross-origin request");
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return refuse(res, 415, "content-type must be application/json");
      const chunks = [];
      let size = 0;
      let aborted = false;
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY_BYTES && !aborted) {
          aborted = true;
          refuse(res, 413, "body too large");
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        if (aborted) return;
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return refuse(res, 400, "body is not JSON");
        }
        if (u.pathname === "/api/save") {
          try {
            const r = saveAnnotationDraft(layout, clipId, annotatorId, body, framesIndex, today);
            log(`saved ${r.file}`);
            return send(res, 200, JSON.stringify({ ok: true, ...r }));
          } catch (err) {
            if (!(err instanceof EvalError)) throw err;
            return send(res, 422, JSON.stringify({ ok: false, error: err.message, problems: err.problems ?? [] }));
          }
        }
        if (u.pathname === "/api/done") {
          send(res, 200, JSON.stringify({ ok: true }));
          setImmediate(() => close());
          return;
        }
        return refuse(res, 404, "not found");
      });
      return;
    }
    return refuse(res, 405, "method not allowed");
  });

  const close = () =>
    new Promise((resolve) => {
      server.close(() => {
        closeResolve();
        resolve();
      });
      server.closeAllConnections?.();
    });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  boundPort = server.address().port;
  return { url: `http://127.0.0.1:${boundPort}/?t=${token}`, port: boundPort, token, close, closed, refused };
}

function versionsSummary(dataDir, clipId, annotatorId = "K00") {
  const chain = readAnnotationChain(path.join(dataDir, "annotations"), clipId, annotatorId);
  return {
    clipId,
    annotatorId,
    labelStatus: ANNOTATION_LABEL_STATUS,
    versions: chain.versions.map((v) => ({
      version: v.version,
      created_on: v.created_on,
      correction: v.correction,
      keyframes: Object.fromEntries(KEYFRAME_EVENTS.map((e) => [e, v.keyframes[e]?.status === "labeled" ? `frame ${v.keyframes[e].frame_index}` : v.keyframes[e]?.status])),
    })),
    latestVersion: chain.latest?.version ?? null,
    problems: chain.problems,
  };
}

async function runServer(dataDir, clipId, port, today) {
  const s = await startLabelServer(dataDir, clipId, { port, today, log: (m) => process.stdout.write(`  ${m}\n`) });
  process.stdout.write(
    `Labeling ${clipId} as K00 (PROTOTYPE labels, not validated ground truth).\n` +
      `Open this in a PRIVATE browser window (no extensions), on this computer only:\n\n  ${s.url}\n\n` +
      "Served on 127.0.0.1 only. Press Done on the page, or Ctrl-C here, to stop.\n",
  );
  const stop = () => s.close();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await s.closed;
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  if (s.refused.count) process.stdout.write(`Refused ${s.refused.count} request(s): ${JSON.stringify(s.refused.reasons)}\n`);
  process.stdout.write("Stopped.\n");
}

/** Throwaway synthetic data folder for practice. Returns { dataDir, clipId, cleanup }. */
export async function makeDemoDataDir(env = process.env) {
  const ff = resolveFfmpeg(env).bin;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "caddie-keyframes-demo-")));
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    const src = path.join(root, "synthetic.mp4");
    const r = spawnSync(ff, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", src]);
    if (r.status !== 0) throw new EvalError("could not make the synthetic demo clip");
    const dataDir = path.join(root, "data");
    const today = todayIso();
    initDataDir(dataDir);
    addConsent(dataDir, { contributor: "C001", formVersion: "1.1", consentDate: today, retentionUntil: new Date(Date.parse(today) + 864e5).toISOString().slice(0, 10), adult: true, affirmativeConsent: true, coachViewing: false, remoteCoachViewing: false, thirdPartyRoboflow: false, thirdPartyGemini: false }, today);
    const e = await importClip(dataDir, { contributor: "C001", file: src, angle: "face_on", club: "driver", mount: "tripod", handedness: "right", lighting: "daylight", skill: "mid", conditions: ["no_swing"], requireStrip: true }, { ...env, GOLFME_EVAL_FFMPEG: ff, GOLFME_EVAL_FFPROBE: "/nonexistent" }, today);
    addAnnotator(dataDir, "K00", today);
    await exportFrames(dataDir, e.clipId, { today }, { ...env, GOLFME_EVAL_FFMPEG: ff });
    return { dataDir, clipId: e.clipId, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

async function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      clip: { type: "string" },
      "max-side": { type: "string" },
      fps: { type: "string" },
      quality: { type: "string" },
      force: { type: "boolean" },
      port: { type: "string" },
    },
  });
  const num = (v, name) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new EvalError(`${name} must be a number`);
    return n;
  };
  const dataDir = defaultDataDir();
  const port = num(values.port, "--port") ?? 0;
  switch (command) {
    case "export": {
      if (!values.clip) throw new EvalError("--clip C001-0001 is required");
      const idx = await exportFrames(dataDir, values.clip, { maxSide: num(values["max-side"], "--max-side"), fps: num(values.fps, "--fps") ?? null, quality: num(values.quality, "--quality"), force: values.force === true });
      process.stdout.write(`${idx.clipId}: exported ${idx.frameCount} frames at ${idx.frameWidth}x${idx.frameHeight}, ${idx.analysisFps} fps, into derived/${idx.clipId}/frames/\nNext: node tools/caddie-eval/keyframes.mjs label --clip ${idx.clipId}\n`);
      return 0;
    }
    case "label":
      if (!values.clip) throw new EvalError("--clip C001-0001 is required");
      await runServer(dataDir, values.clip, port, todayIso());
      return 0;
    case "list":
      if (!values.clip) throw new EvalError("--clip C001-0001 is required");
      process.stdout.write(`${JSON.stringify(versionsSummary(dataDir, values.clip), null, 2)}\n`);
      return 0;
    case "demo": {
      const demo = await makeDemoDataDir();
      process.stdout.write("DEMO: a synthetic test pattern (no person) in a temp folder, deleted when you stop.\n");
      try {
        await runServer(demo.dataDir, demo.clipId, port, todayIso());
        process.stdout.write(`${JSON.stringify(versionsSummary(demo.dataDir, demo.clipId), null, 2)}\n`);
      } finally {
        demo.cleanup();
      }
      return 0;
    }
    default:
      process.stdout.write("Commands: export | label | list | demo. See the header of this file.\n");
      return command ? 2 : 0;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`keyframes: ${err instanceof EvalError ? err.message : `unexpected error: ${err?.stack ?? err}`}\n`);
      if (err?.problems?.length) process.stderr.write(`${err.problems.join("\n")}\n`);
      process.exit(1);
    },
  );
}

// node --test tools/caddie-eval/test/*.test.mjs
// K00 prototype key-frame annotations: format, versioning and corrections,
// annotator records, verify and withdrawal, the local labeling server, and
// scoring against them. Temp folders and synthetic stick figures only. No
// browser, no network beyond a loopback socket the test opens itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { POSE_KEYPOINT_NAMES } from "../../../src/lib/caddie/v2/types.ts";
import { addAnnotator, addCoach, verifyDataDir, withdrawContributor } from "../import-clip.mjs";
import {
  ANNOTATION_KEYPOINTS,
  ANNOTATION_LABEL_STATUS,
  annotationFileName,
  annotationToScorerLabels,
  buildNextVersion,
  readAnnotationChain,
  validateAnnotation,
} from "../lib/annotations.mjs";
import { scoreKeyframePredictions } from "../lib/keyframeAccuracy.mjs";
import { saveAnnotationDraft, startLabelServer } from "../keyframes.mjs";
import { scoreClip } from "../pose-accuracy.mjs";
import { POSES, TODAY, setupWithClip, writeSyntheticPose } from "./helpers.mjs";

const FRAME_SOURCE = { export_schema: 1, analysis_fps: 30, frame_width: 720, frame_height: 1280, frame_count: 12 };
const FRAMES_INDEX = { schema: 1, analysisFps: 30, frameWidth: 720, frameHeight: 1280, frameCount: 12 };

/** Points where writeSyntheticPose puts the stick figure (helpers.mjs: 200 + 2x, 300 + 2y). */
function pointsFrom(figure, overrides = {}) {
  const pts = {};
  for (const n of ANNOTATION_KEYPOINTS) {
    const [px, py] = figure[n];
    pts[n] = { v: "visible", x: 200 + px * 2, y: 300 + py * 2 };
  }
  return { ...pts, ...overrides };
}

function keyframes(figure, overrides = {}) {
  return {
    address: { status: "labeled", frame_index: 1, t: 1 / 30, points: pointsFrom(figure) },
    top: { status: "labeled", frame_index: 4, t: 4 / 30, points: pointsFrom(figure, { right_wrist: { v: "not_visible" } }) },
    impact: { status: "cant_tell" },
    finish: { status: "labeled", frame_index: 10, t: 10 / 30, points: pointsFrom(figure, { left_hip: { v: "occluded", x: 250, y: 500 } }) },
    ...overrides,
  };
}

function v1(clipId, kf) {
  return buildNextVersion({ clipId, annotatorId: "K00", draft: { frame_source: FRAME_SOURCE, keyframes: kf }, previous: null, today: TODAY });
}

test("annotation keypoints match the PoseSequence contract", () => {
  assert.deepEqual([...ANNOTATION_KEYPOINTS], [...POSE_KEYPOINT_NAMES]);
});

test("annotation format: a complete version 1 is valid and says it is a prototype label", () => {
  const rec = v1("C001-0001", keyframes(POSES.FACE_ON_ADDRESS));
  assert.deepEqual(validateAnnotation(rec, { clipId: "C001-0001", annotatorId: "K00", version: 1 }), []);
  assert.equal(rec.label_status, ANNOTATION_LABEL_STATUS);
  assert.equal(rec.correction, null);
});

test("annotation format: refuses guessed positions, missing points, bad frames, wrong order, extra fields", () => {
  const ok = keyframes(POSES.FACE_ON_ADDRESS);
  const bad = (kf, re, extra = {}) => {
    const rec = { ...v1("C001-0001", kf), ...extra };
    const p = validateAnnotation(rec, { clipId: "C001-0001", annotatorId: "K00", version: 1 });
    assert.ok(p.some((x) => re.test(x)), `${re} in ${p.join(" | ")}`);
  };
  bad({ ...ok, top: { ...ok.top, points: { ...ok.top.points, right_wrist: { v: "not_visible", x: 1, y: 2 } } } }, /must not have x or y/);
  const { nose: _nose, ...noNose } = ok.address.points;
  bad({ ...ok, address: { ...ok.address, points: noNose } }, /nose missing/);
  bad({ ...ok, address: { ...ok.address, points: { ...ok.address.points, nose: { v: "visible", x: 800, y: 10 } } } }, /outside the frame/);
  bad({ ...ok, address: { ...ok.address, points: { ...ok.address.points, nose: { v: "maybe" } } } }, /must be one of/);
  bad({ ...ok, address: { ...ok.address, frame_index: 12, t: 12 / 30 } }, /exported frame/);
  bad({ ...ok, address: { ...ok.address, t: 0.5 } }, /t must equal/);
  bad({ ...ok, top: { ...ok.top, frame_index: 0, t: 0 } }, /swing order/);
  bad({ ...ok, impact: { status: "cant_tell", frame_index: 3 } }, /must not carry/);
  const { finish: _f, ...noFinish } = ok;
  bad(noFinish, /finish missing/);
  bad(ok, /unexpected field "golfer_name"/, { golfer_name: "x" });
  bad(ok, /label_status/, { label_status: "ground_truth" });
  bad(ok, /annotator_id/, { annotator_id: "K01" });
});

test("corrections: version 2+ needs a reason, the previous version number, and a date not before it", () => {
  const first = v1("C001-0001", keyframes(POSES.FACE_ON_ADDRESS));
  const second = buildNextVersion({ clipId: "C001-0001", annotatorId: "K00", draft: { frame_source: FRAME_SOURCE, keyframes: keyframes(POSES.FACE_ON_ADDRESS) }, previous: first, correction: { reason: "misplaced_point", note: "" }, today: TODAY });
  assert.equal(second.version, 2);
  assert.deepEqual(validateAnnotation(second, { version: 2, previous: first }), []);
  const p = (rec) => validateAnnotation(rec, { version: rec.version, previous: first }).join(" | ");
  assert.match(p({ ...second, correction: null }), /needs a correction block/);
  assert.match(p({ ...second, correction: { ...second.correction, reason: "felt_like_it" } }), /reason must be one of/);
  assert.match(p({ ...second, correction: { ...second.correction, reason: "other", note: "  " } }), /required for "other"/);
  assert.match(p({ ...second, correction: { ...second.correction, note: "x".repeat(201) } }), /at most 200/);
  assert.match(p({ ...second, correction: { ...second.correction, supersedes_version: 5 } }), /supersedes_version/);
  assert.match(p({ ...second, correction: { ...second.correction, date: "2026-01-01" } }), /dated before/);
  assert.match(validateAnnotation({ ...first, correction: second.correction }, { version: 1 }).join(" | "), /version 1 must have correction: null/);
});

test("annotator K00: own record type, never a coach; verify needs it for annotation files", async () => {
  const { dataDir, clipId } = await setupWithClip();
  assert.throws(() => addCoach(dataDir, { coach: "K00", agreementVersion: "1.0", agreementDate: TODAY, agreementSigned: true, inPerson: true, remote: false }, TODAY), /reserved/);
  assert.throws(() => addAnnotator(dataDir, "K01", TODAY), /annotatorId must be one of/);
  const dir = path.join(dataDir, "annotations");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, annotationFileName(clipId, "K00", 1)), JSON.stringify(v1(clipId, keyframes(POSES.FACE_ON_ADDRESS))));
  assert.ok((await verifyDataDir(dataDir, TODAY)).some((p) => /no annotator record for K00/.test(p)));
  const rec = addAnnotator(dataDir, "K00", TODAY);
  assert.equal(rec.role, "owner_prototype_annotator");
  assert.throws(() => addAnnotator(dataDir, "K00", TODAY), /already has an annotator record/);
  assert.ok(!(await verifyDataDir(dataDir, TODAY)).some((p) => p.startsWith("annotations/")), "valid chain passes verify");
  fs.writeFileSync(path.join(dir, annotationFileName(clipId, "K00", 3)), "{}");
  assert.ok((await verifyDataDir(dataDir, TODAY)).some((p) => /without gaps/.test(p)));
  fs.writeFileSync(path.join(dir, "C001-0001-K00.json"), "{}");
  assert.ok((await verifyDataDir(dataDir, TODAY)).some((p) => /name must be/.test(p)));
});

test("saving: server-side versions are append-only, frame_source comes from the export, corrections need a reason", async () => {
  const { dataDir, clipId } = await setupWithClip();
  addAnnotator(dataDir, "K00", TODAY);
  const layout = { annotations: path.join(dataDir, "annotations"), root: dataDir, auditLog: path.join(dataDir, "audit-log.jsonl") };
  const kf = keyframes(POSES.FACE_ON_ADDRESS);
  const r1 = saveAnnotationDraft(layout, clipId, "K00", { keyframes: kf }, FRAMES_INDEX, TODAY);
  assert.deepEqual(r1, { version: 1, file: `${clipId}-K00.v001.json` });
  assert.throws(() => saveAnnotationDraft(layout, clipId, "K00", { keyframes: kf }, FRAMES_INDEX, TODAY), (e) => e.problems.some((p) => /correction/.test(p)));
  const moved = { ...kf, address: { ...kf.address, points: { ...kf.address.points, nose: { v: "visible", x: 1, y: 1 } } } };
  const r2 = saveAnnotationDraft(layout, clipId, "K00", { keyframes: moved, correction: { reason: "misplaced_point", note: "" }, frame_source: { frame_width: 1 } }, FRAMES_INDEX, TODAY);
  assert.equal(r2.version, 2);
  const chain = readAnnotationChain(layout.annotations, clipId, "K00");
  assert.equal(chain.versions.length, 2);
  assert.equal(chain.latest.keyframes.address.points.nose.x, 1);
  assert.equal(chain.latest.frame_source.frame_width, 720, "the page cannot set frame_source");
  assert.equal(chain.versions[0].keyframes.address.points.nose.x, kf.address.points.nose.x, "version 1 untouched");
  const log = fs.readFileSync(layout.auditLog, "utf8");
  assert.match(log, /keyframe_annotation_corrected/);
  assert.ok(!log.includes("misplaced_point"), "audit log holds IDs and actions only");
});

test("withdrawal deletes annotations and any report naming the clip", async () => {
  const { dataDir, clipId } = await setupWithClip();
  addAnnotator(dataDir, "K00", TODAY);
  const dir = path.join(dataDir, "annotations");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, annotationFileName(clipId, "K00", 1)), "{}");
  fs.mkdirSync(path.join(dataDir, "reports"));
  fs.writeFileSync(path.join(dataDir, "reports", "pilot-report-full-2026-10-21.md"), `| ${clipId} | 0.9 |`);
  fs.writeFileSync(path.join(dataDir, "reports", "other.md"), "no clip here");
  const r = withdrawContributor(dataDir, "C001", { confirm: true }, TODAY);
  assert.ok(r.removed.includes(`annotations/${clipId}-K00.v001.json`));
  assert.ok(r.removed.includes("reports/pilot-report-full-2026-10-21.md"));
  assert.ok(fs.existsSync(path.join(dataDir, "reports", "other.md")));
});

test("pose accuracy vs K00: uses the latest version; occluded labels are scored apart from PCK; finish is a key frame", async () => {
  const { dataDir, clipId } = await setupWithClip();
  addAnnotator(dataDir, "K00", TODAY);
  writeSyntheticPose(dataDir, clipId, POSES.FACE_ON_ADDRESS);
  const layout = { annotations: path.join(dataDir, "annotations"), root: dataDir, auditLog: path.join(dataDir, "audit-log.jsonl") };
  const kf = keyframes(POSES.FACE_ON_ADDRESS);
  saveAnnotationDraft(layout, clipId, "K00", { keyframes: kf }, FRAMES_INDEX, TODAY);
  let r = await scoreClip(dataDir, clipId, "K00", { today: TODAY });
  assert.equal(r.labelSource.kind, "prototype_annotation");
  assert.equal(r.labelSource.labelStatus, ANNOTATION_LABEL_STATUS);
  assert.equal(r.labelSource.version, 1);
  assert.equal(r.framesScored, 3);
  assert.equal(r.overall.pck01, 1);
  assert.equal(r.raw.overall.labeledOccluded, 1);
  assert.equal(r.overall.occludedConfidentRate, 1);
  assert.equal(r.raw.overall.labeledVisible, 13 + 12 + 12);
  assert.equal(r.overall.falseObservationRate, 1, "the synthetic figure reports the hidden wrist confidently");
  assert.equal(r.byPhase.finish.labeledVisible, 12);
  assert.equal(r.framesTorsoFromEstimate, 1, "finish used an estimated hip for the torso");
  // A correction that moves every address point far away: the scorer follows the latest version.
  const far = Object.fromEntries(ANNOTATION_KEYPOINTS.map((n) => [n, { v: "visible", x: 700, y: 1200 }]));
  far.left_shoulder = { v: "visible", x: 600, y: 900 };
  far.right_shoulder = { v: "visible", x: 640, y: 900 };
  saveAnnotationDraft(layout, clipId, "K00", { keyframes: { ...kf, address: { ...kf.address, points: far } }, correction: { reason: "misplaced_point", note: "" } }, FRAMES_INDEX, TODAY);
  r = await scoreClip(dataDir, clipId, "K00", { today: TODAY });
  assert.equal(r.labelSource.version, 2);
  assert.ok(r.byPhase.address.pck02 < 0.5);
  const converted = annotationToScorerLabels(readAnnotationChain(layout.annotations, clipId, "K00").latest);
  assert.deepEqual(converted.frames.map((f) => f.phase), ["address", "top", "finish"]);
});

test("key-frame accuracy scorer (for a future detector): ms and frame tolerance, misses counted, exclusions counted", () => {
  const truth = v1("C001-0001", keyframes(POSES.FACE_ON_ADDRESS));
  const r = scoreKeyframePredictions({ events: { address: { frame_index: 3 }, top: { frame_index: 4 }, impact: { frame_index: 7 } } }, truth);
  assert.equal(r.toleranceMs, 67);
  assert.deepEqual([r.byEvent.address.withinTolerance, r.byEvent.address.errorsFrames[0], r.byEvent.address.errorsMs[0]], [1, 2, 66.7]);
  assert.equal(r.byEvent.top.withinOneFrame, 1);
  assert.equal(r.byEvent.impact.excluded, 1, "K00 said cant_tell");
  assert.equal(r.byEvent.finish.missing, 1);
  const far = scoreKeyframePredictions({ events: { address: { frame_index: 4 } } }, truth);
  assert.equal(far.byEvent.address.withinTolerance, 0);
});

function request(port, { method = "GET", pathName = "/", host, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: pathName, headers: { host: host ?? `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("labeling server: loopback only, token on every request, host and origin checks, strict headers, saves validated versions", async () => {
  const { dataDir, clipId } = await setupWithClip();
  addAnnotator(dataDir, "K00", TODAY);
  const framesDir = path.join(dataDir, "derived", clipId, "frames");
  fs.mkdirSync(framesDir, { recursive: true });
  fs.writeFileSync(path.join(framesDir, "frames.json"), JSON.stringify({ schema: 1, analysisFps: 30, frameWidth: 720, frameHeight: 1280, frameCount: 12 }));
  fs.writeFileSync(path.join(framesDir, "frame-00000.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const s = await startLabelServer(dataDir, clipId, { today: TODAY });
  try {
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]{48}$/);
    const t = s.token;
    assert.equal((await request(s.port, { pathName: "/" })).status, 403);
    assert.equal((await request(s.port, { pathName: `/?t=${"0".repeat(48)}` })).status, 403);
    assert.equal((await request(s.port, { pathName: `/?t=${t}`, host: "evil.example" })).status, 421, "DNS rebinding blocked");
    const page = await request(s.port, { pathName: `/?t=${t}` });
    assert.equal(page.status, 200);
    assert.match(page.headers["content-security-policy"], /default-src 'none'/);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.ok(page.body.includes(`data-token="${t}"`) && !page.body.includes("{{TOKEN}}"));
    assert.ok(!/https?:\/\//.test(page.body.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "")), "page references nothing external");
    for (const f of ["app.js", "app.css"]) assert.equal((await request(s.port, { pathName: `/${f}?t=${t}` })).status, 200);
    assert.equal((await request(s.port, { pathName: `/frames/frame-00000.jpg?t=${t}` })).headers["content-type"], "image/jpeg");
    assert.equal((await request(s.port, { pathName: `/frames/frame-00099.jpg?t=${t}` })).status, 404);
    assert.equal((await request(s.port, { pathName: `/frames/..%2f..%2fmanifest.json?t=${t}` })).status, 404);
    const state = JSON.parse((await request(s.port, { pathName: `/api/state?t=${t}` })).body);
    assert.equal(state.labelStatus, ANNOTATION_LABEL_STATUS);
    assert.equal(state.latest, null);
    assert.ok(!JSON.stringify(state).includes("pose"), "no model output reaches the labeling page");

    const body = JSON.stringify({ keyframes: keyframes(POSES.FACE_ON_ADDRESS) });
    const json = { "content-type": "application/json" };
    assert.equal((await request(s.port, { method: "POST", pathName: `/api/save?t=${t}`, headers: json, body })).status, 403, "POST needs the header token");
    assert.equal((await request(s.port, { method: "POST", pathName: "/api/save", headers: { ...json, "x-caddie-token": t, origin: "https://evil.example" }, body })).status, 403);
    assert.equal((await request(s.port, { method: "POST", pathName: "/api/save", headers: { "content-type": "text/plain", "x-caddie-token": t }, body })).status, 415);
    const saved = await request(s.port, { method: "POST", pathName: "/api/save", headers: { ...json, "x-caddie-token": t, origin: `http://127.0.0.1:${s.port}` }, body });
    assert.equal(saved.status, 200);
    assert.equal(JSON.parse(saved.body).version, 1);
    const refusedSave = await request(s.port, { method: "POST", pathName: "/api/save", headers: { ...json, "x-caddie-token": t }, body: JSON.stringify({ keyframes: {} }) });
    assert.equal(refusedSave.status, 422);
    assert.ok(JSON.parse(refusedSave.body).problems.length > 0);
    assert.equal((await request(s.port, { method: "DELETE", pathName: `/?t=${t}` })).status, 405);
    assert.ok(s.refused.count >= 6);
    await request(s.port, { method: "POST", pathName: "/api/done", headers: { ...json, "x-caddie-token": t }, body: "{}" });
    await s.closed;
  } finally {
    await s.close().catch(() => {});
  }
  assert.ok(fs.existsSync(path.join(dataDir, "annotations", `${clipId}-K00.v001.json`)));
});

test("labeling server refuses without an annotator record or exported frames", async () => {
  const { dataDir, clipId } = await setupWithClip();
  await assert.rejects(startLabelServer(dataDir, clipId, { today: TODAY }), /no annotator record for K00/);
  addAnnotator(dataDir, "K00", TODAY);
  await assert.rejects(startLabelServer(dataDir, clipId, { today: TODAY }), /no exported frames/);
});

// Opt-in: real ffmpeg on a synthetic test pattern (no person).
test("smoke: frame export matches the pose timeline (frame N at N / fps)", { skip: process.env.CADDIE_EVAL_SMOKE !== "1" }, async () => {
  const { makeDemoDataDir, readFramesIndex } = await import("../keyframes.mjs");
  const demo = await makeDemoDataDir();
  try {
    const idx = readFramesIndex(path.join(demo.dataDir, "derived", demo.clipId));
    assert.equal(idx.frameCount, 90);
    assert.deepEqual([idx.frameWidth, idx.frameHeight, idx.analysisFps], [720, 1280, 30]);
    const names = fs.readdirSync(path.join(demo.dataDir, "derived", demo.clipId, "frames")).filter((n) => n.endsWith(".jpg"));
    assert.equal(names.length, 90);
    assert.equal(names.sort()[0], "frame-00000.jpg");
  } finally {
    demo.cleanup();
  }
});

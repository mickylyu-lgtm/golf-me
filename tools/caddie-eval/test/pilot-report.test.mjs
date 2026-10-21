// node --test tools/caddie-eval/test/*.test.mjs
// The pilot report harness: "no data" with nothing behind it, numbers only
// from run files, offline verdicts, view split. Synthetic data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addAnnotator, addConsent, importClip, initDataDir } from "../import-clip.mjs";
import { buildPilotReport, detectionStats, offlineVerdict } from "../pilot-report.mjs";
import { saveAnnotationDraft } from "../keyframes.mjs";
import { runV2ChecksForClip } from "../run-v2-checks.mjs";
import { bootstrapCi, quantile, wilson } from "../lib/stats.mjs";
import { ANNOTATION_KEYPOINTS } from "../lib/annotations.mjs";
import { NO_FFMPEG, POSES, TODAY, fakeVideo, setupWithClip, tmp, writeSyntheticPose } from "./helpers.mjs";

function fakeRun({ blocked = { "odml.pa.googleapis.com": 1 }, isolated = true, external = 0, wall = 7.5 } = {}) {
  return {
    schema: 1,
    performance: { modelLoadMs: 600, inferenceMsPerFrame: { median: 14 }, roundTripMsPerFrame: { median: 60 }, wallSecondsTotal: wall, realtimeFactor: 2.5 },
    resources: { cpuSeconds: { total: 9 }, avgCoresBusy: 1.2, peakRssBytes: { total: 1.8 * 1048576 * 1024, chromium: 1.2 * 1048576 * 1024 } },
    hardware: { cpuModel: "Synthetic CPU", logicalCores: 8, totalMemoryBytes: 16 * 1073741824, wsl: true, node: "v24" },
    provenance: { chromium: "151", delegate: "CPU" },
    network: { allowedRequests: 5, framesServed: 12, externalRequestsAllowed: external, blocked, blockedWebSockets: 0, osIsolation: isolated === null ? undefined : { netns: isolated, nonLoopbackInterfaces: isolated ? 0 : 1, isolated } },
  };
}

function writeRun(dataDir, clipId, run) {
  fs.writeFileSync(path.join(dataDir, "derived", clipId, "pose-mediapipe-full.run.json"), JSON.stringify(run));
}

test("stats: Wilson interval, quantiles, deterministic bootstrap", () => {
  assert.equal(wilson(0, 0), null);
  const [lo, hi] = wilson(8, 10);
  assert.ok(Math.abs(lo - 0.4902) < 0.001 && Math.abs(hi - 0.9433) < 0.001);
  assert.equal(quantile([3, 1, 2], 0.5), 2);
  assert.equal(quantile([], 0.5), null);
  assert.equal(bootstrapCi([1]), null);
  assert.deepEqual(bootstrapCi([1, 2, 3, 4]), bootstrapCi([1, 2, 3, 4]));
});

test("offline verdicts: isolated + only expected blocks = verified; anything else says why", () => {
  assert.match(offlineVerdict(fakeRun()).verdict, /^offline verified/);
  assert.match(offlineVerdict(fakeRun({ isolated: false })).verdict, /NOT OS-isolated/);
  assert.match(offlineVerdict(fakeRun({ isolated: null })).verdict, /OS isolation not recorded/);
  const odd = offlineVerdict(fakeRun({ blocked: { "odml.pa.googleapis.com": 1, "example.com": 2 } }));
  assert.match(odd.verdict, /UNEXPECTED/);
  assert.deepEqual(odd.unexpectedHosts, ["example.com"]);
  assert.match(offlineVerdict(fakeRun({ external: 1 })).verdict, /^FAILED/);
  assert.match(offlineVerdict({ network: { blocked: {} } }).verdict, /predates/);
  assert.equal(offlineVerdict({}).verdict, "not recorded");
});

test("report with no data: every measurement cell says 'no data'; key frames say 'not implemented'", async () => {
  const root = tmp("caddie-eval-report-");
  const dataDir = path.join(root, "data");
  initDataDir(dataDir);
  const { markdown, report } = await buildPilotReport(dataDir, { today: TODAY });
  assert.equal(report.clips.length, 0);
  assert.match(markdown, /## §0 Offline check \(per pose run\)\n\nno data/);
  assert.match(markdown, /Key-frame identification\n\n\*\*Not implemented\.\*\*/);
  // No measured number anywhere in the measurement tables.
  for (const section of ["§5 Pose accuracy", "§5a", "§8a", "§8b"]) {
    const start = markdown.indexOf(`## ${section}`);
    const body = markdown.slice(start, markdown.indexOf("\n## ", start + 4) === -1 ? undefined : markdown.indexOf("\n## ", start + 4));
    const rows = body.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Point group") && !l.startsWith("| Keypoint") && !l.startsWith("| Measure") && !l.startsWith("| Key frame"));
    for (const r of rows) {
      const cells = r.split("|").slice(2, -1).map((c) => c.trim());
      for (const c of cells) assert.ok(["no data", "not implemented", "0", "all", "face_on", "down_the_line"].includes(c), `${section}: unexpected cell "${c}" in ${r}`);
    }
  }
});

test("report with synthetic data: per-view detection, accuracy vs K00 (prototype), offline table, comparison", async () => {
  const fo = await setupWithClip({ angle: "face_on" });
  const { dataDir } = fo;
  // A second, down-the-line clip from the same synthetic contributor.
  const dtl = await importClip(dataDir, { contributor: "C001", file: fakeVideo(fs.mkdtempSync(path.join(fo.root, "p2-"))), angle: "down_the_line", club: "iron", mount: "tripod", handedness: "right", lighting: "daylight", skill: "mid", conditions: [], strippedManually: true }, NO_FFMPEG, TODAY);
  writeSyntheticPose(dataDir, fo.clipId, POSES.FACE_ON_ADDRESS);
  writeSyntheticPose(dataDir, dtl.clipId, POSES.DTL_ADDRESS, { noPoseFrames: 6 });
  writeRun(dataDir, fo.clipId, fakeRun());
  writeRun(dataDir, dtl.clipId, fakeRun({ isolated: false, wall: 9 }));
  await runV2ChecksForClip(dataDir, fo.clipId, { today: TODAY });
  addAnnotator(dataDir, "K00", TODAY);
  const points = Object.fromEntries(ANNOTATION_KEYPOINTS.map((n) => [n, { v: "visible", x: 200 + POSES.FACE_ON_ADDRESS[n][0] * 2, y: 300 + POSES.FACE_ON_ADDRESS[n][1] * 2 }]));
  const layout = { annotations: path.join(dataDir, "annotations"), root: dataDir, auditLog: path.join(dataDir, "audit-log.jsonl") };
  saveAnnotationDraft(layout, fo.clipId, "K00", { keyframes: { address: { status: "labeled", frame_index: 2, t: 2 / 30, points }, top: { status: "cant_tell" }, impact: { status: "cant_tell" }, finish: { status: "not_in_clip" } } }, { schema: 1, analysisFps: 30, frameWidth: 720, frameHeight: 1280, frameCount: 12 }, TODAY);

  const { markdown, report } = await buildPilotReport(dataDir, { today: TODAY });
  assert.equal(report.clips.length, 2);
  const foClip = report.clips.find((c) => c.clipId === fo.clipId);
  const dtlClip = report.clips.find((c) => c.clipId === dtl.clipId);
  assert.equal(foClip.detection.confidentRate.left_shoulder, 1);
  assert.equal(dtlClip.detection.framesWithPose, 6);
  assert.equal(foClip.accuracy.overall.pck01, 1);
  assert.equal(foClip.accuracy.annotationVersion, 1);
  assert.match(foClip.offline.verdict, /^offline verified/);
  assert.match(dtlClip.offline.verdict, /NOT OS-isolated/);
  assert.equal(report.labelStatus, "prototype_not_validated");
  assert.equal(report.keyframeIdentification, "not implemented");

  assert.match(markdown, /K00 PROTOTYPE labels/);
  assert.match(markdown, /Runs verified offline .*: 1 of 2/);
  assert.match(markdown, /\| All 13 \| 13 \| 1 \(13\/13\) \[[\d.]+, 1\] \* \|/, "PCK row with n, Wilson CI and the too-few marker");
  assert.match(markdown, /\| left_shoulder \| 1 \(n=1\) \* \|/, "face-on detection with n and marker");
  assert.match(markdown, /\| Frames with a pose \(clip mean\) \| 1 \(n=1\) \* \| 0\.5 \(n=1\) \* \|/);
  assert.match(markdown, /\| Quality gate pass \| 1 \(1\/1\) .* \| no data \|/, "DTL has no checks file: no data, not zero");
  assert.match(markdown, /\| Key-frame identification \| not implemented \| not implemented \|/);
  assert.match(markdown, /\| address \| 1 \| 0 \| not implemented \|/);
  assert.match(markdown, /Right \/ left-handed clips \| 2 \/ 0 \(left-handed: not measured\)/);
  assert.ok(!markdown.includes(fo.root), "no local paths in the report");
});

test("detectionStats counts present and confident keypoints per frame", () => {
  const seq = { frames: [{ keypoints: { nose: { x: 1, y: 1, confidence: 0.9 }, left_wrist: { x: 1, y: 1, confidence: 0.2 } } }, { keypoints: {} }] };
  const s = detectionStats(seq, 0.5);
  assert.equal(s.frames, 2);
  assert.equal(s.framesWithPose, 1);
  assert.deepEqual([s.perKeypoint.nose.confident, s.perKeypoint.left_wrist.present, s.perKeypoint.left_wrist.confident], [1, 1, 0]);
});

test("report refuses nothing silently: a clip whose consent lapsed is listed as refused", async () => {
  const root = tmp("caddie-eval-report2-");
  const dataDir = path.join(root, "data");
  initDataDir(dataDir);
  addConsent(dataDir, { contributor: "C002", formVersion: "1.1", consentDate: "2026-10-01", retentionUntil: "2026-10-20", adult: true, affirmativeConsent: true, coachViewing: false, remoteCoachViewing: false, thirdPartyRoboflow: false, thirdPartyGemini: false }, "2026-10-01");
  await importClip(dataDir, { contributor: "C002", file: fakeVideo(root), angle: "face_on", club: "driver", mount: "tripod", handedness: "left", lighting: "daylight", skill: "mid", conditions: [], strippedManually: true }, NO_FFMPEG, "2026-10-01");
  const { markdown } = await buildPilotReport(dataDir, { today: TODAY });
  assert.match(markdown, /Refused by the local gate/);
  assert.match(markdown, /Clips in manifest \/ usable today \| 1 \/ 0/);
});

// Run: npm run test:caddie  (node --test, built-in type stripping)
// Pose-gate diagnostics (supabase/functions/_shared/caddieReliability.ts):
// the raw Roboflow tally and the detail line a pose_not_found records, so a
// "0 of N frames" failure says whether Roboflow saw no person, saw one below
// its reliability bar, or answered in a shape we don't read.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPoseSignalTally,
  formatPoseGateDetail,
  jpegSizeFromBase64,
  poseCoverage,
  redactDetail,
  shouldRunFullResPoseRetry,
  tallyRoboflowOutput,
} from "../supabase/functions/_shared/caddieReliability.ts";

// SOI, APP0 (JFIF, 16 bytes), DQT (67 bytes, zeros), SOF0 406x720, EOI.
function fakeJpeg(width: number, height: number, trailingBytes = 0): string {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const dqt = [0xff, 0xdb, 0x00, 0x43, ...new Array(65).fill(0)];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const bytes = Uint8Array.from([0xff, 0xd8, ...app0, ...dqt, ...sof, 0xff, 0xd9, ...new Array(trailingBytes).fill(0)]);
  return Buffer.from(bytes).toString("base64");
}

test("jpegSizeFromBase64 reads the SOF size, and gives up on non-JPEG input", () => {
  assert.deepEqual(jpegSizeFromBase64(fakeJpeg(406, 720)), { width: 406, height: 720 });
  assert.deepEqual(jpegSizeFromBase64(fakeJpeg(720, 404, 30000)), { width: 720, height: 404 });
  assert.equal(jpegSizeFromBase64(Buffer.from("not a jpeg").toString("base64")), undefined);
  assert.equal(jpegSizeFromBase64("@@@"), undefined);
  assert.equal(jpegSizeFromBase64(""), undefined);
});

const kp = (confidence: number, reliable: boolean) => ({ x: 10, y: 20, confidence, metric_reliable: reliable, available: true });

test("tallyRoboflowOutput separates no person, unreliable person and unknown shape", () => {
  const t = emptyPoseSignalTally();
  // A person, every keypoint below the reliability bar.
  tallyRoboflowOutput(t, { body_keypoints: { left_shoulder: kp(0.31, false), right_hip: kp(0.44, false) }, body_metrics: { person_confidence: 0.72 } });
  // Nobody: an empty keypoints object.
  tallyRoboflowOutput(t, { body_keypoints: {}, body_metrics: {} });
  // A shape we don't read (no body_keypoints at all).
  tallyRoboflowOutput(t, { something_else: [] });
  // A normal frame.
  tallyRoboflowOutput(t, { body_keypoints: { left_shoulder: kp(0.93, true), nose: { available: false } }, body_metrics: { person_confidence: 0.95 } });
  tallyRoboflowOutput(t, null);
  assert.deepEqual(t, {
    frames: 5,
    withKeypointsObject: 3,
    withAnyKeypoint: 2,
    withReliableKeypoint: 1,
    maxKeypointConfidence: 0.93,
    maxPersonConfidence: 0.95,
  });
});

test("formatPoseGateDetail is one short line that survives redaction", () => {
  const t = emptyPoseSignalTally();
  for (let i = 0; i < 80; i++) tallyRoboflowOutput(t, { body_keypoints: { left_shoulder: kp(0.2, false) }, body_metrics: {} });
  const frames = Array.from({ length: 80 }, () => ({ keypoints: {} }));
  const detail = formatPoseGateDetail(poseCoverage(frames), t, { width: 406, height: 720 }, 2.660098);
  assert.equal(
    detail,
    "usable body in 0/80 (min ratio 0.1) kp_obj 80/80 kp_any 80/80 kp_reliable 0/80 max_kp_conf 0.20 max_person_conf none frame 406x720 scale 2.66",
  );
  assert.equal(redactDetail(detail, 300), detail);
  assert.match(formatPoseGateDetail({ usable: 0, total: 0 }, emptyPoseSignalTally(), undefined, undefined), /frame unknown scale 1$/);
});

test("shouldRunFullResPoseRetry: only for a downscaled pass with enough deadline left", () => {
  assert.equal(shouldRunFullResPoseRetry(2.666667, 250_000, 215_000), true);
  assert.equal(shouldRunFullResPoseRetry(2.666667, 200_000, 215_000), false, "deadline too close");
  assert.equal(shouldRunFullResPoseRetry(1, 250_000, 215_000), false, "already full size");
  assert.equal(shouldRunFullResPoseRetry(1.005, 250_000, 215_000), false, "rounding, not a real downscale");
  assert.equal(shouldRunFullResPoseRetry(undefined, 250_000, 215_000), false, "old extract-frames, no scale");
  assert.equal(shouldRunFullResPoseRetry(Number.NaN, 250_000, 215_000), false);
});

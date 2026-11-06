// Run: npm run test:caddie  (node --test, built-in type stripping)
// Server writes (supabase/functions/_shared/caddieReliability.ts) and the
// client reads (src/lib/caddieFailure.ts) the same error_message format.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POSE_PRESENCE_MIN_RATIO,
  backoffMs,
  formatFailure,
  frameHasUsableBody,
  isRetryableStatus,
  poseCoverage,
  scaleKeypoints,
} from "../supabase/functions/_shared/caddieReliability.ts";
import type { CaddieFailureCode } from "../supabase/functions/_shared/caddieReliability.ts";
import { FAILURE_BODY_KEYS, FAILURE_SHORT_KEYS, FAILURE_TITLE_KEYS, parseCaddieFailure } from "../src/lib/caddieFailure.ts";
import { en } from "../src/i18n/locales/en.ts";

const CODES: CaddieFailureCode[] = ["pose_not_found", "provider_busy", "timeout", "upload", "unknown"];

test("every code round-trips through error_message", () => {
  for (const code of CODES) {
    assert.deepEqual(parseCaddieFailure(formatFailure(code, "some detail: HTTP 500 {json}")), { code });
  }
});

test("trim window round-trips", () => {
  const msg = formatFailure("timeout", "pipeline exceeded 330s", { startSeconds: 3.25, endSeconds: 11.5 });
  assert.match(msg, /^code:timeout window:3\.250-11\.500 /);
  assert.deepEqual(parseCaddieFailure(msg), { code: "timeout", window: { startSeconds: 3.25, endSeconds: 11.5 } });
});

test("old free-text rows and empty values read as unknown", () => {
  for (const legacy of [
    "roboflow success ratio too low: 3/40 (HTTP 403: credit_cap_exceeded)",
    "Gemini generateContent 503: overloaded",
    "video fetch 404",
    "",
    null,
    undefined,
    "code:not_a_real_code detail",
    "prefix code:timeout",
  ]) {
    assert.deepEqual(parseCaddieFailure(legacy), { code: "unknown" }, String(legacy));
  }
});

test("a malformed window is ignored but the code is kept", () => {
  assert.deepEqual(parseCaddieFailure("code:upload window:5-2 detail"), { code: "upload" });
  assert.deepEqual(parseCaddieFailure("code:upload window:abc detail"), { code: "upload" });
});

test("error_message is length-capped", () => {
  assert.ok(formatFailure("unknown", "x".repeat(5000)).length <= 800);
});

test("every code has copy in the English locale", () => {
  for (const code of CODES) {
    assert.ok(en[FAILURE_SHORT_KEYS[code]], code);
    assert.ok(en[FAILURE_TITLE_KEYS[code]], code);
    const body = FAILURE_BODY_KEYS[code];
    if (body) assert.ok(en[body], code);
  }
  assert.match(en["caddie.failure.poseNotFound.title"], /whole body/);
  assert.match(en["caddie.failure.poseNotFound.body"], /head to feet/);
});

test("filming tips and the pose_not_found copy exist in every locale, without emoji", async () => {
  const keys = [
    "caddie.failure.poseNotFound.title",
    "caddie.failure.poseNotFound.body",
    "caddie.failure.pickAnother",
    "caddie.tips.title",
    "caddie.tips.show",
    "caddie.tips.hide",
    "caddie.tips.wholeBody",
    "caddie.tips.distance",
    "caddie.tips.phone",
    "caddie.tips.light",
    "caddie.tips.angle",
  ] as const;
  for (const name of ["en", "es", "ja", "ko", "zh-CN", "zh-TW"]) {
    const mod = (await import(`../src/i18n/locales/${name}.ts`)) as Record<string, Record<string, string>>;
    const dict = Object.values(mod).find((v) => v && typeof v === "object" && "caddie.tips.title" in v);
    assert.ok(dict, `${name}: locale table`);
    for (const key of keys) {
      assert.ok(dict[key]?.trim(), `${name}: ${key}`);
      assert.doesNotMatch(dict[key], /\p{Extended_Pictographic}/u, `${name}: ${key} has an emoji`);
    }
    if (name !== "en") assert.notEqual(dict["caddie.tips.wholeBody"], en["caddie.tips.wholeBody"], `${name}: translated`);
  }
});

test("retryable statuses", () => {
  for (const s of [429, 408, 500, 502, 503, 504]) assert.equal(isRetryableStatus(s), true, String(s));
  for (const s of [200, 400, 401, 403, 404, 413]) assert.equal(isRetryableStatus(s), false, String(s));
});

test("backoff grows, honors Retry-After, and is capped", () => {
  const first = backoffMs(1, 1000, 10_000);
  const second = backoffMs(2, 1000, 10_000);
  assert.ok(first >= 1000 && first <= 1250);
  assert.ok(second >= 2000 && second <= 2500);
  assert.equal(backoffMs(1, 1000, 10_000, "3"), 3000);
  assert.equal(backoffMs(1, 1000, 10_000, "120"), 10_000);
  assert.equal(backoffMs(5, 1000, 4000), 4000);
  // An HTTP-date Retry-After isn't a number: falls back to exponential.
  const fallback = backoffMs(1, 1000, 10_000, "Wed, 21 Oct 2026 07:28:00 GMT");
  assert.ok(fallback >= 1000 && fallback <= 1250);
});

const k = { x: 1, y: 1, confidence: 0.9 };
const fullBody = { left_shoulder: k, right_shoulder: k, left_hip: k, right_hip: k, left_wrist: k, right_wrist: k };

test("usable body = both shoulders, both hips, at least one wrist", () => {
  assert.equal(frameHasUsableBody(fullBody), true);
  const { right_wrist: _rw, ...oneWrist } = fullBody;
  assert.equal(frameHasUsableBody(oneWrist), true);
  const { left_wrist: _lw, ...noWrists } = oneWrist;
  assert.equal(frameHasUsableBody(noWrists), false);
  const { left_hip: _lh, ...noHip } = fullBody;
  assert.equal(frameHasUsableBody(noHip), false);
  assert.equal(frameHasUsableBody({}), false);
});

test("pose coverage gate: frames Roboflow answered but with no body don't count", () => {
  const frames = [
    ...Array.from({ length: 1 }, () => ({ keypoints: fullBody })),
    ...Array.from({ length: 19 }, () => ({ keypoints: {} })),
  ];
  const c = poseCoverage(frames);
  assert.deepEqual([c.usable, c.total], [1, 20]);
  assert.ok(c.ratio < POSE_PRESENCE_MIN_RATIO);
  assert.equal(poseCoverage([]).ratio, 0);
  // A real swing with most frames empty around it still passes.
  assert.ok(poseCoverage(frames.slice(0, 5)).ratio >= POSE_PRESENCE_MIN_RATIO);
});

test("keypoints scale back to source pixels; missing/invalid scale is a no-op", () => {
  const kps = { nose: { x: 360, y: 640, confidence: 0.8 } };
  assert.deepEqual(scaleKeypoints(kps, 1.5), { nose: { x: 540, y: 960, confidence: 0.8 } });
  for (const s of [undefined, null, 0, -2, Number.NaN, "1.5", 1]) assert.equal(scaleKeypoints(kps, s), kps);
});

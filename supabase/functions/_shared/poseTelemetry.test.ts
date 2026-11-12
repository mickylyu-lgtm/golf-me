// Run: node --test supabase/functions/_shared/poseTelemetry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PoseCallLog, percentile, poseCallOutcome } from "./poseTelemetry.ts";

test("percentile is nearest-rank and safe on empty input", () => {
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([5, 1, 3], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
});

test("failed calls are classified by status, then by error name", () => {
  assert.equal(poseCallOutcome(429, undefined), "rate_limited");
  assert.equal(poseCallOutcome(503, undefined), "server_error");
  assert.equal(poseCallOutcome(401, undefined), "client_error");
  assert.equal(poseCallOutcome(undefined, "TimeoutError"), "timeout");
  assert.equal(poseCallOutcome(undefined, "TypeError"), "network");
  assert.equal(poseCallOutcome(undefined, "Error"), "other");
});

test("summary separates slow calls, timeouts and back-off", () => {
  let t = 1000;
  const log = new PoseCallLog(() => t);
  log.record(2000, "ok");
  log.record(3000, "ok");
  log.record(25000, "timeout");
  log.record(400, "rate_limited");
  log.addBackoff(1700);
  t = 31000;
  const s = log.summary();
  assert.equal(s.wall_ms, 30000);
  assert.equal(s.calls, 4);
  assert.equal(s.ok, 2);
  assert.equal(s.ok_p50_ms, 2000);
  assert.equal(s.ok_max_ms, 3000);
  assert.equal(s.max_call_ms, 25000);
  assert.equal(s.timeouts, 1);
  assert.equal(s.rate_limited, 1);
  assert.equal(s.backoff_ms, 1700);
  for (const v of Object.values(s)) assert.equal(typeof v, "number");
});

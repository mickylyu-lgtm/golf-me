import { test } from "node:test";
import assert from "node:assert/strict";
import { isLikeAlreadyDone } from "../src/lib/likeFeedback.ts";

test("a duplicate like insert counts as done; other errors do not", () => {
  assert.equal(isLikeAlreadyDone(false, "23505"), true);
  assert.equal(isLikeAlreadyDone(false, "42501"), false);
  assert.equal(isLikeAlreadyDone(false, undefined), false);
  assert.equal(isLikeAlreadyDone(true, "23505"), false, "an unlike never hits the key");
});

import { runOncePerId } from "../src/lib/likeFeedback.ts";

test("rapid taps: a second call for the same post is ignored while the first runs", async () => {
  const inFlight = new Set<string>();
  let release!: () => void;
  let calls = 0;
  const first = runOncePerId(inFlight, "p1", () => { calls++; return new Promise<void>((r) => (release = r)); });
  assert.equal(await runOncePerId(inFlight, "p1", async () => { calls++; }), false);
  assert.equal(await runOncePerId(inFlight, "p2", async () => { calls++; }), true, "other posts unaffected");
  release();
  assert.equal(await first, true);
  assert.equal(calls, 2);
  assert.equal(await runOncePerId(inFlight, "p1", async () => { calls++; }), true, "free again after it settles");
});

test("a failure releases the post and still reports the error", async () => {
  const inFlight = new Set<string>();
  await assert.rejects(runOncePerId(inFlight, "p1", async () => { throw new Error("offline"); }), /offline/);
  assert.equal(inFlight.has("p1"), false);
});

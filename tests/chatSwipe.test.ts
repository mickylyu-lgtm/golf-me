// Run: npm run test:chat  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AXIS_SLOP_PX,
  REPLY_MAX_OVERDRAG_PX,
  REPLY_THRESHOLD_PX,
  crossedReplyThreshold,
  isPastReplyThreshold,
  lockDirection,
  replyDragOffset,
  replyProgress,
} from "../src/lib/chatSwipe.ts";
import { isEdgeStart } from "../src/lib/edgeSwipeBack.ts";

test("lockDirection waits for the slop in both axes", () => {
  assert.equal(lockDirection(0, 0), "pending");
  assert.equal(lockDirection(AXIS_SLOP_PX - 1, 0), "pending");
  assert.equal(lockDirection(-(AXIS_SLOP_PX - 1), AXIS_SLOP_PX - 1), "pending");
  assert.equal(lockDirection(AXIS_SLOP_PX, 0), "right");
});

test("lockDirection: right = reply, left = times, mostly vertical = scroll", () => {
  assert.equal(lockDirection(20, 4), "right");
  assert.equal(lockDirection(20, -15), "right");
  assert.equal(lockDirection(-20, 3), "left");
  assert.equal(lockDirection(-20, -19), "left");
  assert.equal(lockDirection(4, 20), "vertical");
  assert.equal(lockDirection(-4, -20), "vertical");
  // A perfect diagonal is not horizontal: native scroll keeps priority.
  assert.equal(lockDirection(12, 12), "vertical");
  assert.equal(lockDirection(-12, 12), "vertical");
});

test("left and right are mutually exclusive for any move", () => {
  for (let dx = -40; dx <= 40; dx += 3) {
    for (let dy = -40; dy <= 40; dy += 3) {
      const d = lockDirection(dx, dy);
      if (d === "right") assert.ok(dx > 0);
      if (d === "left") assert.ok(dx < 0);
    }
  }
});

test("replyDragOffset: never left, 1:1 to the threshold, then resisted and capped", () => {
  assert.equal(replyDragOffset(-30), 0);
  assert.equal(replyDragOffset(0), 0);
  assert.equal(replyDragOffset(25), 25);
  assert.equal(replyDragOffset(REPLY_THRESHOLD_PX), REPLY_THRESHOLD_PX);
  const past = replyDragOffset(REPLY_THRESHOLD_PX + 20);
  assert.ok(past > REPLY_THRESHOLD_PX && past < REPLY_THRESHOLD_PX + 20);
  assert.equal(replyDragOffset(1000), REPLY_THRESHOLD_PX + REPLY_MAX_OVERDRAG_PX);
});

test("threshold and progress", () => {
  assert.equal(isPastReplyThreshold(REPLY_THRESHOLD_PX - 1), false);
  assert.equal(isPastReplyThreshold(REPLY_THRESHOLD_PX), true);
  assert.equal(replyProgress(0), 0);
  assert.equal(replyProgress(REPLY_THRESHOLD_PX / 2), 0.5);
  assert.equal(replyProgress(REPLY_THRESHOLD_PX * 3), 1);
});

test("haptic fires once per upward crossing", () => {
  assert.equal(crossedReplyThreshold(10, 40), false);
  assert.equal(crossedReplyThreshold(55, 61), true);
  assert.equal(crossedReplyThreshold(61, 70), false); // stays past: no repeat
  assert.equal(crossedReplyThreshold(70, 50), false); // going back under
  assert.equal(crossedReplyThreshold(50, 60), true); // over again
  // Simulate a drag sampled frame by frame: exactly one fire.
  let prev = 0;
  let fires = 0;
  for (let dx = 0; dx <= 200; dx += 7) {
    const off = replyDragOffset(dx);
    if (crossedReplyThreshold(prev, off)) fires++;
    prev = off;
  }
  assert.equal(fires, 1);
});

test("a reply swipe never starts in the edge-swipe-back strip", () => {
  // useSwipeToReply skips any start where isEdgeStart is true, so the edge
  // strip always stays swipe back.
  assert.equal(isEdgeStart(10), true);
  assert.equal(isEdgeStart(64), false);
});

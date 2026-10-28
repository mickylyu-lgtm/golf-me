// Run: npm run test:chat  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AXIS_SLOP_PX,
  REPLY_MAX_OVERDRAG_PX,
  REPLY_THRESHOLD_PX,
  classifySwipe,
  crossedReplyThreshold,
  isPastReplyThreshold,
  lockDirection,
  replyDragOffset,
  replyProgress,
} from "../src/lib/chatSwipe.ts";
import { classifyMove, isEdgeStart } from "../src/lib/edgeSwipeBack.ts";

test("lockDirection waits for the slop in both axes", () => {
  assert.equal(lockDirection(0, 0), "pending");
  assert.equal(lockDirection(AXIS_SLOP_PX - 1, 0), "pending");
  assert.equal(lockDirection(-(AXIS_SLOP_PX - 1), AXIS_SLOP_PX - 1), "pending");
  assert.equal(lockDirection(-AXIS_SLOP_PX, 0), "left");
});

test("lockDirection: left, right, and mostly vertical = scroll", () => {
  assert.equal(lockDirection(-20, 4), "left");
  assert.equal(lockDirection(-20, -19), "left");
  assert.equal(lockDirection(20, 4), "right");
  assert.equal(lockDirection(4, 20), "vertical");
  assert.equal(lockDirection(-4, -20), "vertical");
  // A perfect diagonal is not horizontal: native scroll keeps priority.
  assert.equal(lockDirection(12, 12), "vertical");
  assert.equal(lockDirection(-12, 12), "vertical");
});

const ON_BUBBLE = { onBubble: true, inEdge: false };
const OFF_BUBBLE = { onBubble: false, inEdge: false };
const EDGE = { onBubble: false, inEdge: true };

test("bubble + left = reply", () => {
  assert.equal(classifySwipe(lockDirection(-30, 3), ON_BUBBLE), "reply");
});

test("off-bubble + left = times", () => {
  assert.equal(classifySwipe(lockDirection(-30, 3), OFF_BUBBLE), "times");
  assert.equal(classifySwipe(lockDirection(-30, 3), EDGE), "times");
});

test("bubble + right = nothing (no reply, no back)", () => {
  assert.equal(classifySwipe(lockDirection(30, 3), ON_BUBBLE), "none");
  assert.equal(classifySwipe(lockDirection(30, 3), OFF_BUBBLE), "none");
});

test("edge + right = back, matching useEdgeSwipeBack's own rules", () => {
  assert.equal(isEdgeStart(10), true);
  assert.equal(classifySwipe(lockDirection(30, 3), EDGE), "back");
  assert.equal(classifyMove(30, 3), "back");
});

test("vertical = scroll wherever it starts; pending until the slop", () => {
  for (const start of [ON_BUBBLE, OFF_BUBBLE, EDGE]) {
    assert.equal(classifySwipe(lockDirection(3, 40), start), "scroll");
    assert.equal(classifySwipe(lockDirection(2, 2), start), "pending");
  }
});

test("reply and times can never both claim one drag", () => {
  for (let dx = -40; dx <= 40; dx += 3) {
    for (let dy = -40; dy <= 40; dy += 3) {
      const d = lockDirection(dx, dy);
      const a = classifySwipe(d, ON_BUBBLE);
      const b = classifySwipe(d, OFF_BUBBLE);
      assert.notEqual(a, "times"); // a bubble start never moves the times
      assert.notEqual(b, "reply"); // an off-bubble start never replies
      if (a === "reply") assert.ok(dx < 0);
    }
  }
});

test("replyDragOffset: never past rest, 1:1 to the threshold, then resisted and capped", () => {
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

test("haptic fires once per crossing", () => {
  assert.equal(crossedReplyThreshold(10, 40), false);
  assert.equal(crossedReplyThreshold(55, 61), true);
  assert.equal(crossedReplyThreshold(61, 70), false);
  assert.equal(crossedReplyThreshold(70, 50), false);
  assert.equal(crossedReplyThreshold(50, 60), true);
  // A leftward drag sampled frame by frame: exactly one fire.
  let prev = 0;
  let fires = 0;
  for (let dx = 0; dx >= -200; dx -= 7) {
    const off = replyDragOffset(-dx);
    if (crossedReplyThreshold(prev, off)) fires++;
    prev = off;
  }
  assert.equal(fires, 1);
});

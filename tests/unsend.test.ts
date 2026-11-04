// Run: npm run test:chat  (node --test, built-in type stripping)
// Unsend within 5 minutes: when it's offered, how the RPC's answer is read,
// the long-press rules and the actions menu placement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { UNSEND_WINDOW_MS, canUnsendMessage, classifyUnsendError, unsendRemainingMs } from "../src/lib/unsend.ts";
import { LONG_PRESS_MS, longPressCancelledByMove, placeActionsMenu } from "../src/lib/messageLongPress.ts";
import { AXIS_SLOP_PX } from "../src/lib/chatSwipe.ts";

const sentAt = "2026-11-04T12:00:00.000Z";
const t0 = Date.parse(sentAt);
const mine = { id: "m1", senderId: "me", createdAt: sentAt, unsentAt: null };

test("unsend: offered for my own message inside 5 minutes only", () => {
  assert.equal(canUnsendMessage(mine, "me", t0 + 1000), true);
  assert.equal(canUnsendMessage(mine, "me", t0 + UNSEND_WINDOW_MS - 1), true);
  assert.equal(canUnsendMessage(mine, "me", t0 + UNSEND_WINDOW_MS), false, "exactly 5:00 is too late (server: created_at <= now() - 5 min)");
  assert.equal(canUnsendMessage(mine, "other", t0 + 1000), false, "never someone else's message");
  assert.equal(canUnsendMessage(mine, "", t0 + 1000), false);
});

test("unsend: not for an already-unsent, still-sending or undated message", () => {
  assert.equal(canUnsendMessage({ ...mine, unsentAt: sentAt }, "me", t0 + 1000), false);
  assert.equal(canUnsendMessage({ ...mine, id: "temp-123" }, "me", t0 + 1000), false, "no row yet");
  assert.equal(canUnsendMessage({ ...mine, createdAt: "garbage" }, "me", t0 + 1000), false);
});

test("unsend: a phone clock behind the sender's send time still counts as inside the window", () => {
  assert.equal(canUnsendMessage(mine, "me", t0 - 2000), true);
});

test("unsend: remaining time for the expiry tick", () => {
  assert.equal(unsendRemainingMs(sentAt, t0 + 60_000), UNSEND_WINDOW_MS - 60_000);
  assert.equal(unsendRemainingMs(sentAt, t0 + UNSEND_WINDOW_MS + 5), 0);
  assert.equal(unsendRemainingMs("garbage", t0), 0);
});

test("unsend: RPC errors -> expired vs failed", () => {
  assert.equal(classifyUnsendError({ hint: "unsend_window_expired", message: "x" }), "expired");
  assert.equal(classifyUnsendError({ message: "unsend_window_expired: messages can only be unsent within 5 minutes." }), "expired");
  assert.equal(classifyUnsendError({ hint: "unsend_not_allowed", code: "42501" }), "failed");
  assert.equal(classifyUnsendError({ code: "PGRST202", message: "Could not find the function" }), "failed", "migration not applied");
  assert.equal(classifyUnsendError(null), "failed");
});

test("long-press: cancelled by exactly the movement that starts a swipe or scroll", () => {
  assert.ok(LONG_PRESS_MS >= 300 && LONG_PRESS_MS <= 600);
  assert.equal(longPressCancelledByMove(0, 0), false);
  assert.equal(longPressCancelledByMove(AXIS_SLOP_PX - 1, AXIS_SLOP_PX - 1), false, "finger jitter keeps the press");
  assert.equal(longPressCancelledByMove(AXIS_SLOP_PX, 0), true, "swipe-to-reply distance");
  assert.equal(longPressCancelledByMove(-AXIS_SLOP_PX, 0), true, "swipe-to-reveal-times distance");
  assert.equal(longPressCancelledByMove(0, AXIS_SLOP_PX), true, "scroll distance");
});

test("actions menu: above the bubble when it fits, else below, always on screen", () => {
  assert.deepEqual(placeActionsMenu({ anchorTop: 300, anchorBottom: 340, menuHeight: 90, viewportTop: 0, viewportBottom: 800 }), { top: 202, placement: "above" });
  assert.deepEqual(placeActionsMenu({ anchorTop: 60, anchorBottom: 100, menuHeight: 90, viewportTop: 0, viewportBottom: 800 }), { top: 108, placement: "below" });
  // Tall bubble near the bottom of a short (keyboard-up) viewport: clamped.
  assert.deepEqual(placeActionsMenu({ anchorTop: 20, anchorBottom: 400, menuHeight: 90, viewportTop: 0, viewportBottom: 407 }), { top: 309, placement: "below" });
});

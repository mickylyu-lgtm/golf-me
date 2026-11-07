// Run: npm run test:chat  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTE_MOTION_TRAVEL_PX, chatRouteMotion, consumeChatRouteMotionSkip, isChatThreadPath, routeMotionKeyframes, skipNextChatRouteMotion } from "../src/lib/chatRouteMotion.ts";

test("conversation paths", () => {
  assert.ok(isChatThreadPath("/messages/g11"));
  assert.ok(isChatThreadPath("/messages/round/call-7"));
  assert.ok(isChatThreadPath("/messages/g11/"));
  assert.ok(!isChatThreadPath("/messages"));
  assert.ok(!isChatThreadPath("/messages/round/call-7/extra"));
  assert.ok(!isChatThreadPath("/golfer/g11"));
});

test("list -> conversation forward, back to the list back, everything else untouched", () => {
  assert.equal(chatRouteMotion("/messages", "/messages/g11", "PUSH"), "forward");
  assert.equal(chatRouteMotion("/messages", "/messages/round/call-7", "PUSH"), "forward");
  assert.equal(chatRouteMotion("/", "/messages/g11", "PUSH"), "forward", "from a notification / profile");
  assert.equal(chatRouteMotion("/messages/g11", "/messages", "POP"), "back");
  assert.equal(chatRouteMotion("/messages/g11", "/messages", "REPLACE"), "back", "goBack's fallback");
  assert.equal(chatRouteMotion("/golfer/g11", "/messages/g11", "POP"), "back", "back into a conversation");
  assert.equal(chatRouteMotion("/messages/g11", "/golfer/g11", "PUSH"), null);
  assert.equal(chatRouteMotion("/messages", "/find", "PUSH"), null);
  assert.equal(chatRouteMotion("/messages/g11", "/messages/g11", "REPLACE"), null, "same screen");
});

test("keyframes: small sideways travel + fade-in, never vertical", () => {
  const fwd = routeMotionKeyframes("forward");
  const back = routeMotionKeyframes("back");
  assert.equal(fwd[0].transform, `translate3d(${ROUTE_MOTION_TRAVEL_PX}px, 0, 0)`);
  assert.equal(back[0].transform, `translate3d(${-ROUTE_MOTION_TRAVEL_PX}px, 0, 0)`);
  for (const k of [...fwd, ...back]) assert.match(String(k.transform), /^translate3d\(-?\d+(px)?, 0, 0\)$/);
  assert.equal(fwd[1].opacity, 1);
});

test("edge-swipe skip: only for the navigation leaving that thread, used once", () => {
  skipNextChatRouteMotion("/messages/g11");
  assert.equal(consumeChatRouteMotionSkip("/messages/g11"), true);
  assert.equal(consumeChatRouteMotionSkip("/messages/g11"), false, "used up");
  skipNextChatRouteMotion("/messages/g11");
  assert.equal(consumeChatRouteMotionSkip("/messages"), false, "a different navigation clears it");
  assert.equal(consumeChatRouteMotionSkip("/messages/g11"), false);
  assert.equal(consumeChatRouteMotionSkip(null), false);
});

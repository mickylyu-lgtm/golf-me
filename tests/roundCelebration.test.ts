import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addSeen,
  confettiAlpha,
  CONFETTI_COLORS,
  CONFETTI_MS,
  makeConfetti,
  parseSeen,
  RECENT_ROUND_MS,
  SEEN_LIMIT,
  shouldCelebrateOnView,
  stepPiece,
} from "../src/lib/roundCelebration.ts";

const now = Date.parse("2026-11-07T20:00:00Z");
const base = { isCompleted: true, isJoined: true, callId: "c1", dateISO: "2026-11-07T12:00:00Z", now, seen: [] as string[] };

test("a recent completed round celebrates once for a member", () => {
  assert.equal(shouldCelebrateOnView(base), true);
  assert.equal(shouldCelebrateOnView({ ...base, seen: ["c1"] }), false);
});

test("not completed, not a member, or an old round: no celebration", () => {
  assert.equal(shouldCelebrateOnView({ ...base, isCompleted: false }), false);
  assert.equal(shouldCelebrateOnView({ ...base, isJoined: false }), false);
  const old = new Date(now - RECENT_ROUND_MS - 60_000).toISOString();
  assert.equal(shouldCelebrateOnView({ ...base, dateISO: old }), false);
  assert.equal(shouldCelebrateOnView({ ...base, dateISO: "not a date" }), false);
});

test("seen list parses defensively and stays bounded", () => {
  assert.deepEqual(parseSeen(null), []);
  assert.deepEqual(parseSeen("{bad"), []);
  assert.deepEqual(parseSeen('["a", 3, "b"]'), ["a", "b"]);
  assert.deepEqual(addSeen(["a", "b"], "a"), ["b", "a"]);
  let seen: string[] = [];
  for (let i = 0; i < SEEN_LIMIT + 25; i++) seen = addSeen(seen, `c${i}`);
  assert.equal(seen.length, SEEN_LIMIT);
  assert.equal(seen[seen.length - 1], `c${SEEN_LIMIT + 24}`);
});

test("confetti uses brand colours, launches upward and falls back down", () => {
  let n = 0;
  const rand = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  const pieces = makeConfetti(40, 390, 844, rand);
  assert.equal(pieces.length, 40);
  for (const p of pieces) {
    assert.ok((CONFETTI_COLORS as readonly string[]).includes(p.color));
    assert.ok(p.vy < 0, "starts moving up");
  }
  const p = pieces[0]!;
  const y0 = p.y;
  for (let t = 0; t < CONFETTI_MS; t += 16) stepPiece(p, 16);
  assert.ok(p.y > y0, "ends below where it started");
});

test("confetti fades out by the end", () => {
  assert.equal(confettiAlpha(0), 1);
  assert.equal(confettiAlpha(CONFETTI_MS * 0.5), 1);
  assert.ok(confettiAlpha(CONFETTI_MS * 0.85) < 1);
  assert.equal(confettiAlpha(CONFETTI_MS), 0);
});

// Run: npm run test:trust  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { NEW_MEMBER_BADGE_DAYS, showNewMemberBadge } from "../src/lib/newMemberBadge.ts";

const now = Date.parse("2026-11-04T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const golfer = (daysAgo: number, completedRounds = 0) => ({
  memberSince: new Date(now - daysAgo * day).toISOString(),
  reputation: { completedRounds },
});

test("shows during a golfer's first 30 days", () => {
  assert.equal(showNewMemberBadge(golfer(0), false, now), true);
  assert.equal(showNewMemberBadge(golfer(NEW_MEMBER_BADGE_DAYS - 1), false, now), true);
});

test("goes away after 30 days, even with no completed rounds", () => {
  assert.equal(showNewMemberBadge(golfer(NEW_MEMBER_BADGE_DAYS), false, now), false);
  assert.equal(showNewMemberBadge(golfer(200), false, now), false);
});

test("goes away early after a first completed round", () => {
  assert.equal(showNewMemberBadge(golfer(2, 1), false, now), false);
});

test("never on the founder", () => {
  assert.equal(showNewMemberBadge(golfer(0), true, now), false);
});

test("no join date, or an unreadable one, shows nothing rather than a permanent badge", () => {
  assert.equal(showNewMemberBadge({ memberSince: "", reputation: { completedRounds: 0 } }, false, now), false);
  assert.equal(showNewMemberBadge({ memberSince: "soon", reputation: { completedRounds: 0 } }, false, now), false);
});

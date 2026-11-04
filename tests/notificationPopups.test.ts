// Run: npm run test:trust  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { POPUP_CLOCK_SLACK_MS, isFreshForPopup } from "../src/lib/notificationPopups.ts";

const start = Date.parse("2026-11-04T12:00:00Z");
const at = (ms: number) => new Date(start + ms).toISOString();

test("a new unread notification after the app opened pops", () => {
  assert.equal(isFreshForPopup({ read: false, createdAt: at(5_000) }, start), true);
});

test("signing in on a new device: old history never pops, read or unread", () => {
  assert.equal(isFreshForPopup({ read: true, createdAt: at(-86_400_000) }, start), false);
  assert.equal(isFreshForPopup({ read: false, createdAt: at(-86_400_000) }, start), false, "missed while away: in the bell, not a popup");
});

test("already read elsewhere never pops, even if just created", () => {
  assert.equal(isFreshForPopup({ read: true, createdAt: at(5_000) }, start), false);
});

test("a device clock slightly ahead of the server still pops a just-created row", () => {
  assert.equal(isFreshForPopup({ read: false, createdAt: at(-POPUP_CLOCK_SLACK_MS + 1_000) }, start), true);
  assert.equal(isFreshForPopup({ read: false, createdAt: at(-POPUP_CLOCK_SLACK_MS - 1_000) }, start), false);
});

test("an unparseable date never pops", () => {
  assert.equal(isFreshForPopup({ read: false, createdAt: "" }, start), false);
});

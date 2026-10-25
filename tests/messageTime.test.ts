// Run: npm run test:chat  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMessageTime } from "../src/lib/messageTime.ts";

const t = () => "Yesterday";
// Local-time "now": Saturday 2026-10-24, 15:00.
const NOW = new Date(2026, 9, 24, 15, 0);
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).toISOString();

test("today shows the short time only", () => {
  const label = formatMessageTime(at(2026, 9, 24, 12, 17), "en", t, NOW);
  assert.deepEqual(label, { day: null, time: "12:17 PM" });
});

test("just after midnight is still today, just before is yesterday", () => {
  assert.equal(formatMessageTime(at(2026, 9, 24, 0, 1), "en", t, NOW)?.day, null);
  assert.equal(formatMessageTime(at(2026, 9, 23, 23, 59), "en", t, NOW)?.day, "Yesterday");
});

test("within the week shows a weekday, older shows a date, other years add the year", () => {
  assert.equal(formatMessageTime(at(2026, 9, 20, 9, 5), "en", t, NOW)?.day, "Tue");
  assert.equal(formatMessageTime(at(2026, 9, 3, 9, 5), "en", t, NOW)?.day, "Oct 3");
  assert.equal(formatMessageTime(at(2025, 11, 31, 9, 5), "en", t, NOW)?.day, "Dec 31, 2025");
});

test("every app locale formats without throwing", () => {
  for (const locale of ["en", "zh-CN", "zh-TW", "es", "ko", "ja"]) {
    const label = formatMessageTime(at(2026, 9, 3, 18, 40), locale, t, NOW);
    assert.ok(label && label.time.length > 0 && label.day);
  }
});

test("a bad timestamp yields no label instead of 'Invalid Date'", () => {
  assert.equal(formatMessageTime("not-a-date", "en", t, NOW), null);
});

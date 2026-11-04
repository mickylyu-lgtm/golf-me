// Run: npm run test:chat  (node --test, built-in type stripping)
// DM composer: growth height (mirror measurement), one send per draft, the
// web keyboard inset, and pending-DM reconciliation (the paste "double
// send", which was a second bubble, not a second insert).
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPOSER_MAX_LINES, composerTextareaHeight } from "../src/lib/composerAutosize.ts";
import { createSendGuard } from "../src/lib/sendGuard.ts";
import { WEB_KEYBOARD_MIN_PX, webKeyboardInset } from "../src/lib/keyboard/webInset.ts";
import { DM_MATCH_SKEW_MS, reconcilePendingDms } from "../src/lib/dmPending.ts";

// ChatComposer at mobile width: 16px x leading-snug (1.375) = 22px lines,
// py-2 = 16px padding, no border.
const base = { lineHeight: 22, paddingY: 16, borderY: 0 };

test("composer: one line minimum, grows per line, caps at 5 lines", () => {
  assert.equal(composerTextareaHeight({ ...base, contentHeight: 0 }), 38, "empty is one line");
  assert.equal(composerTextareaHeight({ ...base, contentHeight: 38 }), 38);
  assert.equal(composerTextareaHeight({ ...base, contentHeight: 60 }), 60, "two lines");
  assert.equal(composerTextareaHeight({ ...base, contentHeight: 126 }), 126, "five lines");
  assert.equal(composerTextareaHeight({ ...base, contentHeight: 500 }), 22 * COMPOSER_MAX_LINES + 16, "capped: scrolls inside");
});

test("composer: fractional line-height rounds up (no 1px inner scroll), sm: text-sm metrics", () => {
  // 14px x 1.375 = 19.25px
  const sm = { lineHeight: 19.25, paddingY: 16, borderY: 0 };
  assert.equal(composerTextareaHeight({ ...sm, contentHeight: 35.25 }), 36);
  assert.equal(composerTextareaHeight({ ...sm, contentHeight: 999 }), Math.ceil(19.25 * 5 + 16));
});

test("composer: border-box adds the border; bad metrics fall back safely", () => {
  assert.equal(composerTextareaHeight({ lineHeight: 22, paddingY: 16, borderY: 2, contentHeight: 60 }), 62);
  assert.equal(composerTextareaHeight({ lineHeight: Number.NaN, paddingY: 16, borderY: 0, contentHeight: 60 }), 60, "line-height 'normal' -> 22px fallback");
  assert.equal(composerTextareaHeight({ ...base, contentHeight: Number.NaN }), 38);
});

test("send guard: the same draft sends once until it changes", () => {
  const g = createSendGuard();
  assert.equal(g.claim("pasted text"), true);
  assert.equal(g.claim("pasted text"), false, "Enter + click before the re-render: no second send");
  g.release(); // the page cleared the draft
  assert.equal(g.claim("pasted text"), true, "the same text typed again later still sends");
});

test("send guard: blank never sends; a restored draft after a failure can be retried", () => {
  const g = createSendGuard();
  assert.equal(g.claim("   "), false);
  assert.equal(g.claim("hi"), true);
  g.release(); // cleared to ""
  g.release(); // restored to "hi" after a failed send (another value change)
  assert.equal(g.claim("hi"), true);
});

test("web keyboard inset: Safari keyboard = innerHeight - visualViewport.height", () => {
  assert.equal(webKeyboardInset({ innerHeight: 844, viewportHeight: 508, scale: 1, fieldFocused: true }), 336);
  assert.equal(webKeyboardInset({ innerHeight: 667, viewportHeight: 407.4, scale: 1, fieldFocused: true }), 260);
});

test("web keyboard inset: 0 without focus, for toolbar-sized changes, and when pinch-zoomed", () => {
  assert.equal(webKeyboardInset({ innerHeight: 844, viewportHeight: 508, scale: 1, fieldFocused: false }), 0);
  assert.equal(webKeyboardInset({ innerHeight: 844, viewportHeight: 844 - (WEB_KEYBOARD_MIN_PX - 1), scale: 1, fieldFocused: true }), 0);
  assert.equal(webKeyboardInset({ innerHeight: 844, viewportHeight: 400, scale: 2, fieldFocused: true }), 0);
  assert.equal(webKeyboardInset({ innerHeight: Number.NaN, viewportHeight: 400, scale: 1, fieldFocused: true }), 0);
});

const conv = "c1";
const me = "u1";
const row = (id: string, text: string, created_at: string) => ({ id, conversation_id: conv, sender_id: me, text, created_at });
const pend = (tempId: string, text: string, created_at: string, extra: { sent?: boolean; serverId?: string } = {}) => ({
  tempId,
  conversation_id: conv,
  sender_id: me,
  text,
  created_at,
  ...extra,
});

test("pending DM: the reported bug -- phone clock ahead of the server no longer leaves a second bubble", () => {
  // Phone thinks 12:00:00.500, server stored 12:00:00.200 (clock 300ms ahead).
  const p = pend("temp-1", "long pasted text", "2026-11-04T12:00:00.500Z", { sent: true, serverId: "m1" });
  const rows = [row("m1", "long pasted text", "2026-11-04T12:00:00.200123+00:00")];
  assert.deepEqual(reconcilePendingDms([p], rows), [], "matched by id: dropped");
  // The old rule (string compare, row >= pending) kept it:
  assert.equal(rows[0].created_at >= p.created_at, false);
});

test("pending DM: same-millisecond string compare no longer fails", () => {
  const p = pend("temp-1", "x", "2026-11-04T12:00:00.123Z", { sent: true });
  const rows = [row("m1", "x", "2026-11-04T12:00:00.123456+00:00")];
  assert.equal(rows[0].created_at >= p.created_at, false, "old string compare said 'earlier'");
  assert.deepEqual(reconcilePendingDms([p], rows), [], "content fallback compares as times");
});

test("pending DM: in flight is kept (no blink); sent but row not fetched yet is kept", () => {
  const inFlight = pend("temp-1", "hi", "2026-11-04T12:00:00.000Z");
  const sent = pend("temp-2", "yo", "2026-11-04T12:00:01.000Z", { sent: true, serverId: "m9" });
  const pending = [inFlight, sent];
  assert.equal(reconcilePendingDms(pending, [row("m1", "hi", "2026-11-04T12:00:00.100Z")]), pending, "same array back: nothing dropped");
});

test("pending DM: two identical sends each claim their own row", () => {
  const a = pend("temp-a", "ok", "2026-11-04T12:00:00.000Z", { sent: true });
  const b = pend("temp-b", "ok", "2026-11-04T12:00:01.000Z", { sent: true });
  const one = reconcilePendingDms([a, b], [row("m1", "ok", "2026-11-04T12:00:00.050Z")]);
  assert.equal(one.length, 1, "one row arrived: one pending left");
  assert.deepEqual(reconcilePendingDms([a, b], [row("m1", "ok", "2026-11-04T12:00:00.050Z"), row("m2", "ok", "2026-11-04T12:00:01.050Z")]), []);
});

test("pending DM: a row claimed by id never satisfies another pending's content match", () => {
  const byId = pend("temp-a", "ok", "2026-11-04T12:00:00.000Z", { sent: true, serverId: "m1" });
  const byContent = pend("temp-b", "ok", "2026-11-04T12:00:01.000Z", { sent: true });
  const left = reconcilePendingDms([byId, byContent], [row("m1", "ok", "2026-11-04T12:00:00.050Z")]);
  assert.deepEqual(left.map((p) => p.tempId), ["temp-b"]);
});

test("pending DM: content fallback ignores rows older than the skew allowance", () => {
  const p = pend("temp-1", "ok", "2026-11-04T12:10:00.000Z", { sent: true });
  const old = row("m0", "ok", new Date(Date.parse(p.created_at) - DM_MATCH_SKEW_MS - 1000).toISOString());
  assert.equal(reconcilePendingDms([p], [old]).length, 1, "an old identical message is not this send's echo");
});

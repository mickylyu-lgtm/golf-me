// Run: npm test (node --test, built-in type stripping)
// Admin analytics client helpers: reporting-timezone ranges (incl. DST and
// the local-midnight edge), "not set up" vs error vs data, keeping the last
// good numbers on a failed refresh, backoff, live/stale/paused, and labels
// that never turn "no data" into 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  classifyRpcError,
  daysInclusive,
  fmtDuration,
  fmtRate,
  fmtRetention,
  liveStatus,
  nextDelayMs,
  nextSectionState,
  presetRange,
  reportingToday,
  validateRange,
} from "../src/lib/adminAnalytics.ts";
import type { SectionState } from "../src/lib/adminAnalytics.ts";

test("reporting day follows America/New_York, not UTC", () => {
  // 03:30 UTC on Nov 8 is still Nov 7 in New York (EST, UTC-5).
  assert.equal(reportingToday(new Date("2026-11-08T03:30:00Z")), "2026-11-07");
  assert.equal(reportingToday(new Date("2026-11-08T05:00:00Z")), "2026-11-08");
  // Summer (EDT, UTC-4): midnight is 04:00 UTC.
  assert.equal(reportingToday(new Date("2026-07-01T03:59:00Z")), "2026-06-30");
  assert.equal(reportingToday(new Date("2026-07-01T04:00:00Z")), "2026-07-01");
});

test("presets end today and are inclusive", () => {
  const now = new Date("2026-03-10T15:00:00Z");
  assert.deepEqual(presetRange("today", now), { from: "2026-03-10", to: "2026-03-10" });
  assert.deepEqual(presetRange("7d", now), { from: "2026-03-04", to: "2026-03-10" });
  assert.equal(daysInclusive(presetRange("7d", now)), 7);
  assert.equal(daysInclusive(presetRange("30d", now)), 30);
  // Calendar arithmetic is unaffected by the DST change on Mar 8.
  assert.equal(addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

test("custom ranges are validated like the server does", () => {
  const now = new Date("2026-11-08T15:00:00Z");
  assert.equal(validateRange({ from: "2026-11-01", to: "2026-11-08" }, now), null);
  assert.match(validateRange({ from: "2026-11-08", to: "2026-11-01" }, now) ?? "", /before/);
  assert.match(validateRange({ from: "2026-11-09", to: "2026-11-10" }, now) ?? "", /future/);
  assert.match(validateRange({ from: "2025-01-01", to: "2026-11-08" }, now) ?? "", /366/);
  assert.match(validateRange({ from: "", to: "2026-11-08" }, now) ?? "", /Pick/);
});

test("a missing RPC is 'unavailable', not an error and not zero", () => {
  assert.equal(classifyRpcError({ code: "PGRST202", message: "Could not find the function public.admin_analytics_activity" }).kind, "unavailable");
  assert.equal(classifyRpcError({ code: "42883", message: "function does not exist" }).kind, "unavailable");
  const denied = classifyRpcError({ code: "42501", message: "Not authorized." });
  assert.equal(denied.kind, "error");
  assert.equal(classifyRpcError({ code: "57014", message: "canceling statement due to statement timeout" }).kind, "error");
});

test("a failed refresh keeps the last good data, marked as an error", () => {
  let s: SectionState<{ n: number }> = { kind: "loading" };
  s = nextSectionState(s, { data: { n: 5 } });
  assert.deepEqual(s, { kind: "ok", data: { n: 5 } });
  s = nextSectionState(s, { error: { code: "57014", message: "timeout" } });
  assert.deepEqual(s, { kind: "error", message: "timeout", data: { n: 5 } });
  s = nextSectionState(s, { error: { code: "57014", message: "timeout again" } });
  assert.equal(s.kind === "error" && s.data?.n, 5);
  s = nextSectionState(s, { data: { n: 6 } });
  assert.deepEqual(s, { kind: "ok", data: { n: 6 } });
  // First load failing: no data at all (the UI shows nothing, not 0).
  const first = nextSectionState<{ n: number }>({ kind: "loading" }, { error: { message: "boom" } });
  assert.deepEqual(first, { kind: "error", message: "boom", data: undefined });
});

test("backoff: 30 s healthy, doubling after failures, capped at 5 min", () => {
  assert.equal(nextDelayMs(0), 30_000);
  assert.equal(nextDelayMs(1), 60_000);
  assert.equal(nextDelayMs(2), 120_000);
  assert.equal(nextDelayMs(3), 240_000);
  assert.equal(nextDelayMs(4), 300_000);
  assert.equal(nextDelayMs(20), 300_000);
});

test("live / stale / paused / not set up", () => {
  const now = 1_000_000;
  assert.equal(liveStatus({ hidden: false, lastSuccessAt: null, now, notSetUp: false }), "starting");
  assert.equal(liveStatus({ hidden: false, lastSuccessAt: now - 20_000, now, notSetUp: false }), "live");
  assert.equal(liveStatus({ hidden: false, lastSuccessAt: now - 64_000, now, notSetUp: false }), "live");
  assert.equal(liveStatus({ hidden: false, lastSuccessAt: now - 66_000, now, notSetUp: false }), "stale");
  assert.equal(liveStatus({ hidden: true, lastSuccessAt: now - 999_000, now, notSetUp: false }), "paused");
  assert.equal(liveStatus({ hidden: false, lastSuccessAt: null, now, notSetUp: true }), "not_set_up");
});

test("labels never invent a zero", () => {
  assert.equal(fmtRate(0, 0), "—");
  assert.equal(fmtRate(null, 10), "—");
  assert.equal(fmtRate(3, 4), "75%");
  assert.equal(fmtRate(0, 4), "0%");
  assert.deepEqual(fmtRetention({ mature_users: 0, retained: 0, pending_users: 3 }), { value: "Pending", detail: "3 too recent to measure" });
  assert.deepEqual(fmtRetention({ mature_users: 0, retained: 0, pending_users: 0 }), { value: "Pending", detail: "No signups in range" });
  assert.deepEqual(fmtRetention({ mature_users: 4, retained: 1, pending_users: 2 }), { value: "25%", detail: "1 of 4 · 2 pending" });
  assert.equal(fmtDuration(null), "—");
  assert.equal(fmtDuration("45.4"), "45 min");
  assert.equal(fmtDuration(150), "2.5 h");
  assert.equal(fmtDuration(3 * 1440), "3 days");
});

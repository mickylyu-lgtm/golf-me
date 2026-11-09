// Run: npm run test  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAFETY_STATUSES,
  allowedTransitions,
  availabilityFrom,
  detectorNotice,
  flagSummary,
  formatWindow,
  sinceIso,
  transitionNeedsReason,
  type SafetyStatusPayload,
} from "../src/lib/safetyReview.ts";

const base: SafetyStatusPayload = {
  detector_enabled: true,
  last_run_at: "2026-11-08T12:00:00Z",
  last_run_ok: true,
  last_run_error: null,
  unconfirmed_retention_days: 30,
  confirmed_retention_days: 365,
  rules: [],
  open_counts: {},
};

test("transitions mirror the server (admin_safety_review)", () => {
  assert.deepEqual(allowedTransitions("new"), ["in_review", "dismissed", "actioned"]);
  assert.deepEqual(allowedTransitions("actioned"), ["appealed"]);
  assert.deepEqual(allowedTransitions("dismissed"), ["in_review"]);
  for (const s of SAFETY_STATUSES) assert.ok(!allowedTransitions(s).includes(s), `${s} -> itself`);
  assert.equal(transitionNeedsReason("dismissed"), true);
  assert.equal(transitionNeedsReason("in_review"), false);
});

test("flag summaries name count, window, threshold and rule version", () => {
  assert.equal(flagSummary({ signal: "new_recipients", observed_count: 12, threshold: 10, window_seconds: 600, rule_version: 1 }), "12 new conversations started in 10 minutes (threshold 10, rule v1)");
  assert.equal(formatWindow(86400), "24 hours");
  assert.equal(formatWindow(3600), "1 hour");
  assert.equal(formatWindow(172800), "2 days");
});

test("availability: missing migration vs failure vs ready", () => {
  assert.deepEqual(availabilityFrom(null, { code: "PGRST202", message: "Could not find the function public.admin_safety_status" }), { kind: "not_installed" });
  assert.equal(availabilityFrom(null, { code: "42501", message: "Not authorized." }).kind, "error");
  assert.equal(availabilityFrom(null, null).kind, "error");
  assert.equal(availabilityFrom(base, null).kind, "ready");
});

test("detector problems never read as 'no abuse'", () => {
  const now = new Date("2026-11-08T12:05:00Z").getTime();
  assert.equal(detectorNotice({ ...base, detector_enabled: false }, now).tone, "off");
  assert.equal(detectorNotice({ ...base, last_run_ok: false, last_run_error: "boom" }, now).tone, "error");
  assert.match(detectorNotice({ ...base, last_run_ok: false }, now).text, /don't mean there's no abuse/);
  assert.equal(detectorNotice({ ...base, last_run_at: null, last_run_ok: null }, now).tone, "stale");
  assert.equal(detectorNotice(base, new Date("2026-11-08T13:00:00Z").getTime()).tone, "stale");
  assert.equal(detectorNotice(base, now).tone, "ok");
});

test("date filter", () => {
  const now = Date.UTC(2026, 10, 8, 12);
  assert.equal(sinceIso("24h", now), "2026-11-07T12:00:00.000Z");
  assert.equal(sinceIso("all", now), null);
});

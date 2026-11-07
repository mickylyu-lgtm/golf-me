// Run: npm run test:trust  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODERATION_REASONS,
  MODERATION_UNAVAILABLE,
  isAccountSuspendedError,
  isMissingFunctionError,
  moderationInputProblem,
  moderationReasonLabel,
  parseModerationStatus,
  suspensionUntil,
} from "../src/lib/moderation.ts";

test("reason keys match the server picklist", () => {
  assert.deepEqual([...MODERATION_REASONS], ["impersonation", "spam", "harassment", "hate", "sexual", "violence", "scam", "other"]);
  assert.equal(moderationReasonLabel("other"), "Other");
  assert.equal(moderationReasonLabel("impersonation"), "Impersonation");
  assert.equal(moderationReasonLabel("unknown_key"), "unknown_key");
});

test("input checks mirror private.moderation_check_reason", () => {
  assert.equal(moderationInputProblem(null, ""), "Pick a reason.");
  assert.equal(moderationInputProblem("bogus", ""), "Pick a reason.");
  assert.match(moderationInputProblem("other", "   ") ?? "", /note/);
  assert.equal(moderationInputProblem("other", "Pretends to be Elon"), null);
  assert.equal(moderationInputProblem("spam", ""), null);
  assert.match(moderationInputProblem("spam", "x".repeat(501)) ?? "", /500/);
});

test("suspension end times", () => {
  const now = Date.UTC(2026, 10, 7, 12, 0, 0);
  assert.equal(suspensionUntil("1d", now), "2026-11-08T12:00:00.000Z");
  assert.equal(suspensionUntil("7d", now), "2026-11-14T12:00:00.000Z");
  assert.equal(suspensionUntil("indefinite", now), null);
});

test("suspended errors are recognised in message or hint, raw or wrapped", () => {
  assert.equal(isAccountSuspendedError({ code: "P0001", message: "account_suspended: Your account is suspended", hint: "account_suspended" }), true);
  assert.equal(isAccountSuspendedError(new Error("account_suspended: Your account is suspended")), true);
  assert.equal(isAccountSuspendedError({ message: "objectionable_content: nope", hint: "objectionable_content" }), false);
  assert.equal(isAccountSuspendedError(null), false);
  assert.equal(isAccountSuspendedError("account_suspended"), false);
});

test("feature detection: a missing function keeps every control off", () => {
  assert.equal(isMissingFunctionError({ code: "PGRST202", message: "Could not find the function public.my_moderation_status" }), true);
  assert.equal(isMissingFunctionError({ code: "42883", message: "function does not exist" }), true);
  assert.equal(isMissingFunctionError({ code: "42501", message: "Not authorized." }), false);
  assert.deepEqual(parseModerationStatus(null, { code: "PGRST202", message: "Could not find the function" }), MODERATION_UNAVAILABLE);
  // Any other failure also fails closed (UI only; the server still enforces).
  assert.deepEqual(parseModerationStatus(null, { code: "500", message: "boom" }), MODERATION_UNAVAILABLE);
  assert.deepEqual(parseModerationStatus([], null), MODERATION_UNAVAILABLE);
});

test("status rows", () => {
  assert.deepEqual(parseModerationStatus([{ is_admin: true, suspended: false, suspended_until: null }], null), {
    available: true,
    isAdmin: true,
    suspended: false,
    suspendedUntil: null,
  });
  assert.deepEqual(parseModerationStatus([{ is_admin: false, suspended: true, suspended_until: "2026-11-14T12:00:00+00:00" }], null), {
    available: true,
    isAdmin: false,
    suspended: true,
    suspendedUntil: "2026-11-14T12:00:00+00:00",
  });
  // Indefinite
  assert.equal(parseModerationStatus({ is_admin: false, suspended: true, suspended_until: null }, null).suspendedUntil, null);
  // An end date without suspended=true is ignored
  assert.equal(parseModerationStatus([{ is_admin: false, suspended: false, suspended_until: "2026-11-14T12:00:00Z" }], null).suspendedUntil, null);
});

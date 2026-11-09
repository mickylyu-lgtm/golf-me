// Run: npm run test:trust  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isMissingColumnError, reportErrorKind, reportRow } from "../src/lib/reportRow.ts";

test("report refusals are told apart from network failures", () => {
  assert.equal(reportErrorKind(new Error("report_target_invalid")), "invalid");
  assert.equal(reportErrorKind({ code: "P0001", message: "x", hint: "report_target_invalid" }), "invalid");
  assert.equal(reportErrorKind(new Error("report_rate_limited")), "rate");
  assert.equal(reportErrorKind(new Error("Failed to fetch")), "network");
  assert.equal(reportErrorKind(null), "network");
});

const base = { reporterId: "me", reportedUserId: "them", category: "Spam", details: "rude", context: "post" };

test("post and comment reports carry their content ids", () => {
  const row = reportRow({ ...base, postId: "p1", commentId: "c1" }, true);
  assert.equal(row.reported_post_id, "p1");
  assert.equal(row.reported_comment_id, "c1");
  assert.equal(row.round_id, null);
  assert.equal(row.reported_message_id, null);
  assert.equal(row.details, "rude");
});

test("round and chat reports keep their ids", () => {
  const row = reportRow({ ...base, context: "chat", golfCallId: "g1", messageId: "m1" }, true);
  assert.equal(row.round_id, "g1");
  assert.equal(row.reported_message_id, "m1");
});

test("without the new columns the ids go into the details instead of being lost", () => {
  const row = reportRow({ ...base, postId: "p1", commentId: "c1" }, false);
  assert.equal("reported_post_id" in row, false);
  assert.equal(row.details, "rude\n[post p1, comment c1]");
  assert.equal(reportRow({ ...base, details: "", postId: "p1" }, false).details, "[post p1]");
  assert.equal(reportRow({ ...base }, false).details, "rude");
});

test("missing-column errors are recognised; others are not", () => {
  assert.equal(isMissingColumnError({ code: "PGRST204", message: "Could not find the 'reported_post_id' column" }), true);
  assert.equal(isMissingColumnError({ code: "42703" }), true);
  assert.equal(isMissingColumnError({ code: "42501", message: "new row violates row-level security policy" }), false);
  assert.equal(isMissingColumnError(null), false);
});

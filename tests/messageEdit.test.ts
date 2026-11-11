// Run: npm run test:chat  (node --test, built-in type stripping)
// Edit my own text message within 5 minutes: when Edit is offered, how the
// RPC's answer and errors are read, the demo rules, and the menu order.
// The server side (the real boundary, access, suspension, forged requests)
// is tested on PGlite: scratchpad pglite/_message_edit.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDIT_WINDOW_MS,
  canEditMessage,
  classifyEditError,
  demoEdit,
  editDraftState,
  editRemainingMs,
  isMissingEditRpc,
  isTextMessage,
  normalizeEditText,
  parseEditResponse,
  messagesWithEditor,
} from "../src/lib/messageEdit.ts";
import { UNSEND_WINDOW_MS } from "../src/lib/unsend.ts";
import { messageActions } from "../src/lib/messageLongPress.ts";

const sentAt = "2026-11-08T12:00:00.000Z";
const t0 = Date.parse(sentAt);
const mine = { id: "m1", senderId: "me", createdAt: sentAt, text: "hello", unsentAt: null };

test("edit: offered for my own text message strictly inside 5 minutes", () => {
  assert.equal(EDIT_WINDOW_MS, 5 * 60 * 1000);
  assert.equal(EDIT_WINDOW_MS, UNSEND_WINDOW_MS, "the same window as unsend");
  assert.equal(canEditMessage(mine, "me", t0), true);
  assert.equal(canEditMessage(mine, "me", t0 + EDIT_WINDOW_MS - 1), true, "4:59.999");
  assert.equal(canEditMessage(mine, "me", t0 + EDIT_WINDOW_MS), false, "exactly 5:00 is too late (server: now() < created_at + 5 min)");
  assert.equal(canEditMessage(mine, "me", t0 + EDIT_WINDOW_MS + 1), false);
  assert.equal(editRemainingMs(sentAt, t0 + 60_000), EDIT_WINDOW_MS - 60_000);
  assert.equal(editRemainingMs(sentAt, t0 + EDIT_WINDOW_MS + 5), 0);
  assert.equal(editRemainingMs("garbage", t0), 0);
});

test("edit: never someone else's, unsent, system, sending, failed or temp message", () => {
  assert.equal(canEditMessage(mine, "other", t0 + 1000), false);
  assert.equal(canEditMessage(mine, "", t0 + 1000), false);
  assert.equal(canEditMessage({ ...mine, unsentAt: sentAt }, "me", t0 + 1000), false);
  assert.equal(canEditMessage({ ...mine, system: true }, "me", t0 + 1000), false);
  assert.equal(canEditMessage({ ...mine, delivery: "sending" }, "me", t0 + 1000), false);
  assert.equal(canEditMessage({ ...mine, delivery: "failed" }, "me", t0 + 1000), false);
  assert.equal(canEditMessage({ ...mine, id: "temp-1" }, "me", t0 + 1000), false);
  assert.equal(canEditMessage({ ...mine, createdAt: "garbage" }, "me", t0 + 1000), false);
});

test("edit: text messages only (no photo / voice / video / album, even with a caption)", () => {
  assert.equal(isTextMessage(mine), true);
  for (const extra of [{ image: { path: "x" } }, { voice: { path: "x" } }, { media: [{ kind: "image" }] }]) {
    assert.equal(isTextMessage({ ...mine, ...extra }), false);
    assert.equal(canEditMessage({ ...mine, ...extra }, "me", t0 + 1000), false);
  }
  assert.equal(isTextMessage({ ...mine, text: "  " }), false);
});

test("edit: the device clock only decides the offer; a slow clock offers late, a fast one hides early", () => {
  // The server then answers "expired" (slow clock) and the sheet keeps the text.
  assert.equal(canEditMessage(mine, "me", t0 - 2000), true, "clock behind the send time still offers it");
  assert.equal(canEditMessage(mine, "me", t0 + EDIT_WINDOW_MS + 60_000), false);
});

test("edit: trim + draft state like a send", () => {
  assert.equal(normalizeEditText("  hi \n"), "hi");
  assert.equal(normalizeEditText(String.fromCharCode(0xa0, 0x20) + "hi" + String.fromCharCode(0xfeff)), "hi");
  assert.equal(editDraftState("   ", "hello"), "empty");
  assert.equal(editDraftState(" hello ", "hello"), "unchanged");
  assert.equal(editDraftState("hello!", "hello"), "ready");
});

test("edit: RPC errors are read by their hint", () => {
  const e = (hint: string, extra: Record<string, unknown> = {}) => ({ hint, message: `${hint}: x`, ...extra });
  assert.equal(classifyEditError(e("edit_window_expired")), "expired");
  assert.equal(classifyEditError(e("edit_message_unsent")), "unsent");
  assert.equal(classifyEditError(e("edit_conflict")), "conflict");
  assert.equal(classifyEditError(e("edit_empty")), "empty");
  assert.equal(classifyEditError(e("edit_not_text")), "notText");
  assert.equal(classifyEditError(e("edit_not_allowed", { code: "42501" })), "notAllowed");
  assert.equal(classifyEditError({ message: "objectionable_content: x", hint: "objectionable_content" }), "objectionable");
  assert.equal(classifyEditError(e("account_suspended")), "suspended");
  assert.equal(classifyEditError({ message: "edit_window_expired: messages can only..." }), "expired", "message prefix alone");
  assert.equal(classifyEditError({ message: "Failed to fetch" }), "failed", "offline");
  assert.equal(classifyEditError(null), "failed");
});

test("edit: a missing RPC means 'not deployed yet' (Edit is hidden)", () => {
  assert.equal(isMissingEditRpc({ code: "PGRST202", message: "Could not find the function public.edit_message(p_message_id, p_text) in the schema cache" }), true);
  assert.equal(isMissingEditRpc({ code: "42883", message: "function public.edit_round_message does not exist" }), true);
  assert.equal(isMissingEditRpc({ message: "Could not find the function public.edit_round_message(p_message_id, p_text)" }), true);
  assert.equal(isMissingEditRpc({ code: "42501", hint: "edit_not_allowed" }), false);
  assert.equal(classifyEditError({ code: "PGRST202", message: "Could not find the function public.edit_message" }), "unsupported");
});

test("edit: the RPC's answer", () => {
  assert.deepEqual(parseEditResponse({ status: "edited", text: "hi", edited_at: "2026-11-08T12:01:00+00:00" }), {
    status: "edited",
    text: "hi",
    editedAt: "2026-11-08T12:01:00+00:00",
  });
  assert.deepEqual(parseEditResponse({ status: "unchanged", text: "hi", edited_at: null }), { status: "unchanged", text: "hi", editedAt: null });
  assert.equal(parseEditResponse({ status: "weird", text: "hi" }), null);
  assert.equal(parseEditResponse(null), null);
});

test("edit (demo): the same rules and order as the server", () => {
  const at = (ms: number) => t0 + ms;
  assert.deepEqual(demoEdit(undefined, "me", "x", undefined, at(1000)), { result: "notAllowed" });
  assert.deepEqual(demoEdit(mine, "other", "x", undefined, at(1000)), { result: "notAllowed" });
  assert.deepEqual(demoEdit({ ...mine, system: true }, "me", "x", undefined, at(1000)), { result: "notAllowed" });
  assert.deepEqual(demoEdit({ ...mine, unsentAt: sentAt, text: "" }, "me", "x", undefined, at(1000)), { result: "unsent" });
  assert.deepEqual(demoEdit({ ...mine, image: { path: "p" } }, "me", "x", undefined, at(1000)), { result: "notText" });
  assert.deepEqual(demoEdit(mine, "me", "x", undefined, at(EDIT_WINDOW_MS)), { result: "expired" });
  assert.deepEqual(demoEdit(mine, "me", "   ", undefined, at(1000)), { result: "empty" });
  assert.deepEqual(demoEdit(mine, "me", " hello ", undefined, at(1000)), { result: "unchanged" });
  assert.deepEqual(demoEdit(mine, "me", "new", "stale text", at(1000)), { result: "conflict" });
  const ok = demoEdit(mine, "me", " new ", "hello", at(1000));
  assert.equal(ok.result, "edited");
  assert.equal(ok.text, "new");
  assert.equal(ok.editedAt, new Date(at(1000)).toISOString());
});

test("edit (demo): editing again never restarts the window", () => {
  const first = demoEdit(mine, "me", "v2", undefined, t0 + 4 * 60_000);
  assert.equal(first.result, "edited");
  const edited = { ...mine, text: first.text!, editedAt: first.editedAt };
  assert.equal(demoEdit(edited, "me", "v3", undefined, t0 + 4 * 60_000 + 59_000).result, "edited");
  assert.equal(demoEdit(edited, "me", "v3", undefined, t0 + 5 * 60_000).result, "expired", "5:00 after the ORIGINAL send, 1:00 after the edit");
  assert.equal(canEditMessage(edited, "me", t0 + 5 * 60_000), false);
});

test("edit: menu order Reply, Copy, Edit, Unsend; Edit only when allowed", () => {
  assert.deepEqual(messageActions({ canReply: true, canUnsend: true, canEdit: true }), ["reply", "copy", "edit", "unsend"]);
  assert.deepEqual(messageActions({ canReply: true, canUnsend: true }), ["reply", "copy", "unsend"]);
  assert.deepEqual(messageActions({ canReply: false, canUnsend: false, canEdit: true, canCopy: false }), ["edit"]);
});

test("inline edit: a removed message keeps its editor row without changing the source list", () => {
  const rows = [{ id: "a" }, { id: "b" }];
  const editing = { message: { id: "removed" }, index: 1 };
  assert.deepEqual(messagesWithEditor(rows, editing).map((row) => row.id), ["a", "removed", "b"]);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b"]);
  assert.equal(messagesWithEditor(rows, null), rows);
  assert.equal(messagesWithEditor(rows, { message: rows[0], index: 0 }), rows);
  assert.deepEqual(messagesWithEditor([], editing), [editing.message]);
  assert.deepEqual(messagesWithEditor(rows, { ...editing, index: 100 }).map((row) => row.id), ["a", "b", "removed"]);
});

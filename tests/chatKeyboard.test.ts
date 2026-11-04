// Run: npm run test:chat  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isImeComposing, isSendEnter } from "../src/lib/isImeComposing.ts";
import { NEAR_BOTTOM_PX, isNearBottom, pinToBottom, shouldPinToBottom } from "../src/lib/chatScroll.ts";
import { focusMovedToOtherField, isTextEntryElement, nextComposerOwnsFocus } from "../src/lib/composerFocus.ts";

test("IME: an Enter that confirms a candidate never sends", () => {
  // React event: isComposing lives on nativeEvent.
  assert.equal(isSendEnter({ key: "Enter", nativeEvent: { isComposing: true } }), false);
  // Safari: confirming keydown after compositionend, isComposing false, keyCode 229.
  assert.equal(isSendEnter({ key: "Enter", keyCode: 229, nativeEvent: { isComposing: false, keyCode: 229 } }), false);
  // Native event shape.
  assert.equal(isImeComposing({ isComposing: true }), true);
  assert.equal(isImeComposing({ keyCode: 229 }), true);
});

test("plain Enter sends, Shift+Enter and other keys don't", () => {
  assert.equal(isSendEnter({ key: "Enter", keyCode: 13, nativeEvent: { isComposing: false, keyCode: 13 } }), true);
  assert.equal(isSendEnter({ key: "Enter", shiftKey: true, keyCode: 13 }), false);
  assert.equal(isSendEnter({ key: "a", keyCode: 65 }), false);
  assert.equal(isImeComposing({ keyCode: 13, nativeEvent: { isComposing: false } }), false);
});

test("near bottom: within 120px of the end", () => {
  assert.equal(NEAR_BOTTOM_PX, 120);
  assert.equal(isNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 }), true);
  assert.equal(isNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 481 }), true);
  assert.equal(isNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 480 }), false, "120px up is reading back");
  assert.equal(isNearBottom({ scrollHeight: 300, clientHeight: 400, scrollTop: 0 }), true, "a list that doesn't overflow");
});

test("new message: pin only when near the bottom or just sent", () => {
  assert.equal(shouldPinToBottom({ nearBottom: true, justSent: false }), true);
  assert.equal(shouldPinToBottom({ nearBottom: false, justSent: false }), false, "reading older messages: not yanked down");
  assert.equal(shouldPinToBottom({ nearBottom: false, justSent: true }), true, "own message always shows");
  const list = { scrollHeight: 900, scrollTop: 10 };
  pinToBottom(list);
  assert.equal(list.scrollTop, 900);
});

test("text fields: inputs, textareas, contenteditable; not buttons/checkboxes", () => {
  assert.equal(isTextEntryElement({ tagName: "TEXTAREA" }), true);
  assert.equal(isTextEntryElement({ tagName: "INPUT", type: "text" }), true);
  assert.equal(isTextEntryElement({ tagName: "INPUT", type: "search" }), true);
  assert.equal(isTextEntryElement({ tagName: "INPUT" }), true, "no type is text");
  assert.equal(isTextEntryElement({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(isTextEntryElement({ tagName: "BUTTON", type: "submit" }), false);
  assert.equal(isTextEntryElement({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTextEntryElement({ tagName: "DIV" }), false);
  assert.equal(isTextEntryElement(null), false);
});

test("composer owns the keyboard only for its own field", () => {
  // Focus into the composer: owns.
  assert.equal(nextComposerOwnsFocus(false, { insideComposer: true, isTextField: true }), true);
  // An inline reply / a sheet's textarea: doesn't own (no dock, no page lock).
  assert.equal(nextComposerOwnsFocus(true, { insideComposer: false, isTextField: true }), false);
  assert.equal(nextComposerOwnsFocus(false, { insideComposer: false, isTextField: true }), false);
  // A button or nothing: unchanged (tapping Post keeps today's behaviour).
  assert.equal(nextComposerOwnsFocus(true, { insideComposer: false, isTextField: false }), true);
  assert.equal(nextComposerOwnsFocus(false, { insideComposer: false, isTextField: false }), false);
});

test("undock: no scroll-back when another field took the keyboard", () => {
  assert.equal(focusMovedToOtherField({ tagName: "INPUT", type: "text" }, false), true);
  assert.equal(focusMovedToOtherField({ tagName: "TEXTAREA" }, true), false, "still in the composer");
  assert.equal(focusMovedToOtherField({ tagName: "BODY" }, false), false, "keyboard closed: put the page back");
  assert.equal(focusMovedToOtherField(null, false), false);
});

// Run: npm run test:chat  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { DM_THREAD_PATH, KEYBOARD_GAP_PX, isDmThreadPath, isTextEntryElement, textEntryElement } from "../src/lib/keyboard/fields.ts";
import { isTextEntryElement as fromComposerFocus } from "../src/lib/composerFocus.ts";
import { KEYBOARD_GAP_PX as fromRevealFocusedField } from "../src/lib/revealFocusedField.ts";

test("text fields bring up the keyboard", () => {
  assert.equal(isTextEntryElement({ tagName: "TEXTAREA" }), true);
  assert.equal(isTextEntryElement({ tagName: "textarea" }), true, "tag case doesn't matter");
  for (const type of ["text", "search", "email", "tel", "url", "number", "password"]) {
    assert.equal(isTextEntryElement({ tagName: "INPUT", type }), true, type);
  }
  assert.equal(isTextEntryElement({ tagName: "INPUT" }), true, "no type is text");
  assert.equal(isTextEntryElement({ tagName: "INPUT", type: "" }), true, "empty type is text");
  assert.equal(isTextEntryElement({ tagName: "INPUT", type: "SEARCH" }), true, "type case doesn't matter");
  assert.equal(isTextEntryElement({ tagName: "DIV", isContentEditable: true }), true);
});

test("non-text inputs, including the date/time pickers, don't", () => {
  for (const type of ["button", "checkbox", "color", "date", "datetime-local", "file", "hidden", "image", "month", "radio", "range", "reset", "submit", "time", "week"]) {
    assert.equal(isTextEntryElement({ tagName: "INPUT", type }), false, type);
  }
  assert.equal(isTextEntryElement({ tagName: "BUTTON", type: "submit" }), false);
  assert.equal(isTextEntryElement({ tagName: "SELECT" }), false);
  assert.equal(isTextEntryElement({ tagName: "DIV" }), false);
  assert.equal(isTextEntryElement({ tagName: "DIV", isContentEditable: false }), false);
  assert.equal(isTextEntryElement(null), false);
  assert.equal(isTextEntryElement(undefined), false);
});

test("textEntryElement is null without a DOM (and for non-elements)", () => {
  assert.equal(textEntryElement(null), null);
  assert.equal(textEntryElement(undefined), null);
});

test("one rule and one gap, re-exported where they used to live", () => {
  assert.equal(fromComposerFocus, isTextEntryElement);
  assert.equal(fromRevealFocusedField, KEYBOARD_GAP_PX);
  assert.equal(KEYBOARD_GAP_PX, 12);
});

test("DM thread route", () => {
  assert.equal(isDmThreadPath("/messages/abc"), true);
  assert.equal(isDmThreadPath("/messages/abc/"), true);
  assert.equal(isDmThreadPath("/messages"), false);
  assert.equal(isDmThreadPath("/messages/"), false);
  assert.equal(isDmThreadPath("/messages/abc/info"), false);
  assert.equal(DM_THREAD_PATH.test("/community/post/1"), false);
});

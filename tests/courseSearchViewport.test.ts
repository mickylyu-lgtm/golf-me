import { test } from "node:test";
import assert from "node:assert/strict";
import { courseSearchViewport, courseSearchListHeight } from "../src/lib/courseSearchViewport.ts";
const base = { height: 844, keyboardHeight: 0, viewportTop: 0, viewportHeight: 844, headerBottom: 100 };
test("native body resize bounds options above keyboard", () => {
  const b = courseSearchViewport({ ...base, keyboardHeight: 320 });
  assert.deepEqual(b, { top:112, bottom:512 });
  assert.equal(courseSearchListHeight(390,b.bottom),122);
});
test("Safari viewport shrink and pan are respected", () => {
  assert.deepEqual(courseSearchViewport({ ...base, viewportTop:30, viewportHeight:494 }), {top:112,bottom:512});
});
test("native and visual viewport describe one keyboard, never double-subtracted", () => {
  assert.equal(courseSearchViewport({...base, keyboardHeight:320, viewportHeight:524}).bottom,512);
});
test("bounded list never goes below visible band or exceeds desktop maximum", () => {
  assert.equal(courseSearchListHeight(390,512),122);
  assert.equal(courseSearchListHeight(100,832),256);
  assert.equal(courseSearchListHeight(550,512),0);
});
test("pan above fixed header leaves a visible top gap", () => {
  assert.equal(courseSearchViewport({...base,viewportTop:150,viewportHeight:374}).top,162);
});

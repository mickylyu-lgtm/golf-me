// Run: npm run test:trust  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPageScrollLocked, lockPageScroll } from "../src/lib/scrollLock.ts";

test("locks are counted: released in any order, the page comes back", () => {
  const body = { style: { overflow: "auto" } };
  const dock = lockPageScroll(body);
  const sheet = lockPageScroll(body);
  assert.equal(body.style.overflow, "hidden");
  dock(); // the old bug: this restored "" under the still-open sheet
  assert.equal(body.style.overflow, "hidden", "still locked while the sheet is open");
  sheet();
  assert.equal(body.style.overflow, "auto", "original value back, not stuck on hidden");
  assert.equal(isPageScrollLocked(), false);
});

test("releasing twice is harmless", () => {
  const body = { style: { overflow: "" } };
  const a = lockPageScroll(body);
  const b = lockPageScroll(body);
  a();
  a();
  assert.equal(body.style.overflow, "hidden");
  b();
  assert.equal(body.style.overflow, "");
});

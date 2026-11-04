// Run: npm run test:trust  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { openModalCount, pushModal } from "../src/lib/modalStack.ts";

test("only the topmost sheet is on top; closing it hands the top back", () => {
  const findRound = pushModal();
  const locationPicker = pushModal();
  assert.equal(findRound.isTop(), false, "Escape must not close the sheet underneath");
  assert.equal(locationPicker.isTop(), true);
  locationPicker.release();
  assert.equal(findRound.isTop(), true);
  findRound.release();
  assert.equal(openModalCount(), 0);
});

test("a lower sheet closing first leaves the top one on top", () => {
  const a = pushModal();
  const b = pushModal();
  a.release();
  assert.equal(b.isTop(), true);
  a.release(); // twice is harmless
  b.release();
  assert.equal(openModalCount(), 0);
});

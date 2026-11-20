import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldDismissFullscreenMedia } from "../src/lib/fullscreenMediaDismiss.ts";

test("small fast vertical twitches cannot dismiss the viewer", () => {
  assert.equal(shouldDismissFullscreenMedia(12, 16), false);
  assert.equal(shouldDismissFullscreenMedia(20, 25), false);
  assert.equal(shouldDismissFullscreenMedia(23, 1), false);
});

test("deliberate short fast fling and long slow drag still dismiss", () => {
  assert.equal(shouldDismissFullscreenMedia(24, 32), true);
  assert.equal(shouldDismissFullscreenMedia(45, 60), true);
  assert.equal(shouldDismissFullscreenMedia(130, 500), true);
});

test("slow short drag and upward drag still stay open", () => {
  assert.equal(shouldDismissFullscreenMedia(45, 150), false);
  assert.equal(shouldDismissFullscreenMedia(120, 500), false);
  assert.equal(shouldDismissFullscreenMedia(-130, 90), false);
});

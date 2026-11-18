import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/pages/PostDetail.tsx", import.meta.url), "utf8");
test("comment composer owns rounded focus instead of square input ring", () => {
  assert.match(page, /gm-comment-composer flex items-center[^"\n]*rounded-full/);
  assert.match(css, /\.gm-comment-composer:focus-within\s*\{[^}]*border-color:[^}]*box-shadow:/);
  assert.match(css, /\.gm-comment-composer input:focus-visible\s*\{\s*outline: none;/);
});
test("replacement preserves keyboard and forced-colors focus cues", () => {
  assert.match(css, /\.gm-comment-composer:has\(input:focus-visible\)\s*\{[^}]*outline: 2px solid/);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?outline: 2px solid Highlight/);
  assert.match(css, /:focus-visible\s*\{\s*outline: 2px solid var\(--color-fairway-500\)/);
});

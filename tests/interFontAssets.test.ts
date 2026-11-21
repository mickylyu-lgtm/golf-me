import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Inter styles enter Vite directly so their package-relative font assets are rebased", () => {
  const entry = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const tailwindCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const importedWeights = Array.from(
    entry.matchAll(/^import ['"]@fontsource\/inter\/(\d+)\.css['"];?$/gm),
    ([, weight]) => Number(weight),
  );
  assert.deepEqual(importedWeights, [400, 500, 600, 700, 800]);
  assert.doesNotMatch(tailwindCss, /@import\s+["']@fontsource\/inter\//);
});

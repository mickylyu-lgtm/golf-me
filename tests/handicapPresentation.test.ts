// Run: node --test tests/handicapPresentation.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  formatHandicapNumber,
  handicapColorClass,
  handicapLabel,
  handicapTone,
  hasHandicap,
} from "../src/lib/handicapColor.ts";
import type { HandicapTone } from "../src/lib/handicapColor.ts";

const boundaries: [number, HandicapTone][] = [
  [-54.1, "gold"], [-2.3, "gold"], [-0.1, "gold"], [-0, "gold"], [0, "gold"],
  [Number.EPSILON, "violet"], [0.1, "violet"], [4.9, "violet"], [4.9999, "violet"],
  [5, "teal"], [9.9, "teal"], [9.9999, "teal"],
  [10, "forest"], [19.9, "forest"], [19.9999, "forest"],
  [20, "sage"], [29.9, "sage"], [29.9999, "sage"],
  [30, "neutral"], [54, "neutral"], [54.1, "neutral"], [1000, "neutral"],
];
for (const [value, tone] of boundaries) {
  test(`handicap ${value} has the exact ${tone} treatment without rounding`, () => {
    assert.equal(hasHandicap(value), true);
    assert.equal(handicapTone(value), tone);
    assert.equal(handicapColorClass(value), `gm-handicap gm-handicap--${tone}`);
  });
}

test("all finite values preserve stored precision and standard plus notation", () => {
  for (const [value] of boundaries) {
    assert.equal(formatHandicapNumber(value), value < 0 ? `+${Math.abs(value)}` : String(value));
  }
  for (const value of [-2.34567, 2.34567, Number.MIN_VALUE, Number.MAX_VALUE]) {
    assert.equal(formatHandicapNumber(value), value < 0 ? `+${Math.abs(value)}` : String(value));
  }
  assert.equal(formatHandicapNumber(-0), "0");
});

test("unknown and non-finite inputs never become a prestigious handicap", () => {
  for (const value of [null, Number.NaN, Infinity, -Infinity, undefined as unknown as number]) {
    assert.equal(hasHandicap(value), false);
    assert.equal(handicapTone(value), "neutral");
    assert.equal(formatHandicapNumber(value), "--");
  }
});

test("localized labels reuse plus notation without changing the stored number", () => {
  const translated = (key: string, vars?: Record<string, string | number>) =>
    key === "golfCallDetail.noHandicapYet" ? "Not set" : `Index ${vars?.handicap}`;
  assert.equal(handicapLabel(-2.35, translated), "Index +2.35");
  assert.equal(handicapLabel(0, translated), "Index 0");
  assert.equal(handicapLabel(4.9999, translated), "Index 4.9999");
  for (const value of [null, Number.NaN, Infinity, -Infinity]) {
    assert.equal(handicapLabel(value, translated), "Not set");
  }
});

function source(path: string): string {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
const css = source("src/index.css");
function declaration(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`).exec(css);
  assert.ok(match, `missing ${selector}`);
  return match[1];
}
function token(block: string, name: string): string | null {
  return new RegExp(`--gm-hcp-${name}:\\s*(#[0-9a-f]{6});`, "i").exec(block)?.[1] ?? null;
}
function luminance(hex: string): number {
  const c = hex.slice(1).match(/../g)!.map((v) => parseInt(v, 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
for (const tone of ["gold", "violet", "teal", "forest", "sage", "neutral"]) {
  for (const dark of [false, true]) {
    test(`${tone} text meets 4.5:1 on its actual light/dark surfaces (dark=${dark})`, () => {
      const block = declaration(`${dark ? ":root.dark " : ""}.gm-handicap--${tone}`);
      const ink = token(block, "ink");
      assert.ok(ink);
      const fill = token(block, "bg");
      // White card, warm page, and the composed profile-stat background.
      // Dark card, page, and composed profile-stat background respectively.
      const surfaces = fill ? [fill] : dark ? ["#161d19", "#0d1210", "#17201b"] : ["#ffffff", "#faf9f6", "#f9fafA"];
      for (const surface of surfaces) {
        assert.ok(contrast(ink, surface) >= 4.5, `${ink} on ${surface}: ${contrast(ink, surface)}`);
      }
    });
  }
}

test("decoration decreases without fading text or adding animation", () => {
  const base = declaration(".gm-handicap");
  assert.match(base, /--gm-hcp-bg: transparent/);
  assert.match(base, /--gm-hcp-border: transparent/);
  assert.match(base, /--gm-hcp-shadow: none/);
  assert.match(base, /overflow-wrap: anywhere/);
  assert.doesNotMatch(base, /opacity:|animation:|forced-color-adjust:/);
  for (const dark of [false, true]) {
    const prefix = dark ? ":root.dark " : "";
    assert.ok(token(declaration(`${prefix}.gm-handicap--gold`), "border"));
    assert.ok(token(declaration(`${prefix}.gm-handicap--violet`), "border"));
    assert.ok(token(declaration(`${prefix}.gm-handicap--teal`), "bg"));
    assert.equal(token(declaration(`${prefix}.gm-handicap--teal`), "border"), null);
    for (const tone of ["forest", "sage", "neutral"]) {
      const block = declaration(`${prefix}.gm-handicap--${tone}`);
      assert.equal(token(block, "bg"), null);
      assert.equal(token(block, "border"), null);
    }
  }
});

test("profiles, cards, and Compare use the same ability presentation", () => {
  for (const path of [
    "src/pages/Profile.tsx", "src/pages/GolferProfilePage.tsx",
    "src/components/golfer/GolferCard.tsx", "src/components/golfer/CompareModal.tsx",
  ]) {
    const text = source(path);
    assert.match(text, /import[^\n]+handicapColorClass[^\n]+handicapColor/);
    assert.match(text, /handicapColorClass\([^)]*\.handicap\)/);
  }
  assert.match(source("src/pages/GolferProfilePage.tsx"), /!hasHandicap\(golfer.handicap\)/);
  assert.match(source("src/lib/format.ts"), /export \{ handicapLabel \} from "\.\/handicapColor"/);
  assert.doesNotMatch(source("src/components/golfer/CompareModal.tsx"), /label="Credibility"/);
});

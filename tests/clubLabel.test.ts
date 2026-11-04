// Run: npm run test:caddie  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { clubLabel, parseClub } from "../src/lib/clubLabel.ts";
import { en } from "../src/i18n/locales/en.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { ja } from "../src/i18n/locales/ja.ts";

const tFor = (dict: Record<string, string>) => (key: string, vars: Record<string, string | number> = {}) =>
  dict[key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));

test("parses the dropdown's clubs and older typed ones", () => {
  assert.deepEqual(parseClub("Driver"), { kind: "driver" });
  assert.deepEqual(parseClub("5 Wood"), { kind: "wood", n: 5 });
  assert.deepEqual(parseClub("3 hybrid"), { kind: "hybrid", n: 3 });
  assert.deepEqual(parseClub(" 7  Iron "), { kind: "iron", n: 7 });
  assert.deepEqual(parseClub("7iron"), { kind: "iron", n: 7 });
  assert.deepEqual(parseClub("Pitching Wedge"), { kind: "pitchingWedge" });
  assert.deepEqual(parseClub("56° Wedge"), { kind: "wedge", degrees: 56 });
  assert.deepEqual(parseClub("56 wedge"), { kind: "wedge", degrees: 56 });
  for (const other of ["", "Putter", "my new driver", "Sand Wedge", "7 iron chip", null, undefined]) assert.equal(parseClub(other), null, String(other));
});

test("labels follow the app language; unknown names stay as stored", () => {
  const zh = tFor(zhCN as unknown as Record<string, string>);
  const jp = tFor(ja as unknown as Record<string, string>);
  const e = tFor(en as unknown as Record<string, string>);
  assert.equal(clubLabel("Driver", e), "Driver");
  assert.equal(clubLabel("5 Wood", e), "5 Wood");
  assert.equal(clubLabel("56° Wedge", e), "56° Wedge");
  assert.equal(clubLabel("7 Iron", zh), "7号铁");
  assert.equal(clubLabel("Driver", zh), "一号木");
  assert.equal(clubLabel("3 Hybrid", jp), "3番ユーティリティ");
  assert.equal(clubLabel("Putter", zh), "Putter");
  assert.equal(clubLabel("  Sand Wedge ", zh), "Sand Wedge");
  assert.equal(clubLabel(undefined, zh), "");
});

// Run: npm run test:onboarding  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  APPEARANCE_TUTORIAL_ID,
  COURSE_MAP_TUTORIAL_ID,
  NAV_TUTORIAL_ID_BY_PATH,
  TUTORIAL_LAST_INDEX,
  TUTORIAL_STEPS,
} from "../src/lib/tutorialSteps.ts";
import { en } from "../src/i18n/locales/en.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";
import { es } from "../src/i18n/locales/es.ts";
import { ko } from "../src/i18n/locales/ko.ts";
import { ja } from "../src/i18n/locales/ja.ts";

const LOCALES: Record<string, Record<string, string>> = { en, "zh-CN": zhCN, "zh-TW": zhTW, es, ko, ja };

function srcFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return srcFiles(p);
    return /\.tsx?$/.test(d.name) ? [p] : [];
  });
}

test("the tour ends on Settings -> Appearance, after Play, the course map, Chat and Caddie", () => {
  assert.deepEqual(
    TUTORIAL_STEPS.map((s) => s.targetId),
    ["nav-play", COURSE_MAP_TUTORIAL_ID, "nav-messages", "nav-caddie", APPEARANCE_TUTORIAL_ID],
  );
  const last = TUTORIAL_STEPS[TUTORIAL_LAST_INDEX];
  assert.equal(last.route, "/settings");
  assert.equal(last.targetId, APPEARANCE_TUTORIAL_ID);
});

test("every step's title and text exist in all 6 locales", () => {
  for (const step of TUTORIAL_STEPS) {
    for (const [name, dict] of Object.entries(LOCALES)) {
      for (const key of [step.titleKey, step.textKey]) {
        assert.ok(typeof dict[key] === "string" && dict[key].trim(), `${name} is missing ${key}`);
      }
    }
  }
});

test("every non-nav target id is put on an element by some screen", () => {
  const navIds = new Set(Object.values(NAV_TUTORIAL_ID_BY_PATH));
  const sources = srcFiles(path.join(import.meta.dirname, "..", "src"))
    .filter((f) => !f.endsWith(path.join("lib", "tutorialSteps.ts")))
    .map((f) => fs.readFileSync(f, "utf8"));
  const constName: Record<string, string> = {
    [COURSE_MAP_TUTORIAL_ID]: "COURSE_MAP_TUTORIAL_ID",
    [APPEARANCE_TUTORIAL_ID]: "APPEARANCE_TUTORIAL_ID",
  };
  for (const { targetId } of TUTORIAL_STEPS) {
    if (!targetId || navIds.has(targetId)) continue;
    const name = constName[targetId];
    assert.ok(name, `add ${targetId} to this test's constant map`);
    assert.ok(
      sources.some((s) => s.includes(`data-tutorial-id={${name}}`)),
      `no element carries data-tutorial-id={${name}}`,
    );
  }
});

test("the Appearance card in Settings carries the target id", () => {
  const settings = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "pages", "Settings.tsx"), "utf8");
  const picker = settings.slice(settings.indexOf("function AppearancePicker"));
  assert.match(picker.slice(0, picker.indexOf('role="radiogroup"')), /data-tutorial-id=\{APPEARANCE_TUTORIAL_ID\}/);
});

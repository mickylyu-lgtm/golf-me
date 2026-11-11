// Run: npm run test:onboarding  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  APPEARANCE_TUTORIAL_ID,
  FOLLOW_APPROVAL_TUTORIAL_ID,
  COURSE_MAP_TUTORIAL_ID,
  NAV_TUTORIAL_ID_BY_PATH,
  TUTORIAL_LAST_INDEX,
  TUTORIAL_STEPS,
  VERIFIED_TUTORIAL_ID,
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

test("the tour ends on Settings -> Appearance, after Play, the course map, Chat, Verified Golfer, Caddie and follow approval", () => {
  assert.deepEqual(
    TUTORIAL_STEPS.map((s) => s.targetId),
    ["nav-play", COURSE_MAP_TUTORIAL_ID, "nav-messages", VERIFIED_TUTORIAL_ID, "nav-caddie", FOLLOW_APPROVAL_TUTORIAL_ID, APPEARANCE_TUTORIAL_ID],
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
    [VERIFIED_TUTORIAL_ID]: "VERIFIED_TUTORIAL_ID",
    [FOLLOW_APPROVAL_TUTORIAL_ID]: "FOLLOW_APPROVAL_TUTORIAL_ID",
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

test("the Verified Golfer step targets the always-rendered Trust & verification card", () => {
  const step = TUTORIAL_STEPS.find((s) => s.targetId === VERIFIED_TUTORIAL_ID);
  assert.ok(step);
  assert.equal(step.route, "/profile/reputation");
  const page = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "pages", "ReputationDetail.tsx"), "utf8");
  const card = page.slice(page.indexOf("data-tutorial-id={VERIFIED_TUTORIAL_ID}"));
  // the id sits on the card wrapper, outside the "migration applied?" branch
  assert.ok(card.indexOf('t("reputation.trustVerification")') < card.indexOf('verified.status === "ready"'));
  for (const [name, dict] of Object.entries(LOCALES)) {
    assert.doesNotMatch(dict["tutorial.verified.text"], /[\u{1F300}-\u{1FAFF}✨]/u, `${name}: no emojis`);
  }
});

test("the Appearance card in Settings carries the target id", () => {
  const settings = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "pages", "Settings.tsx"), "utf8");
  const picker = settings.slice(settings.indexOf("function AppearancePicker"));
  assert.match(picker.slice(0, picker.indexOf('role="radiogroup"')), /data-tutorial-id=\{APPEARANCE_TUTORIAL_ID\}/);
});

test("follow approval spotlights its always-rendered setting with the exact label",()=>{
 const step=TUTORIAL_STEPS.find(s=>s.targetId===FOLLOW_APPROVAL_TUTORIAL_ID);assert.ok(step);
 assert.equal(step.route,"/settings");assert.equal(step.titleKey,"socialPrivacy.title");assert.equal(step.textKey,"tutorial.followApproval.text");
 const setting=fs.readFileSync(path.join(import.meta.dirname,"..","src","components","profile","FollowApprovalSetting.tsx"),"utf8");
 assert.ok(setting.indexOf("data-tutorial-id={FOLLOW_APPROVAL_TUTORIAL_ID}")<setting.indexOf("{value &&"));
 assert.match(en["tutorial.followApproval.text"],/Turn this on if you want to accept or reject.*Existing followers stay/);
 assert.match(en["tutorial.followApproval.text"],/remain public.*Signed-in.*Followers and Following.*without following you.*Blocks and safety/);
 assert.doesNotMatch(en["tutorial.followApproval.text"],/private account|posts are hidden/i);
});
test("new tutorial step does not reset completion or force replay",()=>{
 const context=fs.readFileSync(path.join(import.meta.dirname,"..","src","context","TutorialContext.tsx"),"utf8");
 assert.match(context,/eligible: !isDemo && !onboardingTutorialCompleted/);
 assert.match(context,/saveProfile\(\{ onboarding_tutorial_completed: true \}\)/);
 assert.doesNotMatch(context,/tutorial_version|onboarding_tutorial_completed: false/);
});

test("approval explanation alone uses centered placement and Settings exposes explicit replay",()=>{
 const centered=TUTORIAL_STEPS.filter(s=>s.cardPlacement==="center");assert.equal(centered.length,1);assert.equal(centered[0].targetId,FOLLOW_APPROVAL_TUTORIAL_ID);
 const settings=fs.readFileSync(path.join(import.meta.dirname,"..","src","pages","Settings.tsx"),"utf8");
 assert.match(settings,/onClick=\{startTutorial\}/);assert.match(settings,/t\("settings.replayTutorial"\)/);
 assert.doesNotMatch(settings,/onboarding_tutorial_completed: false/);
});

test("only opted-in centered explanations are height bounded and scroll contained",()=>{
 const overlay=fs.readFileSync(path.join(import.meta.dirname,"..","src","components","tutorial","TutorialOverlay.tsx"),"utf8");
 assert.match(overlay,/maxHeight: "calc\(100dvh - 32px\)"/);assert.match(overlay,/overflowY: "auto"/);assert.match(overlay,/overscrollBehavior: "contain"/);
 assert.match(overlay,/step.cardPlacement === "center" \? SCROLLABLE_CENTERED_CARD_STYLE : rect \? cardStyleForRect\(rect\) : CENTERED_CARD_STYLE/);
});

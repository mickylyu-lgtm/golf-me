import { test } from "node:test";
import assert from "node:assert/strict";
import { canReplayTutorial } from "../src/lib/tutorialAccess.ts";
import { FOUNDER_USER_ID } from "../src/lib/founder.ts";
import { sameTutorialRect } from "../src/lib/tutorialSpotlight.ts";
import fs from "node:fs";

test("manual tutorial replay is limited to the authenticated founder, never demo or other accounts", () => {
  assert.equal(canReplayTutorial(false, FOUNDER_USER_ID), true);
  for (const id of [undefined, null, "", "someone-else", "g1", "admin"]) {
    assert.equal(canReplayTutorial(false, id), false);
    assert.equal(canReplayTutorial(true, id), false);
  }
  assert.equal(canReplayTutorial(true, FOUNDER_USER_ID), false);
});

test("tiny stationary target measurement noise is ignored; moving or resizing targets publish", () => {
  const rect = { top: 30, left: 20, width: 60, height: 40, bottom: 70 };
  assert.equal(sameTutorialRect(rect, { ...rect, top: 30.1 }), true);
  for (const change of [{ top: 31 }, { left: 21 }, { width: 61 }, { height: 41 }]) {
    assert.equal(sameTutorialRect(rect, { ...rect, ...change }), false);
  }
  assert.equal(sameTutorialRect(rect, null), false);
  assert.equal(sameTutorialRect(null, null), true);
});

test("replay UI and action share the founder guard, separate from first-use onboarding", () => {
  const context = fs.readFileSync(new URL("../src/context/TutorialContext.tsx", import.meta.url), "utf8");
  const settings = fs.readFileSync(new URL("../src/pages/Settings.tsx", import.meta.url), "utf8");
  assert.match(context, /canReplayTutorial\(isDemo, authUser\?\.id\)/);
  assert.match(context, /const replay = useCallback\(\(\) => \{\s*if \(!canReplay\) return;/);
  assert.match(context, /if \(onboardingTutorialCompleted \|\| completedThisSession \|\| completedUserRef.current === selfId\) return;/);
  assert.match(settings, /replay: startTutorial, canReplay/);
  assert.match(settings, /\{canReplay && <button type="button" onClick=\{startTutorial\}/);
  assert.doesNotMatch(context, /isAdmin|user_metadata|\.email/);
});

test("spotlight stays mounted, reduces motion, and never uses competing smooth scrolls", () => {
  const source = fs.readFileSync(new URL("../src/components/tutorial/TutorialOverlay.tsx", import.meta.url), "utf8");
  const tracker = fs.readFileSync(new URL("../src/lib/tutorialSpotlight.ts", import.meta.url), "utf8");
  assert.match(source, /data-tutorial-spotlight/);
  assert.match(source, /motion-reduce:transition-none/);
  assert.match(tracker, /behavior: "instant"/);
  assert.match(tracker, /cancelAnimationFrame\(frame\)/);
  assert.match(tracker, /resizeObserver\?\.disconnect\(\)/);
  assert.match(tracker, /mutationObserver\.disconnect\(\)/);
  assert.doesNotMatch(tracker, /behavior: "smooth"|setInterval/);
});

// Run: npm run test:onboarding  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTENT_FOCUS_DAYS,
  activeOnboardingIntents,
  homeFocus,
  hostingPromptDeferred,
  serializeOnboardingIntent,
} from "../src/lib/onboardingIntent.ts";
import { decideFirstRoundPrompt, shouldShowHostReminderCard } from "../src/lib/firstRoundPrompt.ts";
import type { FirstRoundPromptInputs } from "../src/lib/firstRoundPrompt.ts";

const NOW = new Date("2026-11-05T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

test("round-trips for the same account inside the focus window", () => {
  const raw = serializeOnboardingIntent("u1", ["join_round", "find_people", "join_round"], NOW);
  assert.deepEqual(activeOnboardingIntents(raw, "u1", new Date(NOW.getTime() + DAY)), ["find_people", "join_round"]);
});

test("nothing for another account, signed out, or after the window", () => {
  const raw = serializeOnboardingIntent("u1", ["find_people"], NOW);
  assert.deepEqual(activeOnboardingIntents(raw, "u2", NOW), []);
  assert.deepEqual(activeOnboardingIntents(raw, null, NOW), []);
  assert.deepEqual(activeOnboardingIntents(raw, "u1", new Date(NOW.getTime() + (INTENT_FOCUS_DAYS + 1) * DAY)), []);
  assert.deepEqual(activeOnboardingIntents(raw, "u1", new Date(NOW.getTime() - DAY)), []);
});

test("the old bare-array format and junk are ignored (existing users unchanged)", () => {
  assert.deepEqual(activeOnboardingIntents(JSON.stringify(["find_people"]), "u1", NOW), []);
  assert.deepEqual(activeOnboardingIntents("not json", "u1", NOW), []);
  assert.deepEqual(activeOnboardingIntents(null, "u1", NOW), []);
  const bad = JSON.stringify({ v: 1, userId: "u1", intents: ["find_people", "hack"], savedAt: NOW.toISOString() });
  assert.deepEqual(activeOnboardingIntents(bad, "u1", NOW), ["find_people"]);
});

test("Home focus follows the stated intent", () => {
  assert.equal(homeFocus([]), "default");
  assert.equal(homeFocus(["find_people"]), "golfers");
  assert.equal(homeFocus(["join_round"]), "rounds");
  assert.equal(homeFocus(["find_people", "join_round"]), "rounds");
  assert.equal(homeFocus(["find_people", "host_round"]), "default");
  assert.equal(homeFocus(["improve_swing"]), "default");
});

test("hosting nudges wait only for find-people / join-round golfers who didn't pick hosting", () => {
  assert.equal(hostingPromptDeferred([]), false);
  assert.equal(hostingPromptDeferred(["find_people"]), true);
  assert.equal(hostingPromptDeferred(["join_round"]), true);
  assert.equal(hostingPromptDeferred(["join_round", "host_round"]), false);
  assert.equal(hostingPromptDeferred(["improve_swing"]), false);
});

const base: FirstRoundPromptInputs = {
  isDemo: false,
  signedIn: true,
  hasOnboarded: true,
  tutorialCompleted: true,
  tutorialActive: false,
  tutorialJustCompleted: false,
  hasHosted: false,
  dismissed: false,
  onHome: true,
  blockingOverlayOpen: false,
  sessionStartWindowOpen: true,
  alreadyShownThisSession: false,
};

test("a deferred intent holds back the popup and the reminder card", () => {
  assert.equal(decideFirstRoundPrompt(base).show, true);
  assert.deepEqual(decideFirstRoundPrompt({ ...base, hostingDeferred: true }), { show: false, reason: "hosting_deferred" });
  const card = { isDemo: false, signedIn: true, hasHosted: false, dismissed: true };
  assert.equal(shouldShowHostReminderCard(card), true);
  assert.equal(shouldShowHostReminderCard({ ...card, hostingDeferred: true }), false);
});

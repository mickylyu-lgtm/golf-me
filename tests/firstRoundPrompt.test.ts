// Run: npm run test:onboarding  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideFirstRoundPrompt, shouldShowHostReminderCard } from "../src/lib/firstRoundPrompt.ts";
import type { FirstRoundPromptInputs } from "../src/lib/firstRoundPrompt.ts";
import { isAllowedReturnPath, routeForAppUrl } from "../src/lib/returnTo.ts";

const ROUND = "/golf-calls/3f1c2a9e-8b7d-4c6e-9a51-0d2e4f6a8b10";

// An existing, onboarded, never-hosted real account landing on Home at app
// launch: the one case that shows.
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

const decide = (patch: Partial<FirstRoundPromptInputs>) => decideFirstRoundPrompt({ ...base, ...patch });

test("shows for a never-hosted account at session start on Home", () => {
  assert.deepEqual(decide({}), { show: true, reason: "show" });
});

test("never for demo accounts, even when everything else qualifies", () => {
  assert.equal(decide({ isDemo: true }).reason, "demo");
  assert.equal(decide({ isDemo: true, tutorialJustCompleted: true }).show, false);
});

test("needs a signed-in, onboarded account", () => {
  assert.equal(decide({ signedIn: false }).reason, "signed_out");
  assert.equal(decide({ hasOnboarded: false }).reason, "not_onboarded");
});

test("waits for the tutorial", () => {
  assert.equal(decide({ tutorialActive: true }).reason, "tutorial_pending");
  assert.equal(decide({ tutorialCompleted: false }).reason, "tutorial_pending");
  // Finished this session but the flag save failed: still allowed.
  assert.equal(decide({ tutorialCompleted: false, tutorialJustCompleted: true }).show, true);
  // Replay in progress: never on top of it.
  assert.equal(decide({ tutorialActive: true, tutorialJustCompleted: true }).show, false);
});

test("never guesses 'has hosted': unknown means no popup", () => {
  assert.equal(decide({ hasHosted: null }).reason, "hosted_unknown");
  assert.equal(decide({ hasHosted: true }).reason, "already_hosted");
});

test("dismissed (any device) means never again", () => {
  assert.equal(decide({ dismissed: true }).reason, "dismissed");
  assert.equal(decide({ dismissed: true, tutorialJustCompleted: true }).show, false);
});

test("at most once per session", () => {
  assert.equal(decide({ alreadyShownThisSession: true }).reason, "already_shown");
});

test("only on Home, and never over another modal/overlay", () => {
  assert.equal(decide({ onHome: false }).reason, "not_on_home");
  assert.equal(decide({ blockingOverlayOpen: true }).reason, "overlay_open");
  assert.equal(decide({ blockingOverlayOpen: true, tutorialJustCompleted: true }).show, false);
});

test("never mid-session, except right after the tutorial ends", () => {
  assert.equal(decide({ sessionStartWindowOpen: false }).reason, "mid_session");
  assert.equal(decide({ sessionStartWindowOpen: false, tutorialJustCompleted: true }).show, true);
});

test("Home reminder card: after dismissal, until the first round exists", () => {
  const card = (p: Partial<Parameters<typeof shouldShowHostReminderCard>[0]>) =>
    shouldShowHostReminderCard({ isDemo: false, signedIn: true, hasHosted: false, dismissed: true, ...p });
  assert.equal(card({}), true);
  assert.equal(card({ dismissed: false }), false); // popup still to come
  assert.equal(card({ hasHosted: true }), false); // first round created
  assert.equal(card({ hasHosted: null }), false); // unknown: don't nag
  assert.equal(card({ isDemo: true }), false);
  assert.equal(card({ signedIn: false }), false);
});

test("return path: only real round links survive sign-in", () => {
  assert.equal(isAllowedReturnPath(ROUND), true);
  for (const bad of ["/", "/golf-calls/new", "/golf-calls/abc", "//evil.com", "https://evil.com" + ROUND, ROUND + "/x", "/admin/dashboard"]) {
    assert.equal(isAllowedReturnPath(bad), false, bad);
  }
});

test("Universal Link routing maps only golfme.app round links", () => {
  assert.equal(routeForAppUrl("https://golfme.app" + ROUND), ROUND);
  assert.equal(routeForAppUrl("https://www.golfme.app" + ROUND + "/"), ROUND);
  assert.equal(routeForAppUrl("https://golfme.app" + ROUND + "?utm=x"), ROUND);
  assert.equal(routeForAppUrl("com.golfme.ios://auth-callback#access_token=x"), null);
  assert.equal(routeForAppUrl("https://evil.com" + ROUND), null);
  assert.equal(routeForAppUrl("http://golfme.app" + ROUND), null);
  assert.equal(routeForAppUrl("https://golfme.app/golf-calls/new"), null);
  assert.equal(routeForAppUrl("not a url"), null);
});

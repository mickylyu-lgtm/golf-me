import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOnboardingDraft, saveOnboardingDraft, type OnboardingDraft } from "../src/lib/onboardingDraft.ts";

const draft: OnboardingDraft = {
  name: "Synthetic Golfer", is18Plus: true, areaLabel: "Synthetic Town",
  playingAreaCoords: { lat: 40, lng: -74 }, hasHandicap: true, handicap: 15,
};

test("onboarding draft resumes normally and storage failures never escape to the form", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  let blocked = false;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) {
      if (blocked) throw new DOMException("Full", "QuotaExceededError");
      values.set(key, value);
    },
  };
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
    saveOnboardingDraft(draft);
    assert.deepEqual(loadOnboardingDraft(), draft);
    blocked = true;
    assert.doesNotThrow(() => saveOnboardingDraft({ ...draft, name: "New name" }));
    assert.deepEqual(loadOnboardingDraft(), draft, "failed save leaves the existing draft intact");
    blocked = false;
    saveOnboardingDraft({ ...draft, name: "New name" });
    assert.equal(loadOnboardingDraft()?.name, "New name", "later writes recover");
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      get localStorage() { throw new DOMException("Blocked", "SecurityError"); },
    } });
    assert.doesNotThrow(() => saveOnboardingDraft(draft));
    assert.equal(loadOnboardingDraft(), null);
    Reflect.deleteProperty(globalThis, "window");
    assert.doesNotThrow(() => saveOnboardingDraft(draft));
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

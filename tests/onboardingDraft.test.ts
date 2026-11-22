import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOnboardingDraft, optionalHandicap, saveOnboardingDraft, type OnboardingDraft } from "../src/lib/onboardingDraft.ts";

const draft: OnboardingDraft = {
  name: "Synthetic Golfer", is18Plus: true, areaLabel: "Synthetic Town",
  playingAreaCoords: { lat: 40, lng: -74 }, handicap: 15,
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

test("legacy drafts drop a seeded 15 or a declined handicap without losing other answers", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  let raw = "";
  const { handicap: _handicap, ...otherAnswers } = draft;
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      getItem: () => raw,
      setItem: (_key: string, next: string) => { raw = next; },
    } } });
    for (const [hasHandicap, handicap, expected] of [[true, 15, ""], [false, 8, ""], [true, 8, 8], [true, 0, 0], [true, "", ""]] as const) {
      raw = JSON.stringify({ ...otherAnswers, hasHandicap, handicap });
      assert.deepEqual(loadOnboardingDraft(), { ...otherAnswers, handicap: expected });
    }
    saveOnboardingDraft(draft);
    assert.deepEqual(loadOnboardingDraft(), draft, "an intentionally entered new 15 survives reload");
    saveOnboardingDraft({ ...draft, handicap: "" });
    assert.deepEqual(loadOnboardingDraft(), { ...otherAnswers, handicap: "" });
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("optional signup handicap leaves an empty input null and preserves actual values", () => {
  assert.equal(optionalHandicap(""), null);
  assert.equal(optionalHandicap(NaN), null);
  assert.equal(optionalHandicap(15), 15);
  assert.equal(optionalHandicap(0), 0);
  assert.equal(optionalHandicap(-2), -2);
});

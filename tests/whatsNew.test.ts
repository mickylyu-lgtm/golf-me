// Run: node --test tests/whatsNew.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CURRENT_WHATS_NEW, shouldShowWhatsNew, splitBold, whatsNewDismissalKey, readDismissedWhatsNew, storeDismissedWhatsNew, type WhatsNewEntry } from "../src/lib/whatsNew.ts";

const entry: WhatsNewEntry = { id: "x1", publishedAt: "2026-11-16", showForDays: 14, items: ["whatsNew.item.homeFeed"] };
const day = 24 * 60 * 60 * 1000;
const pub = Date.parse("2026-11-16");

test("shows to an existing member who hasn't closed it", () => {
  assert.equal(shouldShowWhatsNew(entry, { dismissedId: null, now: pub + day, memberSince: "2025-09-01" }), true);
});

test("closing hides that announcement only", () => {
  assert.equal(shouldShowWhatsNew(entry, { dismissedId: "x1", now: pub + day }), false);
  assert.equal(shouldShowWhatsNew(entry, { dismissedId: "older-id", now: pub + day }), true);
});

test("stops on its own after showForDays", () => {
  assert.equal(shouldShowWhatsNew(entry, { dismissedId: null, now: pub + 14 * day - 1 }), true);
  assert.equal(shouldShowWhatsNew(entry, { dismissedId: null, now: pub + 15 * day }), false);
});

test("people who joined after the change don't see it; same-day signups do", () => {
  assert.equal(shouldShowWhatsNew(entry, { dismissedId: null, now: pub + 2 * day, memberSince: "2026-11-17T09:00:00Z" }), false);
  assert.equal(shouldShowWhatsNew(entry, { dismissedId: null, now: pub + day, memberSince: "2026-11-16T22:00:00Z" }), true);
  assert.equal(shouldShowWhatsNew(entry, { dismissedId: null, now: pub + day, memberSince: null }), true);
});

test("nothing to announce, or a bad date, shows nothing", () => {
  assert.equal(shouldShowWhatsNew(null, { dismissedId: null, now: pub }), false);
  assert.equal(shouldShowWhatsNew({ ...entry, items: [] }, { dismissedId: null, now: pub }), false);
  assert.equal(shouldShowWhatsNew({ ...entry, publishedAt: "soon" }, { dismissedId: null, now: pub }), false);
});

test("splitBold turns **terms** into bold runs, never HTML", () => {
  assert.deepEqual(splitBold("**Play** has a new **Courses** tab."), [
    { text: "Play", bold: true },
    { text: " has a new ", bold: false },
    { text: "Courses", bold: true },
    { text: " tab.", bold: false },
  ]);
  assert.deepEqual(splitBold("plain"), [{ text: "plain", bold: false }]);
  assert.deepEqual(splitBold("a **dangling"), [{ text: "a **dangling", bold: false }]);
  assert.deepEqual(splitBold("<b>x</b>"), [{ text: "<b>x</b>", bold: false }]);
  assert.deepEqual(splitBold("****"), []);
});

test("every locale's items bold at least one key term and close every **", async () => {
  const locales = ["en", "es", "ja", "ko", "zh-CN", "zh-TW"];
  for (const l of locales) {
    const mod = await import(`../src/i18n/locales/${l}.ts`);
    const dict = Object.values(mod).find((v) => v && typeof v === "object" && "whatsNew.title" in (v as object)) as Record<string, string>;
    assert.ok(dict, `${l} dictionary`);
    for (const key of CURRENT_WHATS_NEW?.items ?? []) {
      const text = dict[key];
      assert.ok(text, `${l} ${key}`);
      assert.equal((text.match(/\*\*/g) ?? []).length % 2, 0, `${l} ${key} has an unclosed **`);
      assert.ok(splitBold(text).some((p) => p.bold), `${l} ${key} has no bold term`);
    }
  }
});

test("the current entry is well formed", () => {
  if (!CURRENT_WHATS_NEW) return;
  assert.ok(!Number.isNaN(Date.parse(CURRENT_WHATS_NEW.publishedAt)));
  assert.ok(CURRENT_WHATS_NEW.items.length >= 1 && CURRENT_WHATS_NEW.items.length <= 4);
  assert.ok(CURRENT_WHATS_NEW.showForDays === null || (CURRENT_WHATS_NEW.showForDays > 0 && CURRENT_WHATS_NEW.showForDays <= 30));
});


test("community reminder includes later signups with no expiry and respects dismissal", () => {
  assert.equal(shouldShowWhatsNew(CURRENT_WHATS_NEW, { dismissedId: null, now: pub + 400 * day, memberSince: "2027-01-01" }), true);
  assert.equal(shouldShowWhatsNew(CURRENT_WHATS_NEW, { dismissedId: CURRENT_WHATS_NEW!.id, now: pub + day }), false);
});

test("dismissal keys isolate accounts and encode unsafe characters", () => {
  assert.equal(whatsNewDismissalKey(), "golfme:whatsNewDismissed");
  assert.equal(whatsNewDismissalKey("a:b"), "golfme:whatsNewDismissed:account:a%3Ab");
  const map = new Map<string, string>();
  const prior = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => map.set(k, v) } } });
  try {
    storeDismissedWhatsNew("old");
    assert.equal(readDismissedWhatsNew("a"), null);
    storeDismissedWhatsNew("notice", "a");
    assert.equal(readDismissedWhatsNew("a"), "notice");
    assert.equal(readDismissedWhatsNew("b"), null);
  } finally {
    if (prior) Object.defineProperty(globalThis, "window", prior);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("simulator notice replaces the previous reminder for all signed-in members", () => {
  assert.equal(CURRENT_WHATS_NEW?.id, "2026-11-28-simulator-sessions");
  assert.equal(CURRENT_WHATS_NEW?.audience, "all");
  assert.equal(shouldShowWhatsNew(CURRENT_WHATS_NEW, {
    dismissedId: "2026-11-17-golf-focused-community-reminder",
    now: Date.parse("2026-11-29"),
    memberSince: "2026-11-29",
  }), true);
});

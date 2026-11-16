// Run: node --test tests/whatsNew.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CURRENT_WHATS_NEW, shouldShowWhatsNew, type WhatsNewEntry } from "../src/lib/whatsNew.ts";

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

test("the current entry is well formed", () => {
  if (!CURRENT_WHATS_NEW) return;
  assert.ok(!Number.isNaN(Date.parse(CURRENT_WHATS_NEW.publishedAt)));
  assert.ok(CURRENT_WHATS_NEW.items.length >= 1 && CURRENT_WHATS_NEW.items.length <= 4);
  assert.ok(CURRENT_WHATS_NEW.showForDays > 0 && CURRENT_WHATS_NEW.showForDays <= 30);
});

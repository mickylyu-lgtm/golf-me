// Run: npm run test:play  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  browseAllSearch,
  buildRoundSearch,
  courseFindRoundsSearch,
  defaultSearchRadius,
  findRoundDraft,
  findRoundSearch,
  isMatchedSearch,
  parseRoundSearch,
  quickAutoMatchSearch,
} from "../src/lib/roundSearchParams.ts";
import type { NewPreferenceSelections } from "../src/lib/preferenceMatch.ts";

const PREFS: NewPreferenceSelections = {
  roundLengthPreference: "18 Holes",
  genderPreference: "No preference",
  groupTypePreference: "Mixed / Anyone",
  gameFormatPreference: "No Preference",
  networkingPreference: "Open to Networking",
};

function sorted(p: URLSearchParams): string {
  const copy = new URLSearchParams(p);
  copy.sort();
  return copy.toString();
}

test("a full Find a Round search reads back field for field", () => {
  const draft = findRoundDraft(new URLSearchParams(), 30);
  const full = findRoundSearch(
    {
      ...draft,
      when: "date",
      customDate: "2026-11-14",
      radius: 40,
      budgetCapEnabled: true,
      budgetMax: 80,
      skillLevel: "Intermediate",
      vibe: "Competitive",
      walkOrCart: "Walking",
      travelLocation: { label: "Brooklyn, NY", coords: { lat: 40.65, lng: -73.95 } },
    },
    PREFS,
  );
  assert.equal(isMatchedSearch(full), true);
  const f = parseRoundSearch(full);
  assert.deepEqual(f, {
    when: "date",
    date: "2026-11-14",
    radius: 40,
    intent: "join",
    budgetMax: 80,
    skill: "Intermediate",
    vibe: "Competitive",
    walk: "Walking",
    location: { label: "Brooklyn, NY", coords: { lat: 40.65, lng: -73.95 } },
    prefs: PREFS,
  });
  // URL -> filters -> URL is lossless.
  assert.equal(sorted(buildRoundSearch(f, { matched: true })), sorted(full));
});

test("Edit search prefills every field from the URL and resubmits the same search", () => {
  const url = new URLSearchParams(
    "matched=1&when=weekend&radius=15&intent=join&roundLength=9+Holes&gender=Women&groupType=No+Preference&gameFormat=Scramble&networking=No+Preference&budgetMax=60&skill=Beginner&vibe=Casual+%26+Social&walk=Cart&loc=Queens%2C+NY&locLat=40.7&locLng=-73.8",
  );
  const draft = findRoundDraft(url, 50);
  assert.equal(draft.when, "weekend");
  assert.equal(draft.radius, 15, "the URL's radius wins over the travel radius");
  assert.equal(draft.budgetCapEnabled, true);
  assert.equal(draft.budgetMax, 60);
  assert.equal(draft.skillLevel, "Beginner");
  assert.equal(draft.vibe, "Casual & Social");
  assert.equal(draft.walkOrCart, "Cart");
  assert.deepEqual(draft.travelLocation, { label: "Queens, NY", coords: { lat: 40.7, lng: -73.8 } });
  assert.equal(draft.prefs?.gameFormatPreference, "Scramble");
  assert.equal(draft.prefs?.genderPreference, "Women");
  assert.equal(draft.showAdvanced, true, "advanced filters in use are shown, not hidden");
  assert.equal(sorted(findRoundSearch(draft, draft.prefs!)), sorted(url));
});

test("a custom date survives the round trip; a malformed one is dropped", () => {
  const draft = findRoundDraft(new URLSearchParams("matched=1&when=date&date=2026-12-01&radius=25"), 25);
  assert.equal(draft.when, "date");
  assert.equal(draft.customDate, "2026-12-01");
  assert.equal(parseRoundSearch(new URLSearchParams("when=date&date=12/01/2026")).date, null);
});

test("no search in the URL: today, the golfer's travel radius, nothing else", () => {
  const draft = findRoundDraft(new URLSearchParams(), 35);
  assert.equal(draft.when, "today");
  assert.equal(draft.radius, 35);
  assert.equal(draft.budgetCapEnabled, false);
  assert.equal(draft.skillLevel, "");
  assert.equal(draft.vibe, "");
  assert.equal(draft.walkOrCart, "");
  assert.equal(draft.travelLocation, null);
  assert.equal(draft.prefs, null, "starts from the saved preferences");
  assert.equal(draft.showAdvanced, false);
});

test("travel radius default: unset falls back to 25, out-of-range is clamped to the slider", () => {
  assert.equal(defaultSearchRadius(0), 25);
  assert.equal(defaultSearchRadius(undefined), 25);
  assert.equal(defaultSearchRadius(null), 25);
  assert.equal(defaultSearchRadius(2), 5);
  assert.equal(defaultSearchRadius(500), 100);
  assert.equal(findRoundDraft(new URLSearchParams(), 0).radius, 25);
  assert.equal(findRoundDraft(new URLSearchParams("matched=1&radius=9999"), 25).radius, 100);
});

test("quick Auto-Match carries the travel radius; Browse all keeps it as a matched search", () => {
  const quick = quickAutoMatchSearch(30);
  assert.equal(quick.toString(), "quick=1&radius=30");
  const browse = browseAllSearch(quick);
  assert.equal(isMatchedSearch(browse), true, "GolfCalls only filters matched=1 searches");
  assert.equal(browse.get("quick"), null);
  const f = parseRoundSearch(browse);
  assert.equal(f.radius, 30);
  assert.equal(f.when, null, "any day stays any day");
  assert.equal(f.intent, "join");
  assert.equal(f.prefs, null);
});

test("Browse all from a full Auto-Match search keeps every filter", () => {
  const am = findRoundSearch(
    { ...findRoundDraft(new URLSearchParams(), 25), when: "tomorrow", radius: 20, skillLevel: "Advanced", walkOrCart: "Walking", budgetCapEnabled: true, budgetMax: 120 },
    PREFS,
  );
  assert.equal(sorted(browseAllSearch(am)), sorted(am));
});

test("Edit search on a quick Browse-all list keeps 'any day' instead of forcing today", () => {
  const draft = findRoundDraft(browseAllSearch(quickAutoMatchSearch(30)), 50);
  assert.equal(draft.when, null);
  assert.equal(draft.radius, 30);
  const resubmitted = parseRoundSearch(findRoundSearch(draft, PREFS));
  assert.equal(resubmitted.when, null);
  assert.equal(resubmitted.radius, 30);
});

test("course post Find Rounds: this weekend within the golfer's travel radius", () => {
  assert.equal(courseFindRoundsSearch(40).toString(), "matched=1&when=weekend&radius=40");
  assert.equal(courseFindRoundsSearch(0).toString(), "matched=1&when=weekend&radius=25");
});

test("unknown or malformed values read as unset rather than matching nothing", () => {
  const f = parseRoundSearch(new URLSearchParams("matched=1&when=someday&radius=abc&budgetMax=-5&skill=Pro&vibe=Wild&walk=Run&intent=host"));
  assert.equal(f.when, null);
  assert.equal(f.radius, null);
  assert.equal(f.budgetMax, null);
  assert.equal(f.skill, null);
  assert.equal(f.vibe, null);
  assert.equal(f.walk, null);
  assert.equal(f.intent, null);
  // A $0 cap is a real cap, not "no limit".
  assert.equal(parseRoundSearch(new URLSearchParams("budgetMax=0")).budgetMax, 0);
});

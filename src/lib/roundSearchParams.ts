// One place that reads and writes a round search's URL params, shared by
// Find a Round (FindRoundModal), the matched browse list (GolfCalls),
// Auto-Match and a course post's "Find Rounds" link, so the four can't
// drift apart again. Edit search used to reopen the sheet on hardcoded
// defaults, and Quick Auto-Match's "Browse all" dropped the radius because
// it never said matched=1.
//
// Pure (no React, explicit .ts imports) so tests/roundSearchParams.test.ts
// runs under plain node --test.
import type { GolfVibe, SkillFilter, WalkOrCart } from "../types/index.ts";
import { BUDGET_PREF_MAX, BUDGET_PREF_MIN, GOLF_VIBES, TRAVEL_RADIUS_MAX, TRAVEL_RADIUS_MIN } from "../types/index.ts";
import type { PlayingArea } from "./geo.ts";
import type { NewPreferenceSelections } from "./preferenceMatch.ts";
import { newPreferenceOverride, newPreferenceParams } from "./matchPreferences.ts";
import { locationOverride, locationParams } from "./travelLocation.ts";

export type WhenChoice = "today" | "tomorrow" | "weekend" | "date";

export const WHEN_CHOICES: WhenChoice[] = ["today", "tomorrow", "weekend", "date"];
export const SKILL_FILTERS: SkillFilter[] = ["Any Skill Level", "Beginner", "Intermediate", "Advanced"];
export const WALK_FILTERS: WalkOrCart[] = ["Either", "Walking", "Cart"];

// Used when a golfer has no travel radius saved (same fallback the quick
// Auto-Match button always used).
export const FALLBACK_SEARCH_RADIUS = 25;
const DEFAULT_BUDGET_MAX = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface RoundSearchFilters {
  // null = any upcoming day.
  when: WhenChoice | null;
  // Only meaningful with when === "date".
  date: string | null;
  radius: number | null;
  intent: "join" | null;
  budgetMax: number | null;
  skill: SkillFilter | null;
  vibe: GolfVibe | null;
  walk: WalkOrCart | null;
  // "Playing Somewhere Else?" override; null = the saved playing area.
  location: PlayingArea | null;
  // Per-search Match Preferences override; null = the saved preferences.
  prefs: NewPreferenceSelections | null;
}

export const EMPTY_ROUND_SEARCH: RoundSearchFilters = {
  when: null,
  date: null,
  radius: null,
  intent: null,
  budgetMax: null,
  skill: null,
  vibe: null,
  walk: null,
  location: null,
  prefs: null,
};

function oneOf<T extends string>(value: string | null, options: readonly T[]): T | null {
  return value !== null && (options as readonly string[]).includes(value) ? (value as T) : null;
}

function positiveNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegativeNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// A matched browse (Find a Round's "Browse rounds", Auto-Match's "Browse
// all") vs the plain newest-first list.
export function isMatchedSearch(params: URLSearchParams): boolean {
  return params.get("matched") === "1";
}

// The one-tap Auto-Match button (quick=1): results show straight away.
export function isQuickSearch(params: URLSearchParams): boolean {
  return params.get("quick") === "1";
}

// Unknown or malformed values read as "not set" rather than filtering every
// round out (Number("abc") used to make the radius filter match nothing).
export function parseRoundSearch(params: URLSearchParams): RoundSearchFilters {
  const date = params.get("date");
  return {
    when: oneOf(params.get("when"), WHEN_CHOICES),
    date: date && DATE_RE.test(date) ? date : null,
    radius: positiveNumber(params.get("radius")),
    intent: params.get("intent") === "join" ? "join" : null,
    budgetMax: nonNegativeNumber(params.get("budgetMax")),
    skill: oneOf(params.get("skill"), SKILL_FILTERS),
    vibe: oneOf(params.get("vibe"), GOLF_VIBES),
    walk: oneOf(params.get("walk"), WALK_FILTERS),
    location: locationOverride(params),
    prefs: newPreferenceOverride(params),
  };
}

export function buildRoundSearch(filters: RoundSearchFilters, mode: { matched?: boolean; quick?: boolean } = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (mode.matched) params.set("matched", "1");
  if (mode.quick) params.set("quick", "1");
  if (filters.when) params.set("when", filters.when);
  if (filters.radius !== null) params.set("radius", String(filters.radius));
  if (filters.intent) params.set("intent", filters.intent);
  if (filters.prefs) for (const [k, v] of Object.entries(newPreferenceParams(filters.prefs))) params.set(k, v);
  if (filters.when === "date" && filters.date) params.set("date", filters.date);
  if (filters.budgetMax !== null) params.set("budgetMax", String(filters.budgetMax));
  if (filters.skill) params.set("skill", filters.skill);
  if (filters.vibe) params.set("vibe", filters.vibe);
  if (filters.walk) params.set("walk", filters.walk);
  if (filters.location) for (const [k, v] of Object.entries(locationParams(filters.location))) params.set(k, v);
  return params;
}

// The golfer's saved travel radius, kept inside the slider's range.
export function defaultSearchRadius(travelRadiusMiles: number | null | undefined): number {
  const r = travelRadiusMiles && travelRadiusMiles > 0 ? travelRadiusMiles : FALLBACK_SEARCH_RADIUS;
  return Math.min(TRAVEL_RADIUS_MAX, Math.max(TRAVEL_RADIUS_MIN, r));
}

// Find > Rounds' one-tap "Auto-Match me": saved preferences, travel radius,
// any upcoming day.
export function quickAutoMatchSearch(travelRadiusMiles: number | null | undefined): URLSearchParams {
  return buildRoundSearch({ ...EMPTY_ROUND_SEARCH, radius: defaultSearchRadius(travelRadiusMiles) }, { quick: true });
}

// Auto-Match's "Browse all": the same search as a matched browse list.
// Quick mode never set matched=1, so GolfCalls ignored its radius; this
// always does, and keeps every other filter (and drops quick=1, which only
// means something to Auto-Match). Auto-Match only ever shows joinable
// rounds, so the list asks for those too.
export function browseAllSearch(autoMatchParams: URLSearchParams): URLSearchParams {
  return buildRoundSearch({ ...parseRoundSearch(autoMatchParams), intent: "join" }, { matched: true });
}

// A course post's "Find Rounds": this weekend, within the golfer's own
// travel radius (was a hardcoded 25 mi).
export function courseFindRoundsSearch(travelRadiusMiles: number | null | undefined): URLSearchParams {
  return buildRoundSearch({ ...EMPTY_ROUND_SEARCH, when: "weekend", radius: defaultSearchRadius(travelRadiusMiles) }, { matched: true });
}

// Find a Round's editable fields. Edit search starts from the search on
// screen; a fresh open (no search in the URL) starts from today and the
// golfer's travel radius.
export interface FindRoundDraft {
  when: WhenChoice | null;
  customDate: string;
  radius: number;
  budgetCapEnabled: boolean;
  budgetMax: number;
  skillLevel: SkillFilter | "";
  vibe: GolfVibe | "";
  walkOrCart: WalkOrCart | "";
  travelLocation: PlayingArea | null;
  // null = start from the golfer's saved preferences.
  prefs: NewPreferenceSelections | null;
  // Open the advanced section when it holds a value, so it isn't hidden.
  showAdvanced: boolean;
}

export function findRoundDraft(params: URLSearchParams, travelRadiusMiles: number | null | undefined): FindRoundDraft {
  const hasSearch = isMatchedSearch(params) || isQuickSearch(params);
  const f = parseRoundSearch(params);
  const radius = f.radius !== null ? Math.min(TRAVEL_RADIUS_MAX, Math.max(TRAVEL_RADIUS_MIN, f.radius)) : defaultSearchRadius(travelRadiusMiles);
  const budgetMax = f.budgetMax !== null ? Math.min(BUDGET_PREF_MAX, Math.max(BUDGET_PREF_MIN, f.budgetMax)) : DEFAULT_BUDGET_MAX;
  return {
    // No "when" in an active search means any day (quick Auto-Match);
    // keep it rather than silently narrowing to today.
    when: hasSearch ? f.when : (f.when ?? "today"),
    customDate: f.when === "date" && f.date ? f.date : "",
    radius,
    budgetCapEnabled: f.budgetMax !== null,
    budgetMax,
    skillLevel: f.skill ?? "",
    vibe: f.vibe ?? "",
    walkOrCart: f.walk ?? "",
    travelLocation: f.location,
    prefs: f.prefs,
    showAdvanced: f.budgetMax !== null || f.skill !== null || f.vibe !== null || f.walk !== null,
  };
}

// The sheet's submit: always a matched, join-intent search with the full
// preference set written (so "No Preference" for one search stays explicit).
export function findRoundSearch(draft: FindRoundDraft, prefs: NewPreferenceSelections): URLSearchParams {
  return buildRoundSearch(
    {
      when: draft.when,
      date: draft.when === "date" && draft.customDate ? draft.customDate : null,
      radius: draft.radius,
      intent: "join",
      budgetMax: draft.budgetCapEnabled ? draft.budgetMax : null,
      skill: draft.skillLevel || null,
      vibe: draft.vibe || null,
      walk: draft.walkOrCart || null,
      location: draft.travelLocation,
      prefs,
    },
    { matched: true },
  );
}

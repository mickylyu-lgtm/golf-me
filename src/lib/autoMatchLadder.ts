// Auto-Match's "never a dead end" plan: which rounds a golfer could join,
// a ladder of steps that widens the search one notch at a time, and what
// the page shows when even the widest step finds nothing (nearby golfers,
// then Host / Invite a friend).
//
// Order (Micky, 2026-11-05): strict first, then the date (chosen day, the
// 7 days from it, any upcoming day), then the radius (chosen, 25 mi,
// 50 mi), then the preference bar (strong, any overlap, none). Each wider
// notch starts again from the narrower ones before it (a wider radius
// tries the chosen day first). The first step with a round wins and the
// page says what was widened.
//
// Pure (no React, explicit .ts imports) so tests/autoMatchLadder.test.ts
// runs under plain node --test. Preference ranking itself stays in
// lib/autoMatch.ts; callers pass its result in as `matchedCount`/`rankScore`.
import type { GolfCall, SkillFilter, GolfVibe, WalkOrCart } from "../types/index.ts";
import { roundCalendarDay } from "./golfCall.ts";
import type { WhenChoice } from "./roundSearchParams.ts";

// The radii the ladder widens to after the golfer's own one.
export const WIDEN_RADII_MILES = [25, 50] as const;
export const WEEK_WINDOW_DAYS = 7;
// Up to this many golfers under the rounds, more when there are no rounds.
export const GOLFERS_WITH_ROUNDS = 3;
export const GOLFERS_WITHOUT_ROUNDS = 5;

export type DateScope = "chosen" | "week" | "any";
export type PrefScope = "strong" | "overlap" | "none";

export interface LadderStep {
  date: DateScope;
  radius: number;
  prefs: PrefScope;
  // Rounds need at least this many of the golfer's selected preferences.
  minMatched: number;
}

export interface LadderInput {
  when: WhenChoice | null;
  customDate: string | null;
  radius: number;
  // How many of the 5 Match Preferences the golfer has actually set.
  selectedPreferenceCount: number;
  // MIN_PREFERENCES_FOR_AUTO_MATCH (3), passed in to keep this file pure.
  strongThreshold: number;
}

function hasChosenDay(when: WhenChoice | null, customDate: string | null): boolean {
  if (!when) return false;
  if (when === "date") return Boolean(customDate);
  return true;
}

// A golfer with fewer than 3 preferences set can never clear "3 shared",
// so "strong" means "all of the ones you set" for them, and a golfer with
// none set skips the preference steps entirely (same bar at every level).
export function buildLadder(input: LadderInput): LadderStep[] {
  const selected = Math.max(0, input.selectedPreferenceCount);
  const dates: DateScope[] = hasChosenDay(input.when, input.customDate) ? ["chosen", "week", "any"] : ["any"];
  const radii = [input.radius, ...WIDEN_RADII_MILES.filter((r) => r > input.radius)];
  const levels: { prefs: PrefScope; minMatched: number }[] = [];
  for (const level of [
    { prefs: "strong" as const, minMatched: Math.min(input.strongThreshold, selected) },
    { prefs: "overlap" as const, minMatched: Math.min(1, selected) },
    { prefs: "none" as const, minMatched: 0 },
  ]) {
    if (!levels.some((l) => l.minMatched === level.minMatched)) levels.push(level);
  }

  // Nested so each wider radius tries the chosen day again first: a round
  // on your day 20 mi away is "widened to 25 mi", not "any day".
  const steps: LadderStep[] = [];
  for (const level of levels) {
    for (const radius of radii) {
      for (const date of dates) steps.push({ date, radius, ...level });
    }
  }
  return steps;
}

// ---- Dates -----------------------------------------------------------

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export interface DayRange {
  start: Date;
  // Exclusive; null = no end (any upcoming day).
  end: Date | null;
}

// The chosen day(s) as local-day bounds; same meaning as roundFilters'
// matchesWhen, with "now" passed in. This weekend on a Sunday starts today.
export function chosenDayRange(when: WhenChoice | null, customDate: string | null, now: Date): DayRange | null {
  const today = startOfDay(now);
  if (when === "today") return { start: today, end: addDays(today, 1) };
  if (when === "tomorrow") return { start: addDays(today, 1), end: addDays(today, 2) };
  if (when === "weekend") {
    const day = today.getDay(); // 0 Sun .. 6 Sat
    const saturday = day === 0 ? addDays(today, -1) : addDays(today, (6 - day) % 7);
    const start = saturday < today ? today : saturday;
    return { start, end: addDays(saturday, 2) };
  }
  if (when === "date" && customDate && /^\d{4}-\d{2}-\d{2}$/.test(customDate)) {
    const d = startOfDay(new Date(`${customDate}T12:00:00`));
    if (Number.isNaN(d.getTime())) return null;
    return { start: d, end: addDays(d, 1) };
  }
  return null;
}

export function dayRangeFor(scope: DateScope, when: WhenChoice | null, customDate: string | null, now: Date): DayRange {
  const today = startOfDay(now);
  const chosen = chosenDayRange(when, customDate, now);
  if (scope === "chosen" && chosen) return chosen;
  if (scope === "week" && chosen) {
    const anchor = chosen.start < today ? today : chosen.start;
    return { start: anchor, end: addDays(anchor, WEEK_WINDOW_DAYS) };
  }
  return { start: today, end: null };
}

export function isRoundInRange(call: Pick<GolfCall, "dateISO">, range: DayRange): boolean {
  const day = roundCalendarDay(call.dateISO);
  if (Number.isNaN(day.getTime())) return false;
  return day >= range.start && (range.end === null || day < range.end);
}

// ---- Eligibility -----------------------------------------------------

export interface EligibilityContext {
  userId: string;
  now: Date;
  // Either direction; the page passes DataContext's isBlocked (+ isBlockedBy).
  isBlocked: (golferId: string) => boolean;
}

type EligibilityFields = Pick<GolfCall, "status" | "dateISO" | "hostId" | "totalSpots" | "joinedGolferIds" | "pendingRequestIds">;

// A round Auto-Match may suggest: open, a free spot, today or later, not
// yours, not one you're in or asked to join, and nobody in it is blocked.
export function isEligibleRound(call: EligibilityFields, ctx: EligibilityContext): boolean {
  if (call.status !== "open") return false;
  if (call.totalSpots - call.joinedGolferIds.length <= 0) return false;
  if (call.hostId === ctx.userId) return false;
  if (call.joinedGolferIds.includes(ctx.userId) || call.pendingRequestIds.includes(ctx.userId)) return false;
  if (ctx.isBlocked(call.hostId) || call.joinedGolferIds.some((id) => ctx.isBlocked(id))) return false;
  return isRoundInRange(call, { start: startOfDay(ctx.now), end: null });
}

// Find a Round's advanced filters are explicit choices, so they never widen.
export interface AdvancedRoundFilters {
  budgetMax: number | null;
  skill: SkillFilter | null;
  vibe: GolfVibe | null;
  walk: WalkOrCart | null;
}

export function matchesAdvancedFilters(
  call: Pick<GolfCall, "estimatedPricePerPerson" | "skillLevel" | "vibe" | "walkOrCart">,
  f: AdvancedRoundFilters,
): boolean {
  if (f.budgetMax !== null && call.estimatedPricePerPerson > f.budgetMax) return false;
  if (f.skill && call.skillLevel !== f.skill && call.skillLevel !== "Any Skill Level") return false;
  if (f.vibe && call.vibe !== f.vibe) return false;
  if (f.walk && f.walk !== "Either" && call.walkOrCart !== f.walk && call.walkOrCart !== "Either") return false;
  return true;
}

// ---- Ladder ----------------------------------------------------------

export interface RoundCandidate {
  call: EligibilityFields & Pick<GolfCall, "id">;
  // undefined = unknown (no coordinates); never inside any radius.
  distanceMiles: number | undefined;
  matchedCount: number;
  rankScore: number;
}

function withinRadius(distance: number | undefined, radius: number): boolean {
  return distance !== undefined && Number.isFinite(distance) && distance <= radius;
}

// Most shared preferences first, then the existing compatibility rank, then nearest.
function compareRounds(a: RoundCandidate, b: RoundCandidate): number {
  if (b.matchedCount !== a.matchedCount) return b.matchedCount - a.matchedCount;
  if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
  return (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity);
}

export function roundsForStep<C extends RoundCandidate>(
  candidates: C[],
  step: LadderStep,
  when: WhenChoice | null,
  customDate: string | null,
  now: Date,
): C[] {
  const range = dayRangeFor(step.date, when, customDate, now);
  return candidates
    .filter((c) => isRoundInRange(c.call, range) && withinRadius(c.distanceMiles, step.radius) && c.matchedCount >= step.minMatched)
    .sort(compareRounds);
}

// ---- Golfers ---------------------------------------------------------

export interface GolferCandidate {
  id: string;
  distanceMiles: number | undefined;
  // computeCompatibility(...).overall
  score: number;
}

// Best-matched golfers inside the first radius that has any (chosen, 25,
// 50 mi). Unknown-distance golfers are left out: "near you" must be true.
export function nearbyGolfers<G extends GolferCandidate>(
  golfers: G[],
  radius: number,
  limit: number,
  isBlocked: (id: string) => boolean = () => false,
): { golfers: G[]; radius: number | null } {
  const radii = [radius, ...WIDEN_RADII_MILES.filter((r) => r > radius)];
  const usable = golfers.filter((g) => !isBlocked(g.id));
  for (const r of radii) {
    const inside = usable
      .filter((g) => withinRadius(g.distanceMiles, r))
      .sort((a, b) => b.score - a.score || (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
    if (inside.length > 0) return { golfers: inside.slice(0, limit), radius: r };
  }
  return { golfers: [], radius: null };
}

// ---- The whole plan --------------------------------------------------

// What the step widened compared with the strict first step (null = not widened).
export interface Widening {
  date: Exclude<DateScope, "chosen"> | null;
  radius: number | null;
  prefs: Exclude<PrefScope, "strong"> | null;
}

export type AutoMatchPlan<C extends RoundCandidate, G extends GolferCandidate> =
  | { kind: "needsLocation" }
  | { kind: "rounds"; rounds: C[]; step: LadderStep; widened: Widening; golfers: G[]; golferRadius: number | null }
  | { kind: "golfers"; golfers: G[]; golferRadius: number }
  | { kind: "empty" };

export interface AutoMatchPlanInput<C extends RoundCandidate, G extends GolferCandidate> extends LadderInput {
  // The search has real coordinates (saved area or "Playing Somewhere Else?").
  hasLocation: boolean;
  now: Date;
  eligibility: EligibilityContext;
  rounds: C[];
  golfers: G[];
}

export function planAutoMatch<C extends RoundCandidate, G extends GolferCandidate>(input: AutoMatchPlanInput<C, G>): AutoMatchPlan<C, G> {
  // Without a location every distance is unknown: ask for one instead of
  // silently searching everywhere.
  if (!input.hasLocation) return { kind: "needsLocation" };

  const eligible = input.rounds.filter((c) => isEligibleRound(c.call, input.eligibility));
  const steps = buildLadder(input);
  const strict = steps[0];
  for (const step of steps) {
    const rounds = roundsForStep(eligible, step, input.when, input.customDate, input.now);
    if (rounds.length === 0) continue;
    const near = nearbyGolfers(input.golfers, input.radius, GOLFERS_WITH_ROUNDS, input.eligibility.isBlocked);
    return {
      kind: "rounds",
      rounds,
      step,
      widened: {
        date: step.date !== strict.date && step.date !== "chosen" ? step.date : null,
        radius: step.radius !== strict.radius ? step.radius : null,
        prefs: step.minMatched < strict.minMatched && step.prefs !== "strong" ? step.prefs : null,
      },
      golfers: near.golfers,
      golferRadius: near.radius,
    };
  }

  const near = nearbyGolfers(input.golfers, input.radius, GOLFERS_WITHOUT_ROUNDS, input.eligibility.isBlocked);
  if (near.golfers.length > 0 && near.radius !== null) return { kind: "golfers", golfers: near.golfers, golferRadius: near.radius };
  return { kind: "empty" };
}

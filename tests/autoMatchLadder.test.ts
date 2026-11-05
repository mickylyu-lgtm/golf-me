// Run: npm run test:play  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLadder,
  chosenDayRange,
  isEligibleRound,
  matchesAdvancedFilters,
  nearbyGolfers,
  planAutoMatch,
} from "../src/lib/autoMatchLadder.ts";
import type { AutoMatchPlanInput, GolferCandidate, RoundCandidate } from "../src/lib/autoMatchLadder.ts";
import { hostPrefillSearch, parseHostPrefill } from "../src/lib/hostPrefill.ts";
import type { GolfCall } from "../src/types/index.ts";

// Wednesday 4 Nov 2026, 10:00 local.
const NOW = new Date(2026, 10, 4, 10, 0, 0);
const ME = "me";

function ymd(daysFromNow: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + daysFromNow);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Noon UTC on that calendar day: roundCalendarDay reads the UTC date.
function dayIso(daysFromNow: number): string {
  return `${ymd(daysFromNow)}T12:00:00.000Z`;
}

type Call = RoundCandidate["call"] & Pick<GolfCall, "estimatedPricePerPerson" | "skillLevel" | "vibe" | "walkOrCart">;

function call(id: string, over: Partial<Call> = {}): Call {
  return {
    id,
    status: "open",
    dateISO: dayIso(0),
    hostId: `host-${id}`,
    totalSpots: 4,
    joinedGolferIds: [`host-${id}`],
    pendingRequestIds: [],
    estimatedPricePerPerson: 60,
    skillLevel: "Any Skill Level",
    vibe: "Casual & Social",
    walkOrCart: "Either",
    ...over,
  };
}

interface Cand extends RoundCandidate {
  call: Call;
}

function cand(c: Call, distanceMiles: number | undefined, matchedCount = 3, rankScore = 50): Cand {
  return { call: c, distanceMiles, matchedCount, rankScore };
}

interface G extends GolferCandidate {
  name: string;
}

function golfer(id: string, distanceMiles: number | undefined, score = 70): G {
  return { id, name: id, distanceMiles, score };
}

function input(over: Partial<AutoMatchPlanInput<Cand, G>> = {}): AutoMatchPlanInput<Cand, G> {
  return {
    hasLocation: true,
    when: "today",
    customDate: null,
    radius: 10,
    selectedPreferenceCount: 5,
    strongThreshold: 3,
    now: NOW,
    eligibility: { userId: ME, now: NOW, isBlocked: () => false },
    rounds: [],
    golfers: [],
    ...over,
  };
}

test("ladder: date first, then radius, then preference bar", () => {
  const steps = buildLadder({ when: "today", customDate: null, radius: 10, selectedPreferenceCount: 5, strongThreshold: 3 });
  const labels = steps.map((s) => `${s.date}/${s.radius}/${s.prefs}:${s.minMatched}`);
  assert.equal(labels.length, 27);
  assert.deepEqual(labels.slice(0, 7), [
    "chosen/10/strong:3",
    "week/10/strong:3",
    "any/10/strong:3",
    "chosen/25/strong:3",
    "week/25/strong:3",
    "any/25/strong:3",
    "chosen/50/strong:3",
  ]);
  assert.equal(labels[9], "chosen/10/overlap:1");
  assert.equal(labels[26], "any/50/none:0");
});

test("ladder: no chosen day, a big radius and no preferences collapse to one step", () => {
  const steps = buildLadder({ when: null, customDate: null, radius: 60, selectedPreferenceCount: 0, strongThreshold: 3 });
  assert.deepEqual(steps, [{ date: "any", radius: 60, prefs: "strong", minMatched: 0 }]);
});

test("ladder: with 2 preferences set, strong means both", () => {
  const steps = buildLadder({ when: null, customDate: null, radius: 25, selectedPreferenceCount: 2, strongThreshold: 3 });
  assert.deepEqual(
    steps.map((s) => `${s.radius}/${s.prefs}:${s.minMatched}`),
    ["25/strong:2", "50/strong:2", "25/overlap:1", "50/overlap:1", "25/none:0", "50/none:0"],
  );
});

test("no rounds at all and no golfers: empty (Host / Invite)", () => {
  assert.deepEqual(planAutoMatch(input()), { kind: "empty" });
});

test("missing location asks for one instead of searching everywhere", () => {
  const plan = planAutoMatch(input({ hasLocation: false, rounds: [cand(call("a"), 3)], golfers: [golfer("g", 2)] }));
  assert.deepEqual(plan, { kind: "needsLocation" });
});

test("strict hit: no widening note", () => {
  const plan = planAutoMatch(input({ rounds: [cand(call("a"), 3)] }));
  assert.equal(plan.kind, "rounds");
  if (plan.kind !== "rounds") return;
  assert.deepEqual(plan.widened, { date: null, radius: null, prefs: null });
  assert.deepEqual(plan.rounds.map((r) => r.call.id), ["a"]);
});

test("rounds only on other days: today widens to the week, then any day", () => {
  const inWeek = planAutoMatch(input({ rounds: [cand(call("a", { dateISO: dayIso(3) }), 3)] }));
  assert.equal(inWeek.kind, "rounds");
  if (inWeek.kind === "rounds") assert.equal(inWeek.widened.date, "week");

  const later = planAutoMatch(input({ rounds: [cand(call("b", { dateISO: dayIso(12) }), 3)] }));
  assert.equal(later.kind, "rounds");
  if (later.kind === "rounds") {
    assert.equal(later.widened.date, "any");
    assert.equal(later.widened.radius, null);
  }
});

test("a chosen date: the week runs from that day, not from today", () => {
  const plan = planAutoMatch(
    input({
      when: "date",
      customDate: ymd(10),
      rounds: [cand(call("before", { dateISO: dayIso(9) }), 3), cand(call("after", { dateISO: dayIso(13) }), 3)],
    }),
  );
  assert.equal(plan.kind, "rounds");
  if (plan.kind !== "rounds") return;
  assert.equal(plan.widened.date, "week");
  assert.deepEqual(plan.rounds.map((r) => r.call.id), ["after"]);
});

test("only far rounds: radius widens to 25, then 50, and never past it", () => {
  const at20 = planAutoMatch(input({ rounds: [cand(call("a"), 20)] }));
  assert.equal(at20.kind, "rounds");
  if (at20.kind === "rounds") {
    assert.equal(at20.widened.radius, 25);
    // The round is on the chosen day, so the day isn't reported as widened.
    assert.equal(at20.widened.date, null);
  }
  const at40 = planAutoMatch(input({ rounds: [cand(call("a"), 40)] }));
  assert.equal(at40.kind, "rounds");
  if (at40.kind === "rounds") assert.equal(at40.widened.radius, 50);

  assert.equal(planAutoMatch(input({ rounds: [cand(call("a"), 80)] })).kind, "empty");
});

test("unknown distance never counts as near", () => {
  assert.equal(planAutoMatch(input({ rounds: [cand(call("a"), undefined)] })).kind, "empty");
});

test("preference mismatch: the bar drops to any overlap, then none", () => {
  const some = planAutoMatch(input({ rounds: [cand(call("a"), 3, 1)] }));
  assert.equal(some.kind, "rounds");
  if (some.kind === "rounds") assert.equal(some.widened.prefs, "overlap");

  const none = planAutoMatch(input({ rounds: [cand(call("a"), 3, 0)] }));
  assert.equal(none.kind, "rounds");
  if (none.kind === "rounds") assert.equal(none.widened.prefs, "none");
});

test("stops at the first step: a strong far round beats a weak near one", () => {
  const plan = planAutoMatch(input({ rounds: [cand(call("near-weak"), 2, 0), cand(call("far-strong"), 20, 3)] }));
  assert.equal(plan.kind, "rounds");
  if (plan.kind === "rounds") assert.deepEqual(plan.rounds.map((r) => r.call.id), ["far-strong"]);
});

test("ranking within a step: most preferences, then rank score, then distance", () => {
  const plan = planAutoMatch(
    input({
      rounds: [cand(call("a"), 2, 3, 40), cand(call("b"), 9, 4, 10), cand(call("c"), 1, 3, 40), cand(call("d"), 5, 3, 90)],
    }),
  );
  assert.equal(plan.kind, "rounds");
  if (plan.kind === "rounds") assert.deepEqual(plan.rounds.map((r) => r.call.id), ["b", "d", "c", "a"]);
});

test("blocked, full, past, cancelled, own and joined rounds are never suggested", () => {
  const blocked = new Set(["host-blocked", "rude"]);
  const eligibility = { userId: ME, now: NOW, isBlocked: (id: string) => blocked.has(id) };
  const rounds = [
    cand(call("blocked-host", { hostId: "host-blocked", joinedGolferIds: ["host-blocked"] }), 2),
    cand(call("blocked-player", { joinedGolferIds: ["host-blocked-player", "rude"] }), 2),
    cand(call("full", { totalSpots: 2, joinedGolferIds: ["host-full", "x"] }), 2),
    cand(call("status-full", { status: "full" }), 2),
    cand(call("cancelled", { status: "cancelled" }), 2),
    cand(call("completed", { status: "completed" }), 2),
    cand(call("past", { dateISO: dayIso(-1) }), 2),
    cand(call("mine", { hostId: ME, joinedGolferIds: [ME] }), 2),
    cand(call("joined", { joinedGolferIds: ["host-joined", ME] }), 2),
    cand(call("requested", { pendingRequestIds: [ME] }), 2),
    cand(call("ok"), 2),
  ];
  const plan = planAutoMatch(input({ eligibility, rounds, selectedPreferenceCount: 0 }));
  assert.equal(plan.kind, "rounds");
  if (plan.kind === "rounds") assert.deepEqual(plan.rounds.map((r) => r.call.id), ["ok"]);
  assert.equal(isEligibleRound(call("today-later"), eligibility), true);
});

test("advanced filters stay as chosen", () => {
  const c = call("a", { estimatedPricePerPerson: 120, skillLevel: "Advanced", walkOrCart: "Cart" });
  assert.equal(matchesAdvancedFilters(c, { budgetMax: 100, skill: null, vibe: null, walk: null }), false);
  assert.equal(matchesAdvancedFilters(c, { budgetMax: null, skill: "Beginner", vibe: null, walk: null }), false);
  assert.equal(matchesAdvancedFilters(c, { budgetMax: null, skill: null, vibe: null, walk: "Walking" }), false);
  assert.equal(matchesAdvancedFilters(c, { budgetMax: 150, skill: "Advanced", vibe: null, walk: "Either" }), true);
});

test("golfers fallback when no round exists, best match first, within the first radius that has any", () => {
  const plan = planAutoMatch(
    input({ golfers: [golfer("far", 40, 99), golfer("near-ok", 20, 60), golfer("near-best", 22, 85), golfer("unknown", undefined, 100)] }),
  );
  assert.equal(plan.kind, "golfers");
  if (plan.kind !== "golfers") return;
  assert.equal(plan.golferRadius, 25);
  assert.deepEqual(plan.golfers.map((g) => g.id), ["near-best", "near-ok"]);
});

test("golfers ride along with rounds (top 3) and blocked golfers are dropped", () => {
  const plan = planAutoMatch(
    input({
      rounds: [cand(call("a"), 3)],
      eligibility: { userId: ME, now: NOW, isBlocked: (id) => id === "g-blocked" },
      golfers: [golfer("g1", 2, 90), golfer("g-blocked", 1, 99), golfer("g2", 3, 80), golfer("g3", 4, 70), golfer("g4", 5, 60)],
    }),
  );
  assert.equal(plan.kind, "rounds");
  if (plan.kind === "rounds") {
    assert.deepEqual(plan.golfers.map((g) => g.id), ["g1", "g2", "g3"]);
    assert.equal(plan.golferRadius, 10);
  }
  assert.deepEqual(nearbyGolfers([golfer("x", 70)], 10, 5), { golfers: [], radius: null });
});

test("this weekend on a Sunday starts today, on a Wednesday it starts Saturday", () => {
  const sunday = new Date(2026, 10, 8, 9, 0, 0);
  const sun = chosenDayRange("weekend", null, sunday);
  assert.ok(sun);
  assert.equal(sun?.start.getDate(), 8);
  assert.equal(sun?.end?.getDate(), 9);
  const wed = chosenDayRange("weekend", null, NOW);
  assert.equal(wed?.start.getDate(), 7);
  assert.equal(wed?.end?.getDate(), 9);
});

test("host prefill carries the golfer's preferences and day, and reads back", () => {
  const params = hostPrefillSearch({
    when: "date",
    customDate: "2026-11-14",
    prefs: {
      roundLengthPreference: "9 Holes",
      genderPreference: "No preference",
      groupTypePreference: "Mixed / Anyone",
      gameFormatPreference: "Scramble",
      networkingPreference: "Open to Networking",
    },
    walk: "Walking",
    skill: "Any Skill Level",
  });
  assert.equal(params.get("when"), "date");
  assert.equal(params.get("date"), "2026-11-14");
  assert.equal(params.get("skill"), null);
  assert.deepEqual(parseHostPrefill(params), { holes: 9, gameFormat: "Scramble", vibe: "Networking", walkOrCart: "Walking", skillLevel: null });
  assert.deepEqual(parseHostPrefill(new URLSearchParams("holes=27&format=Golf&vibe=x&walk=Jet")), {
    holes: null,
    gameFormat: null,
    vibe: null,
    walkOrCart: null,
    skillLevel: null,
  });
});

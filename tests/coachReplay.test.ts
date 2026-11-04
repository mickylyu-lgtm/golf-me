// Run: npm run test:caddie  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCoachPlan,
  checkpointCuesFromJson,
  coachDwellMs,
  coachFocusSegments,
  coachPlanFromV1,
  v1Cues,
  v1Findings,
  v1Moments,
  v1Summary,
  v2Moments,
  weakestCheckpoint,
} from "../src/lib/coachReplay.ts";
import type { CoachFinding, CoachMoment, V1Coaching } from "../src/lib/coachReplay.ts";
import type { SwingAssessment, SwingSegmentAssessment } from "../src/lib/swingAssessment.ts";
import type { CaddieScore, CaddieSwingPhases } from "../src/types/index.ts";

function phases(overrides: Partial<CaddieSwingPhases> = {}): CaddieSwingPhases {
  return {
    address: { timestampSeconds: 0.4, confidence: "high" },
    backswing: { timestampSeconds: 0.8, confidence: "high" },
    top: { timestampSeconds: 1.3, confidence: "high" },
    downswing: { timestampSeconds: 1.5, confidence: "high" },
    impact: { windowStartSeconds: 1.6, windowEndSeconds: 1.7, confidence: "high" },
    followThrough: { timestampSeconds: 2.1, confidence: "high" },
    ...overrides,
  };
}

function seg(segment: SwingSegmentAssessment["segment"], anchorPhase: SwingSegmentAssessment["anchorPhase"], status: SwingSegmentAssessment["status"]): SwingSegmentAssessment {
  return { segment, anchorPhase, status, confidence: status === "unknown" ? 0 : 0.9, anchorKeypoint: "left_elbow" };
}

function score(points: Partial<Record<keyof CaddieScore["criteria"], number>> = {}): CaddieScore {
  const c = (key: keyof CaddieScore["criteria"]) => ({ points: points[key] ?? 12, reason: `${key} reason` });
  return {
    total: 60,
    criteria: {
      setupAndPosture: c("setupAndPosture"),
      backswing: c("backswing"),
      downswingSequencing: c("downswingSequencing"),
      balanceAndWeightTransfer: c("balanceAndWeightTransfer"),
      finish: c("finish"),
    },
  };
}

const moment = (id: CoachMoment["id"], timeSeconds: number): CoachMoment => ({ id, timeSeconds, label: id, approximate: false, source: "test" });
const good = (checkpoint: CoachFinding["checkpoint"], rank = 0): CoachFinding => ({
  checkpoint,
  kind: "good",
  rank,
  claim: { body: { kind: "stored", text: `good ${checkpoint} ${rank}` }, source: "test" },
});

test("v1Moments: places all four from trusted phases, finish labelled as follow-through", () => {
  const m = v1Moments(phases());
  assert.deepEqual(
    m.map((x) => [x.id, x.label, x.timeSeconds]),
    [
      ["address", "address", 0.4],
      ["top", "top", 1.3],
      ["impact", "impact", 1.65],
      ["finish", "follow_through", 2.1],
    ],
  );
  assert.equal(m.find((x) => x.id === "impact")?.approximate, true, "impact is a window midpoint, always approximate");
  assert.equal(m.find((x) => x.id === "top")?.approximate, false);
});

test("v1Moments: low-confidence or null phases are skipped, medium is hedged", () => {
  const m = v1Moments(
    phases({
      address: { timestampSeconds: 0.4, confidence: "low" },
      top: { timestampSeconds: 1.3, confidence: "medium" },
      followThrough: { timestampSeconds: null, confidence: null },
    }),
  );
  assert.deepEqual(m.map((x) => x.id), ["top", "impact"]);
  assert.equal(m[0].approximate, true);
});

test("v1Moments: a too-wide impact window is not frozen on", () => {
  const m = v1Moments(phases({ impact: { windowStartSeconds: 1.5, windowEndSeconds: 1.9, confidence: "high" } }));
  assert.equal(m.some((x) => x.id === "impact"), false);
});

test("v1Moments: no phases at all yields nothing", () => {
  assert.deepEqual(v1Moments(undefined), []);
});

test("v1Findings: measured verdicts map to their anchor phase; fixes get a cue, unknowns are dropped", () => {
  const assessment: SwingAssessment = {
    segments: [seg("left_arm", "top", "good"), seg("wrists", "top", "needs_improvement"), seg("knees", "address", "unknown")],
  };
  const f = v1Findings(assessment, undefined);
  assert.equal(f.length, 2);
  const fix = f.find((x) => x.kind === "fix")!;
  assert.equal(fix.checkpoint, "top");
  assert.equal(fix.claim.source, "assessment.wrists");
  assert.deepEqual(fix.cue?.body, { kind: "key", key: "coachReplay.cue.wrists" });
  assert.equal(f.find((x) => x.kind === "good")?.cue, undefined, "no cue is invented for a good verdict");
});

test("v1Findings: score reasons are used verbatim, only at the rubric's clear ends", () => {
  const f = v1Findings(undefined, score({ setupAndPosture: 17, backswing: 12, downswingSequencing: 6, finish: 16, balanceAndWeightTransfer: 2 }));
  assert.deepEqual(
    f.map((x) => [x.checkpoint, x.kind, x.claim.body]),
    [
      ["address", "good", { kind: "stored", text: "setupAndPosture reason" }],
      ["impact", "fix", { kind: "stored", text: "downswingSequencing reason" }],
      ["finish", "good", { kind: "stored", text: "finish reason" }],
    ],
  );
  assert.ok(f.every((x) => x.cue === undefined), "V1 Gemini output has no cue field, so none is shown");
  assert.equal(f.some((x) => x.claim.source.includes("balanceAndWeightTransfer")), false, "whole-swing criterion has no moment");
});

test("v1Findings: blank score reasons are ignored", () => {
  const s = score({ setupAndPosture: 18 });
  s.criteria.setupAndPosture.reason = "   ";
  assert.equal(v1Findings(undefined, s).length, 0);
});

test("buildCoachPlan: measured findings outrank Gemini's sentence; checkpoints with nothing to say are skipped", () => {
  const assessment: SwingAssessment = { segments: [seg("shoulder_line", "address", "good")] };
  const plan = coachPlanFromV1({ phases: phases(), assessment, score: score({ setupAndPosture: 18, backswing: 12, downswingSequencing: 12, finish: 12 }) });
  assert.equal(plan.source, "v1");
  assert.deepEqual(plan.checkpoints.map((c) => c.id), ["address"]);
  assert.equal(plan.checkpoints[0].good?.source, "assessment.shoulder_line");
  assert.equal(plan.checkpoints[0].fix, undefined);
});

test("buildCoachPlan: a moment out of swing order is dropped, even past a silent checkpoint", () => {
  const plan = buildCoachPlan("v1", [moment("address", 1.0), moment("top", 0.5), moment("impact", 1.4)], [good("address"), good("top"), good("impact")]);
  assert.deepEqual(plan.checkpoints.map((c) => c.id), ["address", "impact"]);

  const silent = buildCoachPlan("v1", [moment("address", 1.0), moment("top", 0.5), moment("impact", 0.8)], [good("top"), good("impact")]);
  assert.deepEqual(silent.checkpoints.map((c) => c.id), [], "address has no findings but still fixes the order");
});

test("buildCoachPlan: lowest rank wins; a fix's cue wins over a good's", () => {
  const fix: CoachFinding = {
    checkpoint: "top",
    kind: "fix",
    rank: 3,
    claim: { body: { kind: "stored", text: "fix" }, source: "f" },
    cue: { body: { kind: "stored", text: "fix cue" }, source: "f" },
  };
  const goodWithCue: CoachFinding = { ...good("top", 0), cue: { body: { kind: "stored", text: "good cue" }, source: "g" } };
  const plan = buildCoachPlan("demo", [moment("top", 1)], [good("top", 5), goodWithCue, fix]);
  assert.deepEqual(plan.checkpoints[0].good?.body, { kind: "stored", text: "good top 0" });
  assert.deepEqual(plan.checkpoints[0].cue?.body, { kind: "stored", text: "fix cue" });
});

test("buildCoachPlan: negative or non-finite times never become checkpoints", () => {
  const plan = buildCoachPlan("v1", [moment("address", -1), moment("top", Number.NaN)], [good("address"), good("top")]);
  assert.equal(plan.checkpoints.length, 0);
});

test("v2Moments: detected high/medium key frames only; an unheld finish is a follow-through", () => {
  const m = v2Moments({
    address: { status: "detected", timestampSeconds: 0.2, confidenceLabel: "high" },
    top: { status: "detected", timestampSeconds: 1.1, confidenceLabel: "low" },
    impact: { status: "inconclusive", timestampSeconds: null },
    finish: { status: "detected", timestampSeconds: 2.4, confidenceLabel: "medium", held: false },
  });
  assert.deepEqual(
    m.map((x) => [x.id, x.label, x.approximate]),
    [
      ["address", "address", false],
      ["finish", "follow_through", true],
    ],
  );
  const held = v2Moments({ finish: { status: "detected", timestampSeconds: 2.4, confidenceLabel: "high", held: true } });
  assert.equal(held[0].label, "finish");
});

// ── Server cues (analysis_json.checkpoint_cues) ──────────────────────────

test("server cue wins over the fixed per-fault cue; old rows fall back to it", () => {
  const assessment: SwingAssessment = { segments: [seg("wrists", "top", "needs_improvement")] };
  const withCue = coachPlanFromV1({ phases: phases(), assessment, checkpointCues: { top: "Let the wrists hinge late" } });
  assert.deepEqual(withCue.checkpoints[0].cue, { body: { kind: "stored", text: "Let the wrists hinge late" }, source: "details.checkpointCues.top" });

  const oldRow = coachPlanFromV1({ phases: phases(), assessment });
  assert.deepEqual(oldRow.checkpoints[0].cue?.body, { kind: "key", key: "coachReplay.cue.wrists" });

  const otherMomentOnly = coachPlanFromV1({ phases: phases(), assessment, checkpointCues: { address: "Soft knees" } });
  assert.deepEqual(otherMomentOnly.checkpoints[0].cue?.body, { kind: "key", key: "coachReplay.cue.wrists" }, "a cue for another moment doesn't leak");
});

test("server cue gives a Gemini-only checkpoint a cue it never had", () => {
  const plan = coachPlanFromV1({ phases: phases(), score: score({ downswingSequencing: 5 }), checkpointCues: { impact: "Hips lead, arms follow" } });
  assert.deepEqual(plan.checkpoints.map((c) => [c.id, c.cue?.body]), [["impact", { kind: "stored", text: "Hips lead, arms follow" }]]);
});

test("V1 finish checkpoint takes the follow_through cue", () => {
  const plan = coachPlanFromV1({ phases: phases(), score: score({ finish: 18 }), checkpointCues: { followThrough: "Hold it to the count of three" } });
  assert.equal(plan.checkpoints[0].id, "finish");
  assert.equal(plan.checkpoints[0].cue?.source, "details.checkpointCues.followThrough");
});

test("a cue alone never creates a freeze", () => {
  const plan = coachPlanFromV1({ phases: phases(), score: score(), checkpointCues: { address: "A", top: "T", impact: "I", followThrough: "F" } });
  assert.deepEqual(plan.checkpoints, [], "mid-band scores, no verdicts: nothing to say, cue or not");
});

test("a cue for a moment that wasn't placed is never shown", () => {
  const plan = coachPlanFromV1({
    phases: phases({ top: { timestampSeconds: 1.3, confidence: "low" } }),
    score: score({ backswing: 18 }),
    checkpointCues: { top: "Full turn" },
  });
  assert.deepEqual(plan.checkpoints, []);
});

test("v1Cues: blank and missing cues are ignored", () => {
  assert.deepEqual(v1Cues(undefined), {});
  assert.deepEqual(Object.keys(v1Cues({ address: "   ", top: "Turn" })), ["top"]);
});

test("checkpointCuesFromJson: stored JSON is re-sanitized and mapped to camelCase", () => {
  assert.deepEqual(checkpointCuesFromJson({ address: "**Soft** knees", follow_through: "Hold it", finish: "x", top: "" }), {
    address: "Soft knees",
    followThrough: "Hold it",
  });
  for (const raw of [undefined, null, "Turn", [], { top: 4 }]) assert.equal(checkpointCuesFromJson(raw), undefined);
});

// ── What to work on (focus, work_on, drill) ──────────────────────────────

function coaching(overrides: Partial<V1Coaching> = {}): V1Coaching {
  return {
    workOn: [
      { issue: "Upper body starts the downswing", whyItMatters: "Costs power.", confidence: "high" },
      { issue: "Arms lift", whyItMatters: "Hard to repeat.", confidence: "medium" },
      { issue: "Short finish", whyItMatters: "Face can stay open.", confidence: "low" },
    ],
    focus: { title: "Hips first", instruction: "Turn the lead hip before the shoulders unwind." },
    drill: { name: "Pump drill", steps: ["Pause at the top.", "Pump the hips twice.", "Swing through.", "Repeat ten times."] },
    ...overrides,
  };
}
const FOCUS_BODY = { kind: "stored", text: "Turn the lead hip before the shoulders unwind." };

test("a mid-band-only analysis now yields a fix (the focus, on the weakest checkpoint) and a summary card", () => {
  const plan = coachPlanFromV1({
    phases: phases(),
    score: score({ setupAndPosture: 13, backswing: 12, downswingSequencing: 11, finish: 14, balanceAndWeightTransfer: 3 }),
    coaching: coaching(),
  });
  assert.deepEqual(plan.checkpoints.map((c) => [c.id, c.fix?.source, c.good]), [["impact", "details.focus", undefined]]);
  assert.deepEqual(plan.checkpoints[0].fix?.title, { kind: "stored", text: "Hips first" });
  assert.deepEqual(plan.checkpoints[0].fix?.body, FOCUS_BODY);
  const s = plan.summary!;
  assert.equal(s.focus, undefined, "the focus is already on a card");
  assert.deepEqual(s.workOn.map((c) => c.source), ["details.workOn.0", "details.workOn.1"], "high/medium only, in stored order");
  assert.deepEqual(s.workOn[0].title, { kind: "stored", text: "Upper body starts the downswing" });
  assert.deepEqual(s.drill?.name, { kind: "stored", text: "Pump drill" });
  assert.equal(s.drill?.steps.length, 3, "at most three drill steps");
});

test("focus placement: ties go to the earlier checkpoint; balance never counts", () => {
  assert.equal(weakestCheckpoint(score({ setupAndPosture: 10, backswing: 10, downswingSequencing: 12, finish: 15, balanceAndWeightTransfer: 1 })), "address");
  assert.equal(weakestCheckpoint(score({ setupAndPosture: 15, backswing: 9, downswingSequencing: 9, finish: 9 })), "top");
  assert.equal(weakestCheckpoint(undefined), undefined);
});

test("no fix on a moment when every checkpoint criterion is >= 16; the focus moves to the summary", () => {
  const s = score({ setupAndPosture: 16, backswing: 18, downswingSequencing: 17, finish: 16, balanceAndWeightTransfer: 4 });
  assert.equal(weakestCheckpoint(s), undefined);
  const plan = coachPlanFromV1({ phases: phases(), score: s, coaching: coaching() });
  assert.ok(plan.checkpoints.length > 0);
  assert.ok(plan.checkpoints.every((c) => c.fix === undefined && c.good !== undefined));
  assert.deepEqual(plan.summary?.focus?.body, FOCUS_BODY);
  assert.deepEqual(plan.summary?.workOn.map((c) => c.source), ["details.workOn.0"], "focus takes one of the two lines");
});

test("old rows without a work_on tag: items stay off the moments and go to the summary", () => {
  const f = v1Findings(undefined, score(), coaching({ focus: { title: "", instruction: "" } }));
  assert.deepEqual(f, [], "no tag, no focus, mid-band scores: nothing is pinned to a moment");
  const plan = coachPlanFromV1({ phases: phases(), score: score(), coaching: coaching({ focus: { title: "", instruction: "" } }) });
  assert.deepEqual(plan.checkpoints, []);
  assert.deepEqual(plan.summary?.workOn.map((c) => c.source), ["details.workOn.0", "details.workOn.1"]);
});

test("a tagged high/medium work_on item is a fix on its checkpoint, ahead of the focus fallback", () => {
  const c = coaching();
  c.workOn[0] = { ...c.workOn[0], checkpoint: "impact" };
  c.workOn[1] = { ...c.workOn[1], checkpoint: "follow_through" };
  c.workOn[2] = { ...c.workOn[2], checkpoint: "top" }; // low confidence: never pinned
  const plan = coachPlanFromV1({ phases: phases(), score: score({ downswingSequencing: 9 }), coaching: c });
  assert.deepEqual(
    plan.checkpoints.map((x) => [x.id, x.fix?.source]),
    [
      ["impact", "details.workOn.0"],
      ["finish", "details.workOn.1"],
    ],
  );
  assert.deepEqual(plan.summary?.focus?.body, FOCUS_BODY, "the focus lost its moment to the tagged item, so it closes the replay");
  assert.deepEqual(plan.summary?.workOn, [], "both sure items are already on cards");
});

test("whole_swing and invalid tags never pin an item to a moment", () => {
  const c = coaching({ focus: { title: "", instruction: "" } });
  c.workOn[0] = { ...c.workOn[0], checkpoint: "whole_swing" };
  c.workOn[1] = { ...c.workOn[1], checkpoint: "backswing" as never };
  const plan = coachPlanFromV1({ phases: phases(), score: score(), coaching: c });
  assert.deepEqual(plan.checkpoints, []);
  assert.deepEqual(plan.summary?.workOn.map((x) => x.source), ["details.workOn.0", "details.workOn.1"]);
});

test("a tag for a moment that wasn't placed falls back to the summary", () => {
  const c = coaching({ focus: { title: "", instruction: "" } });
  c.workOn[0] = { ...c.workOn[0], checkpoint: "top" };
  const plan = coachPlanFromV1({ phases: phases({ top: { timestampSeconds: 1.3, confidence: "low" } }), score: score(), coaching: c });
  assert.deepEqual(plan.checkpoints, []);
  assert.equal(plan.summary?.workOn[0].source, "details.workOn.0");
});

test("a checkpoint with both a strength and a fix shows both", () => {
  const assessment: SwingAssessment = { segments: [seg("hip_sway", "impact", "good")] };
  const plan = coachPlanFromV1({ phases: phases(), assessment, score: score({ downswingSequencing: 10 }), coaching: coaching() });
  assert.equal(plan.checkpoints[0].id, "impact");
  assert.equal(plan.checkpoints[0].good?.source, "assessment.hip_sway");
  assert.equal(plan.checkpoints[0].fix?.source, "details.focus");
});

test("measured faults and clear-flaw score reasons still outrank the focus", () => {
  const assessment: SwingAssessment = { segments: [seg("torso", "impact", "needs_improvement")] };
  const plan = coachPlanFromV1({ phases: phases(), assessment, score: score({ downswingSequencing: 10 }), coaching: coaching() });
  assert.equal(plan.checkpoints[0].fix?.source, "assessment.torso");
  assert.deepEqual(plan.summary?.focus?.body, FOCUS_BODY);
});

test("v1Summary: nothing usable means no summary card; blank text is skipped", () => {
  assert.equal(v1Summary(undefined, new Set()), undefined);
  assert.equal(
    v1Summary({ workOn: [{ issue: "  ", whyItMatters: "x", confidence: "high" }], focus: { title: "", instruction: " " }, drill: { name: "", steps: ["a"] } }, new Set()),
    undefined,
  );
  const s = v1Summary({ workOn: [{ issue: "Turn more", whyItMatters: "  ", confidence: "medium" }], drill: { name: "Wall drill", steps: [" ", "Go"] } }, new Set());
  assert.deepEqual(s?.workOn[0], { body: { kind: "stored", text: "Turn more" }, source: "details.workOn.0" });
  assert.deepEqual(s?.drill?.steps, [{ kind: "stored", text: "Go" }]);
});

test("Coach Replay without coaching data (old callers) keeps its old behaviour", () => {
  const plan = coachPlanFromV1({ phases: phases(), score: score({ downswingSequencing: 11 }) });
  assert.deepEqual(plan.checkpoints, []);
  assert.equal(plan.summary, undefined);
});

test("coachFocusSegments: only measured pose findings highlight a body part", () => {
  const assessment: SwingAssessment = { segments: [seg("shoulder_line", "impact", "good"), seg("hip_sway", "impact", "needs_improvement")] };
  const plan = coachPlanFromV1({ phases: phases(), assessment, score: score({ downswingSequencing: 10 }), coaching: coaching() });
  assert.deepEqual(coachFocusSegments(plan.checkpoints[0]), { shoulder_line: "good", hip_sway: "needs_improvement" });

  const scoreOnly = coachPlanFromV1({ phases: phases(), score: score({ downswingSequencing: 10, setupAndPosture: 18 }), coaching: coaching() });
  for (const c of scoreOnly.checkpoints) assert.deepEqual(coachFocusSegments(c), {}, `${c.id}: score/focus findings have no body part`);
  assert.deepEqual(coachFocusSegments({ good: { body: { kind: "stored", text: "x" }, source: "assessment.elbow" } }), {}, "unknown segment ids are ignored");
});

test("coachDwellMs: calm floor, capped for long text", () => {
  assert.equal(coachDwellMs(0), 3500);
  assert.equal(coachDwellMs(10_000), 8000);
  assert.ok(coachDwellMs(80) > 3500 && coachDwellMs(80) < 8000);
});

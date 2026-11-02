// Run: npm run test:caddie  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoachPlan, coachDwellMs, coachPlanFromV1, v1Findings, v1Moments, v2Moments } from "../src/lib/coachReplay.ts";
import type { CoachFinding, CoachMoment } from "../src/lib/coachReplay.ts";
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

test("coachDwellMs: calm floor, capped for long text", () => {
  assert.equal(coachDwellMs(0), 3500);
  assert.equal(coachDwellMs(10_000), 8000);
  assert.ok(coachDwellMs(80) > 3500 && coachDwellMs(80) < 8000);
});

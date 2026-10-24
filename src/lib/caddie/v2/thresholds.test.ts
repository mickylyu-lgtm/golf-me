import { describe, expect, it } from "vitest";
import * as cameraAngle from "./cameraAngle.ts";
import * as keyFrames from "./keyFrames.ts";
import * as phaseOrder from "./phaseOrder.ts";
import * as qualityGate from "./qualityGate.ts";
import { CADDIE_V2_THRESHOLDS, validateThresholdRegistry } from "./thresholds.ts";
import type { ThresholdEntry } from "./thresholds.ts";

// Values as they were hard-coded before the registry existed (Phase 1,
// commits 37675c7 / 88188d3 / 657b1d0). Moving to the registry must not
// change behaviour; a deliberate value change updates this table too.
const PHASE1_VALUES: Record<string, number> = {
  QG_MIN_KEYPOINT_CONFIDENCE: 0.5,
  QG_MIN_PERSON_CONFIDENCE: 0.5,
  QG_MIN_CONFIDENT_KEYPOINTS: 8,
  QG_MIN_CONFIDENT_TORSO_KEYPOINTS: 3,
  QG_MIN_USABLE_FRAMES: 8,
  QG_MIN_USABLE_FRAME_RATIO: 0.5,
  CA_FACE_ON_MIN_SHOULDER_RATIO: 0.55,
  CA_FACE_ON_MIN_HIP_RATIO: 0.35,
  CA_DTL_MAX_SHOULDER_RATIO: 0.3,
  CA_DTL_MAX_HIP_RATIO: 0.2,
  CA_MAX_TORSO_TILT_DEGREES: 60,
  CA_DEFAULT_ADDRESS_FRAMES: 5,
  CA_ADDRESS_WINDOW_SECONDS: 0.25,
  CA_MIN_MEASURED_FRAMES: 3,
  CA_MIN_AGREEMENT: 0.67,
  PO_RANGE_TOLERANCE_SECONDS: 0.125,
  PO_MAX_TOP_TO_IMPACT_SECONDS: 1.0,
  PO_MAX_IMPACT_WINDOW_SECONDS: 0.3,
};

// Key-frame detector thresholds as introduced on 2026-10-24 (all placeholders).
const KEYFRAME_VALUES: Record<string, number> = {
  KF_MIN_WRIST_CONFIDENCE: 0.5,
  KF_MAX_WRIST_SEPARATION: 0.6,
  KF_MAX_GAP_SECONDS: 0.12,
  KF_SMOOTHING_WINDOW_SECONDS: 0.07,
  KF_SPEED_BASELINE_SECONDS: 0.05,
  KF_MIN_CLIP_SECONDS: 1.0,
  KF_MIN_HAND_RISE: 0.8,
  KF_MIN_DOWNSWING_SPEED: 2.0,
  KF_MAX_DOWNSWING_SECONDS: 0.6,
  KF_MAX_IMPACT_SEARCH_SECONDS: 0.3,
  KF_STILL_MAX_SPEED: 0.6,
  KF_MIN_STILL_SECONDS: 0.2,
  KF_MAX_ADDRESS_SEARCH_SECONDS: 3.0,
  KF_MAX_FINISH_SEARCH_SECONDS: 2.5,
  KF_LOCAL_WINDOW_SECONDS: 0.05,
  KF_MIN_LOCAL_COVERAGE: 0.4,
  KF_MULTI_SWING_RATIO: 0.8,
  KF_MAX_MULTI_PERSON_RATIO: 0.1,
  KF_MAX_BODY_JUMP: 0.5,
  KF_MIN_IMPACT_FPS: 24,
};

const MODULE_EXPORTS: Record<ThresholdEntry["module"], Record<string, unknown>> = {
  qualityGate,
  cameraAngle,
  phaseOrder,
  keyFrames,
};

const registry: Record<string, ThresholdEntry> = CADDIE_V2_THRESHOLDS;

function entry(overrides: Partial<ThresholdEntry>): ThresholdEntry {
  return {
    module: "qualityGate",
    value: 1,
    unit: "x",
    description: "test",
    status: "placeholder",
    source: "test",
    date: "2026-10-20",
    evidence: null,
    ...overrides,
  };
}

const GOOD_EVIDENCE = {
  evalReport: "docs/caddie-v2/eval-reports/2027-01-eval-01.md",
  datasetVersion: "ds-2027-01-01",
  sampleSize: 80,
  coachIds: ["K01", "K02"],
};

describe("threshold registry", () => {
  it("passes its own rules", () => {
    expect(validateThresholdRegistry(registry)).toEqual([]);
  });

  it("marks no threshold as coach-validated without an evidence reference", () => {
    for (const [id, t] of Object.entries(registry)) {
      if (t.status === "coach_validated") {
        expect(t.evidence, id).not.toBeNull();
        expect(t.evidence?.evalReport, id).toMatch(/^docs\/caddie-v2\/eval-reports\//);
      }
    }
  });

  it("is entirely placeholder as of Phase 1 (no evaluation has been run)", () => {
    // When the first real eval report lands, replace this with a check of
    // exactly which thresholds that report validated.
    for (const [id, t] of Object.entries(registry)) expect(t.status, id).toBe("placeholder");
  });

  it("keeps the Phase 1 values (refactor did not change behaviour) and the key-frame values", () => {
    const expected = { ...PHASE1_VALUES, ...KEYFRAME_VALUES };
    expect(Object.keys(registry).sort()).toEqual(Object.keys(expected).sort());
    for (const [id, value] of Object.entries(expected)) expect(registry[id].value, id).toBe(value);
  });

  it("is what each module actually exports and uses", () => {
    for (const [id, t] of Object.entries(registry)) {
      expect(MODULE_EXPORTS[t.module][id], `${t.module}.${id}`).toBe(t.value);
    }
  });

  it("covers every threshold constant a module exports", () => {
    for (const [module, exports] of Object.entries(MODULE_EXPORTS)) {
      for (const name of Object.keys(exports)) {
        if (/^(QG|CA|PO|KF)_/.test(name)) expect(registry[name]?.module, `${module}.${name}`).toBe(module);
      }
    }
  });
});

describe("validateThresholdRegistry", () => {
  it("rejects coach_validated with no evidence", () => {
    const problems = validateThresholdRegistry({ X: entry({ status: "coach_validated", evidence: null }) });
    expect(problems).toEqual(["X: coach_validated without an evidence reference"]);
  });

  it("accepts coach_validated with complete evidence", () => {
    expect(validateThresholdRegistry({ X: entry({ status: "coach_validated", evidence: GOOD_EVIDENCE }) })).toEqual([]);
  });

  it("rejects evidence that points outside eval-reports, has no sample, or names a coach", () => {
    const problems = validateThresholdRegistry({
      X: entry({
        status: "coach_validated",
        evidence: { evalReport: "notes.md", datasetVersion: "", sampleSize: 0, coachIds: ["jane@example.com"] },
      }),
    });
    expect(problems).toHaveLength(4);
  });

  it("rejects validated with an empty coach list", () => {
    const problems = validateThresholdRegistry({
      X: entry({ status: "coach_validated", evidence: { ...GOOD_EVIDENCE, coachIds: [] } }),
    });
    expect(problems).toEqual(["X: evidence.coachIds must name at least one coach"]);
  });

  it("rejects a placeholder that claims evidence, a bad date, a missing source, a non-finite value", () => {
    expect(validateThresholdRegistry({ X: entry({ evidence: GOOD_EVIDENCE }) })).toEqual([
      "X: placeholder must not carry evidence",
    ]);
    expect(validateThresholdRegistry({ X: entry({ date: "20 Oct 2026" }) })).toHaveLength(1);
    expect(validateThresholdRegistry({ X: entry({ source: " " }) })).toHaveLength(1);
    expect(validateThresholdRegistry({ X: entry({ value: Number.NaN }) })).toHaveLength(1);
  });
});

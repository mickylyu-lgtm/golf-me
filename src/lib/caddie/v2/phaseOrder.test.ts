import { describe, expect, it } from "vitest";
import { analyzedRangeOf, parseV1GeminiPhases, validatePhaseOrder } from "./phaseOrder.ts";
import type { AnalyzedRange } from "./phaseOrder.ts";

// Synthetic V1 Gemini `analysis_json.phases` objects (snake_case).
function v1Phases(overrides: Record<string, unknown> = {}) {
  return {
    address: { timestamp_seconds: 0.25, confidence: "high" },
    backswing: { timestamp_seconds: 0.75, confidence: "medium" },
    top: { timestamp_seconds: 1.25, confidence: "high" },
    downswing: { timestamp_seconds: 1.4, confidence: "medium" },
    impact: { window_start_seconds: 1.5, window_end_seconds: 1.625, confidence: "medium" },
    follow_through: { timestamp_seconds: 2.0, confidence: "high" },
    ...overrides,
  };
}

const RANGE = { startSeconds: 0, endSeconds: 2.5 };

function check(raw: unknown, range: AnalyzedRange | null = RANGE) {
  const parsed = parseV1GeminiPhases(raw);
  return validatePhaseOrder(parsed.segments, range, { impactWindowIncomplete: parsed.impactWindowIncomplete });
}

describe("parseV1GeminiPhases", () => {
  it("parses snake_case phases and treats null timestamps as absent", () => {
    const parsed = parseV1GeminiPhases(v1Phases({ backswing: { timestamp_seconds: null, confidence: null } }));
    expect(parsed.segments.address).toEqual({ timestampSeconds: 0.25, confidence: "high" });
    expect(parsed.segments.backswing).toBeNull();
    expect(parsed.segments.impact).toEqual({ windowStartSeconds: 1.5, windowEndSeconds: 1.625, confidence: "medium" });
    expect(parsed.segments.followThrough?.timestampSeconds).toBe(2);
  });

  it("drops an unknown confidence label rather than guessing one", () => {
    const parsed = parseV1GeminiPhases(v1Phases({ top: { timestamp_seconds: 1.25, confidence: "very high" } }));
    expect(parsed.segments.top?.confidence).toBeNull();
  });

  it("returns all-null segments for malformed input", () => {
    for (const raw of [null, "phases", 42, []]) {
      const { segments } = parseV1GeminiPhases(raw);
      expect(Object.values(segments).every((v) => v === null)).toBe(true);
    }
  });

  it("flags a half-specified impact window", () => {
    const parsed = parseV1GeminiPhases(v1Phases({ impact: { window_start_seconds: 1.5, window_end_seconds: null, confidence: "low" } }));
    expect(parsed.segments.impact).toBeNull();
    expect(parsed.impactWindowIncomplete).toBe(true);
  });
});

describe("validatePhaseOrder", () => {
  it("accepts a consistent timeline", () => {
    expect(check(v1Phases())).toMatchObject({ status: "consistent", issues: [], phasesPresent: 6 });
  });

  it("accepts a partial timeline whose present phases are ordered", () => {
    const result = check(v1Phases({ backswing: { timestamp_seconds: null }, downswing: { timestamp_seconds: null } }));
    expect(result).toMatchObject({ status: "consistent", phasesPresent: 4 });
  });

  it("flags out-of-order phases", () => {
    const result = check(v1Phases({ top: { timestamp_seconds: 0.5, confidence: "high" } }));
    expect(result.status).toBe("inconsistent");
    expect(result.issues).toContainEqual({ code: "out_of_order", phases: ["backswing", "top"] });
  });

  it("flags two phases at the same instant", () => {
    const result = check(v1Phases({ backswing: { timestamp_seconds: 0.25, confidence: "low" } }));
    expect(result.issues).toContainEqual({ code: "out_of_order", phases: ["address", "backswing"] });
  });

  it("flags impact overlapping follow-through", () => {
    const result = check(v1Phases({ follow_through: { timestamp_seconds: 1.6, confidence: "high" } }));
    expect(result.issues).toContainEqual({ code: "out_of_order", phases: ["impact", "follow_through"] });
  });

  it("flags timestamps outside the analyzed pose range", () => {
    const result = check(v1Phases({ follow_through: { timestamp_seconds: 4.0, confidence: "high" } }));
    expect(result.issues).toContainEqual({ code: "outside_analyzed_range", phases: ["follow_through"] });
  });

  it("allows one sample of slack at the range edges", () => {
    const result = check(v1Phases({ address: { timestamp_seconds: -0.1, confidence: "high" } }));
    expect(result.issues.some((i) => i.code === "outside_analyzed_range")).toBe(false);
  });

  it("skips the range check when no range is given", () => {
    const result = check(v1Phases({ follow_through: { timestamp_seconds: 40, confidence: "high" } }), null);
    expect(result.status).toBe("consistent");
  });

  it("flags inverted, too-wide and incomplete impact windows", () => {
    expect(check(v1Phases({ impact: { window_start_seconds: 1.6, window_end_seconds: 1.5 } })).issues).toContainEqual({
      code: "impact_window_inverted",
      phases: ["impact"],
    });
    expect(check(v1Phases({ impact: { window_start_seconds: 1.45, window_end_seconds: 1.9 } })).issues).toContainEqual({
      code: "impact_window_too_wide",
      phases: ["impact"],
    });
    expect(check(v1Phases({ impact: { window_start_seconds: null, window_end_seconds: 1.6 } })).issues).toContainEqual({
      code: "impact_window_incomplete",
      phases: ["impact"],
    });
  });

  it("flags an implausibly long top-to-impact gap", () => {
    const result = check(
      v1Phases({
        top: { timestamp_seconds: 0.45, confidence: "high" },
        backswing: { timestamp_seconds: 0.35 },
        downswing: { timestamp_seconds: null },
      }),
    );
    expect(result.issues).toContainEqual({ code: "top_to_impact_too_long", phases: ["top", "impact"] });
  });

  it("reports non-finite timestamps", () => {
    const parsed = parseV1GeminiPhases(v1Phases());
    const segments = { ...parsed.segments, top: { timestampSeconds: Number.NaN, confidence: "high" as const } };
    const result = validatePhaseOrder(segments, RANGE);
    expect(result.issues).toContainEqual({ code: "non_finite_timestamp", phases: ["top"] });
    expect(result.status).toBe("inconsistent");
  });

  it("is inconclusive with fewer than two phases", () => {
    const onlyTop = { top: { timestamp_seconds: 1.25, confidence: "high" } };
    expect(check(onlyTop)).toMatchObject({ status: "inconclusive", inconclusiveReason: "fewer_than_two_phases", phasesPresent: 1 });
    expect(check({})).toMatchObject({ status: "inconclusive", phasesPresent: 0 });
  });
});

describe("analyzedRangeOf", () => {
  it("returns the first-to-last frame span regardless of order", () => {
    expect(analyzedRangeOf([{ timestampSeconds: 1 }, { timestampSeconds: 0.25 }, { timestampSeconds: 2 }])).toEqual({
      startSeconds: 0.25,
      endSeconds: 2,
    });
    expect(analyzedRangeOf([])).toBeNull();
  });
});

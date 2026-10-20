// Phase-order sanity check (audit §2.2 and gap C8).
//
// V1 accepts Gemini's phase timestamps after a presence check only. This
// module checks that the phases that WERE given are internally consistent:
// finite, inside the analyzed time range, in swing order, with a well-formed
// impact window. It never fills in or moves a phase; it only reports.
//
// Usable on V1 output today via parseV1GeminiPhases (the snake_case
// `analysis_json.phases` object Gemini returns), and on a future V2
// segmenter's SwingSegments directly.

import type { PhaseConfidenceLabel, SwingPhaseMoment, SwingSegments } from "./types.ts";

export const PHASE_ORDER_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// PROVISIONAL THRESHOLDS: placeholders, NOT validated.
// To be tuned on the coach-labeled evaluation set (audit §8). Do not quote
// any pass/fail rate from these as accuracy.
// ---------------------------------------------------------------------------

/** Slack allowed outside the first/last pose frame time (one 8 fps sample). PROVISIONAL. */
export const PO_RANGE_TOLERANCE_SECONDS = 0.125;
/** Longest plausible gap from top of backswing to the start of the impact window. PROVISIONAL. */
export const PO_MAX_TOP_TO_IMPACT_SECONDS = 1.0;
/** Impact windows wider than this are flagged as too imprecise to anchor on. Matches V1 swingAssessment. PROVISIONAL. */
export const PO_MAX_IMPACT_WINDOW_SECONDS = 0.3;

export type PhaseIssueCode =
  | "non_finite_timestamp"
  | "outside_analyzed_range"
  | "out_of_order"
  | "impact_window_inverted"
  | "impact_window_incomplete"
  | "impact_window_too_wide"
  | "top_to_impact_too_long";

export interface PhaseIssue {
  code: PhaseIssueCode;
  /** The phase(s) involved, in swing order. */
  phases: string[];
}

export interface PhaseOrderResult {
  moduleVersion: string;
  /**
   * consistent: every present phase passed every check.
   * inconsistent: at least one issue; don't anchor anything on these phases.
   * inconclusive: fewer than two usable phases, so order can't be checked.
   */
  status: "consistent" | "inconsistent" | "inconclusive";
  inconclusiveReason: "fewer_than_two_phases" | null;
  issues: PhaseIssue[];
  /** Number of phases present (impact counts once). */
  phasesPresent: number;
}

export interface AnalyzedRange {
  startSeconds: number;
  endSeconds: number;
}

const V1_CONFIDENCE: ReadonlySet<string> = new Set(["high", "medium", "low"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfidence(value: unknown): PhaseConfidenceLabel | null {
  return typeof value === "string" && V1_CONFIDENCE.has(value) ? (value as PhaseConfidenceLabel) : null;
}

function parseMoment(raw: unknown): SwingPhaseMoment | null {
  if (!isRecord(raw) || typeof raw.timestamp_seconds !== "number") return null;
  // Non-finite numbers are kept so the validator can report them, not
  // silently dropped as if the phase were simply absent.
  return { timestampSeconds: raw.timestamp_seconds, confidence: parseConfidence(raw.confidence) };
}

export interface ParsedV1Phases {
  segments: SwingSegments;
  /** True when Gemini gave exactly one of the two impact window bounds. */
  impactWindowIncomplete: boolean;
}

/**
 * Parses V1 Gemini `analysis_json.phases` (snake_case). Null timestamps mean
 * "not identified" and become null phases. Malformed input yields all-null
 * segments rather than throwing.
 */
export function parseV1GeminiPhases(raw: unknown): ParsedV1Phases {
  const r = isRecord(raw) ? raw : {};
  let impact: SwingSegments["impact"] = null;
  let impactWindowIncomplete = false;
  if (isRecord(r.impact)) {
    const start = r.impact.window_start_seconds;
    const end = r.impact.window_end_seconds;
    const hasStart = typeof start === "number";
    const hasEnd = typeof end === "number";
    if (hasStart && hasEnd) {
      impact = { windowStartSeconds: start, windowEndSeconds: end, confidence: parseConfidence(r.impact.confidence) };
    } else if (hasStart !== hasEnd) {
      impactWindowIncomplete = true;
    }
  }
  return {
    segments: {
      address: parseMoment(r.address),
      backswing: parseMoment(r.backswing),
      top: parseMoment(r.top),
      downswing: parseMoment(r.downswing),
      impact,
      followThrough: parseMoment(r.follow_through),
    },
    impactWindowIncomplete,
  };
}

interface TimelinePoint {
  name: string;
  /** Earliest and latest time this phase occupies (equal for an instant). */
  start: number;
  end: number;
}

/**
 * Checks phase consistency. `range` is the analyzed pose time span (first to
 * last pose frame); pass null to skip the range check.
 */
export function validatePhaseOrder(
  segments: SwingSegments,
  range: AnalyzedRange | null,
  options: { impactWindowIncomplete?: boolean } = {},
): PhaseOrderResult {
  const issues: PhaseIssue[] = [];

  const timeline: TimelinePoint[] = [];
  const pushMoment = (name: string, m: SwingPhaseMoment | null) => {
    if (m) timeline.push({ name, start: m.timestampSeconds, end: m.timestampSeconds });
  };
  pushMoment("address", segments.address);
  pushMoment("backswing", segments.backswing);
  pushMoment("top", segments.top);
  pushMoment("downswing", segments.downswing);
  if (segments.impact) {
    timeline.push({ name: "impact", start: segments.impact.windowStartSeconds, end: segments.impact.windowEndSeconds });
  }
  pushMoment("follow_through", segments.followThrough);

  if (options.impactWindowIncomplete) issues.push({ code: "impact_window_incomplete", phases: ["impact"] });

  // Non-finite values make every comparison meaningless; report and exclude.
  const finite = timeline.filter((p) => {
    const ok = Number.isFinite(p.start) && Number.isFinite(p.end);
    if (!ok) issues.push({ code: "non_finite_timestamp", phases: [p.name] });
    return ok;
  });

  if (segments.impact && finite.some((p) => p.name === "impact")) {
    const width = segments.impact.windowEndSeconds - segments.impact.windowStartSeconds;
    if (width < 0) issues.push({ code: "impact_window_inverted", phases: ["impact"] });
    else if (width > PO_MAX_IMPACT_WINDOW_SECONDS) issues.push({ code: "impact_window_too_wide", phases: ["impact"] });
  }

  if (range) {
    const lo = range.startSeconds - PO_RANGE_TOLERANCE_SECONDS;
    const hi = range.endSeconds + PO_RANGE_TOLERANCE_SECONDS;
    for (const p of finite) {
      if (Math.min(p.start, p.end) < lo || Math.max(p.start, p.end) > hi) {
        issues.push({ code: "outside_analyzed_range", phases: [p.name] });
      }
    }
  }

  // Strict order between consecutive present phases: each phase must end
  // before the next one starts. Missing phases are skipped, not inferred.
  for (let i = 1; i < finite.length; i++) {
    const prev = finite[i - 1];
    const cur = finite[i];
    if (!(prev.end < cur.start)) issues.push({ code: "out_of_order", phases: [prev.name, cur.name] });
  }

  const top = finite.find((p) => p.name === "top");
  const impact = finite.find((p) => p.name === "impact");
  if (top && impact && impact.start - top.end > PO_MAX_TOP_TO_IMPACT_SECONDS) {
    issues.push({ code: "top_to_impact_too_long", phases: ["top", "impact"] });
  }

  const phasesPresent = timeline.length;
  if (finite.length < 2 && issues.length === 0) {
    return {
      moduleVersion: PHASE_ORDER_VERSION,
      status: "inconclusive",
      inconclusiveReason: "fewer_than_two_phases",
      issues,
      phasesPresent,
    };
  }

  return {
    moduleVersion: PHASE_ORDER_VERSION,
    status: issues.length === 0 ? "consistent" : "inconsistent",
    inconclusiveReason: null,
    issues,
    phasesPresent,
  };
}

/** Convenience: first-to-last pose frame time, or null for an empty list. */
export function analyzedRangeOf(frames: readonly { timestampSeconds: number }[]): AnalyzedRange | null {
  if (frames.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of frames) {
    if (f.timestampSeconds < lo) lo = f.timestampSeconds;
    if (f.timestampSeconds > hi) hi = f.timestampSeconds;
  }
  return { startSeconds: lo, endSeconds: hi };
}

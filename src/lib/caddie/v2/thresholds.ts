// Single registry for every Caddie V2 threshold.
//
// Each threshold says whether it is a PLACEHOLDER (a guess from geometry,
// from V1 code, or from engineering judgement) or COACH_VALIDATED (tuned and
// checked on the consented, coach-labeled evaluation set, docs/caddie-v2/
// EVAL_REPORT_TEMPLATE.md). Modules read their values from here, so one file
// shows at a glance how much of V2 is still unproven.
//
// Rules (enforced by thresholds.test.ts via validateThresholdRegistry):
// - a threshold may be marked "coach_validated" ONLY with an evidence
//   reference: a filled-in eval report under docs/caddie-v2/eval-reports/,
//   the dataset version it was measured on, the sample size, and the
//   pseudonymous IDs of the coach labelers;
// - a placeholder carries no evidence (it has none);
// - changing a value means updating `date` and `source`; changing a
//   validated value sends it back to "placeholder" until re-validated.
//
// As of 2026-10-20 EVERY threshold below is a placeholder. No accuracy is
// claimed for any of them.

export type ThresholdStatus = "placeholder" | "coach_validated";

export interface ThresholdEvidence {
  /** Repo-relative path to the filled-in eval report, e.g. docs/caddie-v2/eval-reports/2027-01-eval-01.md. */
  evalReport: string;
  /** Dataset version from the local eval manifest the report was computed on. */
  datasetVersion: string;
  /** Clips the threshold was evaluated on. */
  sampleSize: number;
  /** Pseudonymous coach labeler IDs (e.g. "K01"). Never names or emails. */
  coachIds: string[];
}

export interface ThresholdEntry {
  /** Module that reads this threshold. */
  module: "qualityGate" | "cameraAngle" | "phaseOrder";
  value: number;
  unit: string;
  description: string;
  status: ThresholdStatus;
  /** Where the value came from (V1 code, geometry, a report section, ...). */
  source: string;
  /** ISO date (YYYY-MM-DD) the value or status last changed. */
  date: string;
  /** Required when status is "coach_validated"; null for placeholders. */
  evidence: ThresholdEvidence | null;
}

const PHASE1_DATE = "2026-10-20";

function placeholder(
  module: ThresholdEntry["module"],
  value: number,
  unit: string,
  description: string,
  source: string,
): ThresholdEntry {
  return { module, value, unit, description, status: "placeholder", source, date: PHASE1_DATE, evidence: null };
}

const GEOMETRY_GUESS = "Rough 2-D geometry estimate, not fitted to labeled clips";
const ENGINEERING_GUESS = "Engineering judgement, not fitted to labeled clips";

export const CADDIE_V2_THRESHOLDS = {
  // --- qualityGate.ts ------------------------------------------------------
  QG_MIN_KEYPOINT_CONFIDENCE: placeholder(
    "qualityGate",
    0.5,
    "confidence (0-1)",
    "A keypoint below this confidence is treated as not observed.",
    "Copied from V1 src/lib/swingAssessment.ts MIN_KEYPOINT_CONFIDENCE; never validated in V1 either",
  ),
  QG_MIN_PERSON_CONFIDENCE: placeholder(
    "qualityGate",
    0.5,
    "confidence (0-1)",
    "If the backend reports a person score, frames below it are rejected.",
    ENGINEERING_GUESS,
  ),
  QG_MIN_CONFIDENT_KEYPOINTS: placeholder(
    "qualityGate",
    8,
    "keypoints (of 13)",
    "Minimum confident keypoints for a frame to be usable.",
    ENGINEERING_GUESS,
  ),
  QG_MIN_CONFIDENT_TORSO_KEYPOINTS: placeholder(
    "qualityGate",
    3,
    "keypoints (of 4)",
    "Minimum confident torso points (both shoulders + both hips).",
    ENGINEERING_GUESS,
  ),
  QG_MIN_USABLE_FRAMES: placeholder(
    "qualityGate",
    8,
    "frames",
    "Minimum usable frames for the whole sequence.",
    ENGINEERING_GUESS,
  ),
  QG_MIN_USABLE_FRAME_RATIO: placeholder(
    "qualityGate",
    0.5,
    "ratio (0-1)",
    "Minimum share of requested frames that must be usable.",
    "Mirrors V1 analyze-swing's 50 % Roboflow-success rule, applied to usable frames instead",
  ),

  // --- cameraAngle.ts ------------------------------------------------------
  CA_FACE_ON_MIN_SHOULDER_RATIO: placeholder(
    "cameraAngle",
    0.55,
    "shoulder span / torso length",
    "At or above this votes face-on (with the hip condition).",
    GEOMETRY_GUESS,
  ),
  CA_FACE_ON_MIN_HIP_RATIO: placeholder(
    "cameraAngle",
    0.35,
    "hip span / torso length",
    "At or above this is required for a face-on vote.",
    GEOMETRY_GUESS,
  ),
  CA_DTL_MAX_SHOULDER_RATIO: placeholder(
    "cameraAngle",
    0.3,
    "shoulder span / torso length",
    "At or below this votes down-the-line (with the hip condition).",
    GEOMETRY_GUESS,
  ),
  CA_DTL_MAX_HIP_RATIO: placeholder(
    "cameraAngle",
    0.2,
    "hip span / torso length",
    "At or below this is required for a down-the-line vote.",
    GEOMETRY_GUESS,
  ),
  CA_MAX_TORSO_TILT_DEGREES: placeholder(
    "cameraAngle",
    60,
    "degrees from vertical",
    "Frames whose torso tilts more than this are skipped (lying down, rotated video).",
    GEOMETRY_GUESS,
  ),
  CA_DEFAULT_ADDRESS_FRAMES: placeholder(
    "cameraAngle",
    5,
    "frames",
    "Without an address hint, this many earliest usable frames are used.",
    ENGINEERING_GUESS,
  ),
  CA_ADDRESS_WINDOW_SECONDS: placeholder(
    "cameraAngle",
    0.25,
    "seconds",
    "With an address hint, usable frames within this many seconds of it are used.",
    ENGINEERING_GUESS,
  ),
  CA_MIN_MEASURED_FRAMES: placeholder(
    "cameraAngle",
    3,
    "frames",
    "Minimum frames that must yield a measurement.",
    ENGINEERING_GUESS,
  ),
  CA_MIN_AGREEMENT: placeholder(
    "cameraAngle",
    0.67,
    "ratio (0-1)",
    "Minimum share of measured frames that must agree on the winning angle.",
    ENGINEERING_GUESS,
  ),

  // --- phaseOrder.ts -------------------------------------------------------
  PO_RANGE_TOLERANCE_SECONDS: placeholder(
    "phaseOrder",
    0.125,
    "seconds",
    "Slack allowed outside the first/last pose frame time.",
    "One sample at V1's 8 fps extraction rate",
  ),
  PO_MAX_TOP_TO_IMPACT_SECONDS: placeholder(
    "phaseOrder",
    1.0,
    "seconds",
    "Longest plausible gap from top of backswing to the start of the impact window.",
    ENGINEERING_GUESS,
  ),
  PO_MAX_IMPACT_WINDOW_SECONDS: placeholder(
    "phaseOrder",
    0.3,
    "seconds",
    "Impact windows wider than this are flagged as too imprecise to anchor on.",
    "Copied from V1 src/lib/swingAssessment.ts MAX_IMPACT_WINDOW_SECONDS; never validated in V1 either",
  ),
} satisfies Record<string, ThresholdEntry>;

export type ThresholdId = keyof typeof CADDIE_V2_THRESHOLDS;

/** The numeric value of a registered threshold. */
export function thresholdValue(id: ThresholdId): number {
  return CADDIE_V2_THRESHOLDS[id].value;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EVAL_REPORT_PATH = /^docs\/caddie-v2\/eval-reports\/[A-Za-z0-9._-]+\.md$/;
const COACH_ID = /^K\d{2,3}$/;

/**
 * Returns a list of rule violations (empty when the registry is sound).
 * Pure, so tests can also feed it deliberately broken registries.
 */
export function validateThresholdRegistry(registry: Readonly<Record<string, ThresholdEntry>>): string[] {
  const problems: string[] = [];
  for (const [id, t] of Object.entries(registry)) {
    if (!Number.isFinite(t.value)) problems.push(`${id}: value is not a finite number`);
    if (!t.source.trim()) problems.push(`${id}: missing source`);
    if (!ISO_DATE.test(t.date) || Number.isNaN(Date.parse(t.date))) problems.push(`${id}: date is not YYYY-MM-DD`);

    if (t.status === "placeholder") {
      if (t.evidence !== null) problems.push(`${id}: placeholder must not carry evidence`);
      continue;
    }
    if (t.status !== "coach_validated") {
      problems.push(`${id}: unknown status`);
      continue;
    }
    const e = t.evidence;
    if (!e) {
      problems.push(`${id}: coach_validated without an evidence reference`);
      continue;
    }
    if (!EVAL_REPORT_PATH.test(e.evalReport)) problems.push(`${id}: evidence.evalReport must be docs/caddie-v2/eval-reports/<name>.md`);
    if (!e.datasetVersion.trim()) problems.push(`${id}: evidence.datasetVersion missing`);
    if (!Number.isInteger(e.sampleSize) || e.sampleSize <= 0) problems.push(`${id}: evidence.sampleSize must be a positive integer`);
    if (e.coachIds.length === 0) problems.push(`${id}: evidence.coachIds must name at least one coach`);
    for (const c of e.coachIds) {
      if (!COACH_ID.test(c)) problems.push(`${id}: coach ID "${c}" is not pseudonymous (expected K01-style)`);
    }
  }
  return problems;
}

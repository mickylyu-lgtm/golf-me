// Caddie V2 shared contract (see docs/caddie-v2/CADDIE_V2_AUDIT.md §7).
//
// NOT WIRED INTO THE APP OR ANY EDGE FUNCTION YET. Nothing in src/ or
// supabase/functions imports this directory; it exists so the V2 modules can
// be built and unit-tested against fixed types before shadow mode.
//
// Portability rules for every file in src/lib/caddie/v2/ (they are meant to
// be importable later by both Vite and the Supabase Edge (Deno) bundler):
//   - no imports from outside this directory (no React, no Vite env, no
//     supabase client, no src/types);
//   - relative imports carry an explicit `.ts` extension (Deno requires it,
//     tsconfig allows it);
//   - erasable TypeScript only (no enums, no namespaces, no parameter
//     properties) and no DOM or Node APIs.

/** Bump when PoseSequence's shape changes incompatibly. */
export const POSE_SEQUENCE_VERSION = 1 as const;

/**
 * The 13 COCO-style body landmarks the current production Roboflow model
 * tracks (scripts/extract-golf-training-frames/ANNOTATION_GUIDE.md). Left and
 * right are the GOLFER's anatomical sides, not screen sides. No club, ball,
 * or hand/finger points exist in this set.
 */
export const POSE_KEYPOINT_NAMES = [
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
] as const;

export type PoseKeypointName = (typeof POSE_KEYPOINT_NAMES)[number];

const KEYPOINT_NAME_SET: ReadonlySet<string> = new Set(POSE_KEYPOINT_NAMES);

export function isPoseKeypointName(name: string): name is PoseKeypointName {
  return KEYPOINT_NAME_SET.has(name);
}

/** Which pose model produced a sequence. Measurements and thresholds must be calibrated per backend. */
export type PoseBackend = "roboflow_v1_workflow" | "apple_vision" | "browser_model" | "synthetic";

/**
 * Coordinate space of keypoint x/y.
 * - source_pixels: pixels of the analyzed frame, origin top-left, y grows
 *   downward. V1 Roboflow data is in this space, but the frame size was never
 *   stored, so sourceWidth/sourceHeight are null for it.
 * - normalized: 0..1 of frame width/height, origin top-left, y grows downward.
 * Every V2 module must work from scale-free ratios so it is correct in both.
 */
export type PoseCoordinateSpace = "source_pixels" | "normalized";

export interface PoseKeypoint {
  x: number;
  y: number;
  /** 0..1 as reported by the backend. NOT calibrated across backends. */
  confidence: number;
}

export interface PoseFrame {
  frameIndex: number;
  timestampSeconds: number;
  /** Backend's "a person is here" score, or null if the backend didn't give one. */
  personConfidence: number | null;
  /** A missing keypoint means "not observed reliably", never "at 0,0". */
  keypoints: Partial<Record<PoseKeypointName, PoseKeypoint>>;
}

export interface PoseSequence {
  version: typeof POSE_SEQUENCE_VERSION;
  backend: PoseBackend;
  /** Model/workflow version inside the backend. Null when unknown (true for V1 Roboflow). */
  backendVersion: string | null;
  coordinateSpace: PoseCoordinateSpace;
  sourceWidth: number | null;
  sourceHeight: number | null;
  /** Nominal sampling rate, or null if unknown. Frames may still be unevenly spaced. */
  analysisFps: number | null;
  /**
   * How many frames the backend was asked to process, or null if unknown.
   * Can exceed frames.length when the producer dropped failed frames before
   * storing (V1 does), so quality ratios must not use frames.length alone.
   */
  framesRequested: number | null;
  /** Sorted by timestampSeconds ascending. */
  frames: PoseFrame[];
}

/** The four swing anchors V2 coaches against, plus V1's two in-between phases. */
export type SwingPhaseName = "address" | "backswing" | "top" | "downswing" | "impact" | "follow_through";

export type PhaseConfidenceLabel = "high" | "medium" | "low";

export interface SwingPhaseMoment {
  timestampSeconds: number;
  confidence: PhaseConfidenceLabel | null;
}

/**
 * Normalized phase timeline. Every field is null when that phase was not
 * identified. Impact is always a window, never an instant (pose-only data
 * can't pin contact).
 */
export interface SwingSegments {
  address: SwingPhaseMoment | null;
  backswing: SwingPhaseMoment | null;
  top: SwingPhaseMoment | null;
  downswing: SwingPhaseMoment | null;
  impact: { windowStartSeconds: number; windowEndSeconds: number; confidence: PhaseConfidenceLabel | null } | null;
  followThrough: SwingPhaseMoment | null;
}

/**
 * One deterministic body measurement (no producer exists yet; reserved for
 * the Milestone 1 measurement module so coaching claims can cite an id).
 */
export interface Measurement {
  id: string;
  moduleVersion: string;
  value: number | null;
  unit: "degrees" | "ratio";
  /** Heuristic 0..1, NOT a calibrated probability. */
  confidence: number;
  frameIndices: number[];
  inconclusiveReason: string | null;
}

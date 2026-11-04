// Measured-verdict check on Gemini's checkpoint cues (Caddie, plan item E).
// Pure helpers, no Deno/Supabase imports: analyze-swing runs the check
// before saving, the client (RealCaddieContext) reads stored JSON with the
// same parsers, and node --test (tests/caddieVerdicts.test.ts) covers both.
//
// Why: analyze-swing's single Gemini call writes checkpoint_cues in the
// same response that places the phases, and the measured verdicts
// (swingAssessment.ts) need those phases, so Gemini can't be shown the
// verdicts it would have to agree with. Instead, once it returns, the
// server measures exactly what the client will (same pose frames, same
// phases, same camera angle, same reliability gates) and drops a cue that
// clearly coaches a different body part than a measured fault at that
// moment. A dropped cue stores nothing; Coach Replay already shows the
// measured fault's own fixed cue there (pickCue in src/lib/coachReplay.ts).
// Gemini's text is never rewritten.

import { computeSwingAssessment } from "./swingAssessment.ts";
import type { CaddieCameraAngle, CaddieConfidence, CaddiePhaseMoment, CaddiePoseData, CaddieSwingPhases, SwingAnchorPhase, SwingAssessment, SwingSegmentId } from "./swingAssessment.ts";
import type { CheckpointCues, CueCheckpoint } from "./caddieCues.ts";

// ── Stored JSON -> the shapes swingAssessment reads ─────────────────────
// One parser for both sides, so the server's verdicts can't drift from the
// ones the client draws.

// roboflow_analysis_json (what analyze-swing stores as trustedPoseData).
export function poseDataFromJson(raw: unknown): CaddiePoseData | undefined {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).frames)) return undefined;
  const json = raw as Record<string, unknown>;
  const video = (json.video as Record<string, unknown>) ?? {};
  return {
    analysisFps: typeof video.analysis_fps === "number" ? video.analysis_fps : 8,
    frames: (json.frames as Record<string, unknown>[]).map((f) => {
      const rawKeypoints = (f?.keypoints as Record<string, Record<string, unknown>>) ?? {};
      const keypoints: CaddiePoseData["frames"][number]["keypoints"] = {};
      for (const [name, kp] of Object.entries(rawKeypoints)) {
        if (kp && typeof kp.x === "number" && typeof kp.y === "number") {
          keypoints[name] = { x: kp.x, y: kp.y, confidence: typeof kp.confidence === "number" ? kp.confidence : 0 };
        }
      }
      return {
        frameIndex: typeof f?.frame_index === "number" ? f.frame_index : 0,
        timestampSeconds: typeof f?.timestamp_seconds === "number" ? f.timestamp_seconds : 0,
        personConfidence: typeof f?.person_confidence === "number" ? f.person_confidence : null,
        keypoints,
      };
    }),
  };
}

function phaseMomentFromJson(raw: Record<string, unknown> | undefined): CaddiePhaseMoment {
  return {
    timestampSeconds: typeof raw?.timestamp_seconds === "number" ? raw.timestamp_seconds : null,
    confidence: (raw?.confidence as CaddieConfidence | undefined) ?? null,
  };
}

// analysis_json.phases (Gemini's snake_case shape).
export function phasesFromJson(raw: unknown): CaddieSwingPhases | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const phases = raw as Record<string, Record<string, unknown>>;
  const impact = phases.impact ?? {};
  return {
    address: phaseMomentFromJson(phases.address),
    backswing: phaseMomentFromJson(phases.backswing),
    top: phaseMomentFromJson(phases.top),
    downswing: phaseMomentFromJson(phases.downswing),
    impact: {
      windowStartSeconds: typeof impact.window_start_seconds === "number" ? impact.window_start_seconds : null,
      windowEndSeconds: typeof impact.window_end_seconds === "number" ? impact.window_end_seconds : null,
      confidence: (impact.confidence as CaddieConfidence | undefined) ?? null,
    },
    followThrough: phaseMomentFromJson(phases.follow_through),
  };
}

// The client reads analysis_json.camera_angle the same way (anything that
// isn't face_on/down_the_line skips the angle-specific checks).
export function cameraAngleFromJson(raw: unknown): CaddieCameraAngle {
  return typeof raw === "string" ? (raw as CaddieCameraAngle) : "uncertain";
}

// The verdicts Coach Replay will show for this analysis, from the stored
// JSON. Same call and options as CaddieSwingReplay (no handedness).
export function measuredAssessment(analysisJson: Record<string, unknown>, poseJson: unknown): SwingAssessment | undefined {
  return computeSwingAssessment(poseDataFromJson(poseJson), phasesFromJson(analysisJson.phases), { cameraAngle: cameraAngleFromJson(analysisJson.camera_angle) });
}

// Measured faults by the moment they were measured at. swingAssessment
// already leaves anything it can't measure reliably as "unknown", and
// those never count here.
export function measuredFaultsByPhase(assessment: SwingAssessment | undefined): Partial<Record<SwingAnchorPhase, SwingSegmentId[]>> {
  const out: Partial<Record<SwingAnchorPhase, SwingSegmentId[]>> = {};
  for (const seg of assessment?.segments ?? []) {
    if (seg.status !== "needs_improvement") continue;
    (out[seg.anchorPhase] ??= []).push(seg.segment);
  }
  return out;
}

// ── Which body part a cue talks about ───────────────────────────────────
// Deliberately coarse groups and short keyword lists in the six app
// languages. All lists apply to every cue (Gemini doesn't always answer in
// the requested language), and a cue can match several groups; more
// matches only ever means keeping a cue, never dropping one.
export type CueBodyPart = "arms" | "hands" | "torso" | "hips" | "shoulders" | "legs" | "head";

// Latin-script words, matched whole (no letter on either side).
const LATIN_WORDS: Record<CueBodyPart, string[]> = {
  arms: ["arm", "arms", "forearm", "forearms", "elbow", "elbows", "brazo", "brazos", "antebrazo", "antebrazos", "codo", "codos"],
  hands: ["hand", "hands", "wrist", "wrists", "mano", "manos", "muñeca", "muñecas"],
  torso: ["spine", "spinal", "posture", "torso", "chest", "trunk", "upper body", "columna", "postura", "tronco", "pecho"],
  hips: ["hip", "hips", "pelvis", "sway", "swaying", "cadera", "caderas"],
  shoulders: ["shoulder", "shoulders", "hombro", "hombros"],
  legs: ["knee", "knees", "leg", "legs", "rodilla", "rodillas", "pierna", "piernas"],
  head: ["head", "chin", "cabeza", "barbilla"],
};

// Japanese, Korean and Chinese (both scripts): substrings. Kept to
// unambiguous words; e.g. 足 is left out (Japanese 不足 "not enough"), and
// Korean 팔 must not be the start of 팔로우 ("follow-through").
const CJK_PATTERNS: Record<CueBodyPart, RegExp> = {
  arms: /腕|肘|ひじ|うで|手臂|臂|胳膊|팔(?!로)/u,
  hands: /手首|手元|両手|ハンド|手腕|双手|雙手|手部|손목|양손|손을|손이|손의|손은|핸드/u,
  torso: /背骨|背中|前傾|前倾|姿勢|姿势|上体|上半身|体幹|胸|脊柱|脊椎|上身|躯干|軀幹|背部|척추|자세|상체|가슴|몸통/u,
  hips: /腰|骨盤|骨盆|ヒップ|スウェー|髋|髖|臀|胯|侧移|側移|골반|엉덩이|힙|허리|스웨이/u,
  shoulders: /肩|어깨/u,
  legs: /膝|ひざ|ヒザ|脚|下半身|腿|무릎|다리|하체/u,
  head: /頭|头|顔|目線|视线|視線|あご|下巴|머리|시선|턱/u,
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LATIN_PATTERNS = Object.fromEntries(
  Object.entries(LATIN_WORDS).map(([part, words]) => [part, new RegExp(`(?<!\\p{L})(?:${words.map(escapeRegExp).join("|")})(?!\\p{L})`, "iu")]),
) as Record<CueBodyPart, RegExp>;

const BODY_PARTS = Object.keys(LATIN_WORDS) as CueBodyPart[];

export function cueBodyParts(text: string): Set<CueBodyPart> {
  const parts = new Set<CueBodyPart>();
  const s = text.normalize("NFC");
  for (const part of BODY_PARTS) {
    if (LATIN_PATTERNS[part].test(s) || CJK_PATTERNS[part].test(s)) parts.add(part);
  }
  return parts;
}

// Body parts a cue may name and still be about that measured fault.
// Generous on purpose (e.g. "push your hands away" can fix a bent lead
// arm, "post up on your lead leg" can fix hip sway): the rule only drops a
// cue that is clearly about something else.
export const FAULT_BODY_PARTS: Record<SwingSegmentId, readonly CueBodyPart[]> = {
  torso: ["torso", "hips", "shoulders"],
  left_arm: ["arms", "hands"],
  right_arm: ["arms", "hands"],
  wrists: ["hands", "arms"],
  hip_sway: ["hips", "legs"],
  shoulder_line: ["shoulders", "hips", "torso"],
  knees: ["legs", "hips"],
};

// True only when the cue names at least one body part and none of them
// fits any measured fault at that moment. A cue naming no body part
// ("stay smooth"), or with no measured fault to check against, is kept.
export function cueContradictsFaults(cue: string, faults: readonly SwingSegmentId[]): boolean {
  if (faults.length === 0) return false;
  const parts = cueBodyParts(cue);
  if (parts.size === 0) return false;
  const allowed = new Set<CueBodyPart>(faults.flatMap((f) => FAULT_BODY_PARTS[f]));
  for (const p of parts) if (allowed.has(p)) return false;
  return true;
}

// Moments a measured verdict is anchored to; follow_through has none, so
// its cue is never checked.
const MEASURED_CUE_CHECKPOINTS: readonly CueCheckpoint[] = ["address", "top", "impact"];

// Removes each cue that contradicts a measured fault at its moment (see
// cueContradictsFaults); the field is removed entirely if none is left.
// Run AFTER withSanitizedCheckpointCues. Never throws: on any unexpected
// input the JSON comes back unchanged.
export function withMeasuredCueCheck<T extends Record<string, unknown>>(json: T, poseJson: unknown): { json: T; dropped: CueCheckpoint[] } {
  try {
    const cues = json.checkpoint_cues as CheckpointCues | undefined;
    if (!cues || typeof cues !== "object") return { json, dropped: [] };
    const faults = measuredFaultsByPhase(measuredAssessment(json, poseJson));
    const dropped: CueCheckpoint[] = [];
    const kept: CheckpointCues = {};
    for (const [key, cue] of Object.entries(cues) as [CueCheckpoint, string][]) {
      const atMoment = (MEASURED_CUE_CHECKPOINTS as readonly string[]).includes(key) ? (faults[key as SwingAnchorPhase] ?? []) : [];
      if (typeof cue === "string" && cueContradictsFaults(cue, atMoment)) dropped.push(key);
      else kept[key] = cue;
    }
    if (dropped.length === 0) return { json, dropped };
    const out: Record<string, unknown> = { ...json };
    if (Object.keys(kept).length > 0) out.checkpoint_cues = kept;
    else delete out.checkpoint_cues;
    return { json: out as T, dropped };
  } catch {
    return { json, dropped: [] };
  }
}

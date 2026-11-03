import type {
  CaddieCheckpointCues,
  CaddieConfidence,
  CaddieDrill,
  CaddieFocus,
  CaddieScore,
  CaddieScoreCriterionKey,
  CaddieSwingPhases,
  CaddieWorkOnCheckpoint,
  CaddieWorkOnItem,
} from "../types";
import type { TranslationKey } from "../i18n/locales/en";
import type { SwingAssessment, SwingSegmentId } from "./swingAssessment";
import { isTrustedPhaseConfidence, trustedPhaseTimeSeconds } from "./swingAssessment.ts";
import { sanitizeCheckpointCues } from "../../supabase/functions/_shared/caddieCues.ts";

// Caddie V3 "Coach Replay": the slow-motion replay freezes at up to four key
// moments and shows a card (what's going well, the one thing to fix, a short
// cue), then carries on. This module decides WHERE to freeze and WHAT each
// card says; it never touches a video or the DOM, so the same plan drives
// the real <video> replay and the demo golfer.
//
// The source is pluggable. A source contributes two lists:
//   - moments: where each checkpoint sits on the clip, and how sure it is;
//   - findings: claims about the swing, each tied to one checkpoint.
// buildCoachPlan() merges them the same way whatever the source. Today V1
// analyses (Gemini phases + score, plus swingAssessment's pose geometry) feed
// it; V2's keyFrames already map onto moments (v2Moments), and V2's
// measurements will feed findings once its thresholds are coach-validated.
//
// Honesty rules, enforced here rather than in the UI:
//   - A checkpoint the data can't place reliably is skipped, never guessed.
//     Moments must also run in swing order; one out of order is dropped.
//   - A checkpoint with nothing to say is skipped too (no empty freeze).
//   - Every claim carries a `source` naming the stored field it came from,
//     and its text is either a fixed translation keyed off a measured
//     verdict or the analysis's own stored sentence, verbatim.
//   - "Nothing to fix" is never asserted: the card says nothing was FLAGGED.
//   - Every plan with a usable analysis ends on what to work on: the main
//     focus sits on the weakest-scoring checkpoint (when one is below the
//     "good" band), and a closing summary card carries the top work_on
//     items and the drill (see v1Summary).

export type CoachCheckpointId = "address" | "top" | "impact" | "finish";
export const COACH_CHECKPOINT_ORDER: readonly CoachCheckpointId[] = ["address", "top", "impact", "finish"];

// What the freeze frame actually is. V1 has no "finish" phase, only
// follow_through, so its fourth checkpoint is labelled as such rather than
// renamed into a moment the data never identified.
export type CoachMomentLabel = "address" | "top" | "impact" | "follow_through" | "finish";

export interface CoachMoment {
  id: CoachCheckpointId;
  timeSeconds: number;
  label: CoachMomentLabel;
  // The freeze frame is a best estimate, not an identified instant: impact
  // (a window, frozen at its midpoint) or a medium-confidence phase.
  approximate: boolean;
  source: string;
}

export type CoachText = { kind: "key"; key: TranslationKey } | { kind: "stored"; text: string };

export interface CoachClaim {
  title?: CoachText;
  body: CoachText;
  // Where the claim came from, e.g. "assessment.left_arm" or
  // "details.score.backswing.reason". Kept for tests and debugging; also
  // the hook a later "why?" affordance can use.
  source: string;
}

export interface CoachFinding {
  checkpoint: CoachCheckpointId;
  kind: "good" | "fix";
  claim: CoachClaim;
  cue?: CoachClaim;
  // Lower wins when a checkpoint has several findings of one kind.
  rank: number;
}

export interface CoachCheckpoint extends CoachMoment {
  good?: CoachClaim;
  fix?: CoachClaim;
  cue?: CoachClaim;
}

export type CoachPlanSource = "v1" | "v2" | "demo";

// The closing card, shown once the coached pass reaches the end of the
// clip. Every line is the analysis's own stored text (or, for the demo, its
// fixed copy); labels are fixed translation keys in the card.
export interface CoachSummary {
  // The main focus, only when it isn't already the fix on a shown checkpoint.
  focus?: CoachClaim;
  workOn: CoachClaim[];
  drill?: { name: CoachText; steps: CoachText[]; source: string };
}

export interface CoachReplayPlan {
  source: CoachPlanSource;
  checkpoints: CoachCheckpoint[];
  summary?: CoachSummary;
}

// A cue the analysis wrote for one checkpoint (V1: analysis_json.
// checkpoint_cues). It never creates a freeze on its own: a checkpoint still
// needs a good/fix finding to be shown.
export type CoachCues = Partial<Record<CoachCheckpointId, CoachClaim>>;

export function buildCoachPlan(source: CoachPlanSource, moments: CoachMoment[], findings: CoachFinding[], cues?: CoachCues): CoachReplayPlan {
  const byId = new Map<CoachCheckpointId, CoachMoment>();
  for (const m of moments) if (!byId.has(m.id) && Number.isFinite(m.timeSeconds) && m.timeSeconds >= 0) byId.set(m.id, m);

  const checkpoints: CoachCheckpoint[] = [];
  let lastTime = -Infinity;
  for (const id of COACH_CHECKPOINT_ORDER) {
    const moment = byId.get(id);
    // Out of swing order means at least one phase time is wrong, and we
    // can't tell which: drop the later one rather than freeze on it.
    // (Checked against every placed moment, even ones with nothing to say.)
    if (!moment || moment.timeSeconds <= lastTime) continue;
    lastTime = moment.timeSeconds;
    const pick = (kind: CoachFinding["kind"]) =>
      findings.filter((f) => f.checkpoint === id && f.kind === kind).sort((a, b) => a.rank - b.rank)[0];
    const good = pick("good");
    const fix = pick("fix");
    if (!good && !fix) continue;
    // The analysis's own cue for this moment first; the fixed per-fault
    // cue is the fallback (old rows, or no usable cue for this moment).
    checkpoints.push({ ...moment, good: good?.claim, fix: fix?.claim, cue: cues?.[id] ?? fix?.cue ?? good?.cue });
  }
  return { source, checkpoints };
}

// ── V1: Gemini phases + score, swingAssessment's pose geometry ──────────

export function v1Moments(phases: CaddieSwingPhases | undefined): CoachMoment[] {
  if (!phases) return [];
  const moments: CoachMoment[] = [];
  const medium = (c: CaddieConfidence | null) => c === "medium";
  // Same trust rule as the Swing Check colours (swingAssessment.ts): high/
  // medium confidence only, impact only from a window narrow enough to
  // freeze on. A phase that fails it has no checkpoint at all.
  const addressT = trustedPhaseTimeSeconds(phases, "address");
  if (addressT !== null) {
    moments.push({ id: "address", timeSeconds: addressT, label: "address", approximate: medium(phases.address.confidence), source: "details.phases.address" });
  }
  const topT = trustedPhaseTimeSeconds(phases, "top");
  if (topT !== null) moments.push({ id: "top", timeSeconds: topT, label: "top", approximate: medium(phases.top.confidence), source: "details.phases.top" });
  const impactT = trustedPhaseTimeSeconds(phases, "impact");
  // Always approximate: analyze-swing reports impact as a window on purpose
  // (no club/ball tracking), and the midpoint is not a contact frame.
  if (impactT !== null) moments.push({ id: "impact", timeSeconds: impactT, label: "impact", approximate: true, source: "details.phases.impact" });
  const ft = phases.followThrough;
  if (ft.timestampSeconds !== null && isTrustedPhaseConfidence(ft.confidence)) {
    moments.push({ id: "finish", timeSeconds: ft.timestampSeconds, label: "follow_through", approximate: medium(ft.confidence), source: "details.phases.followThrough" });
  }
  return moments;
}

const SEGMENT_LABEL_KEYS: Record<SwingSegmentId, TranslationKey> = {
  torso: "swingAssessment.segment.torso",
  left_arm: "swingAssessment.segment.leftArm",
  right_arm: "swingAssessment.segment.rightArm",
  hip_sway: "swingAssessment.segment.hipSway",
  shoulder_line: "swingAssessment.segment.shoulderLine",
  knees: "swingAssessment.segment.knees",
  wrists: "swingAssessment.segment.wrists",
};
const SEGMENT_DESCRIPTION_KEYS: Record<SwingSegmentId, Record<"good" | "needs_improvement", TranslationKey>> = {
  torso: { good: "swingAssessment.description.torsoGood", needs_improvement: "swingAssessment.description.torsoNeedsImprovement" },
  left_arm: { good: "swingAssessment.description.armGood", needs_improvement: "swingAssessment.description.armNeedsImprovement" },
  right_arm: { good: "swingAssessment.description.armGood", needs_improvement: "swingAssessment.description.armNeedsImprovement" },
  hip_sway: { good: "swingAssessment.description.hipSwayGood", needs_improvement: "swingAssessment.description.hipSwayNeedsImprovement" },
  shoulder_line: { good: "swingAssessment.description.shoulderLineGood", needs_improvement: "swingAssessment.description.shoulderLineNeedsImprovement" },
  knees: { good: "swingAssessment.description.kneesGood", needs_improvement: "swingAssessment.description.kneesNeedsImprovement" },
  wrists: { good: "swingAssessment.description.wristsGood", needs_improvement: "swingAssessment.description.wristsNeedsImprovement" },
};
// A few-word cue per measured fault. Generic coaching advice keyed off a
// measured "needs_improvement" verdict, not a claim about the golfer, so a
// fixed translation is honest here. It is the FALLBACK: when the analysis
// stored its own cue for that moment (analysis_json.checkpoint_cues, see
// v1Cues) that wins. Gemini-sourced fixes otherwise get no cue: we don't
// paraphrase its sentence into one.
const SEGMENT_CUE_KEYS: Record<SwingSegmentId, TranslationKey> = {
  torso: "coachReplay.cue.torso",
  left_arm: "coachReplay.cue.arm",
  right_arm: "coachReplay.cue.arm",
  hip_sway: "coachReplay.cue.hipSway",
  shoulder_line: "coachReplay.cue.shoulderLine",
  knees: "coachReplay.cue.knees",
  wrists: "coachReplay.cue.wrists",
};
// Same priority as the on-video callouts in CaddieSwingReplay.
const SEGMENT_RANK: SwingSegmentId[] = ["torso", "left_arm", "right_arm", "hip_sway", "shoulder_line", "knees", "wrists"];

// Which score criterion speaks for which checkpoint — each is defined in
// analyze-swing's prompt as being about that part of the swing.
// balance_and_weight_transfer spans the whole swing, so it has no moment.
const SCORE_CRITERION_FOR: Record<CoachCheckpointId, CaddieScoreCriterionKey> = {
  address: "setupAndPosture",
  top: "backswing",
  impact: "downswingSequencing",
  finish: "finish",
};
// Gemini writes one sentence per criterion, not a verdict, so its kind is
// read off the points against analyze-swing's own rubric: 80%+ is reserved
// for "genuinely sound ... no real flaw visible in that category", so its
// reason is a strength. 40% or less is a clear flaw. The middle band (which
// also holds the "sparse data, scored mid-range" case the prompt asks for)
// says nothing on a card.
export const SCORE_GOOD_MIN_POINTS = 16;
export const SCORE_FIX_MAX_POINTS = 8;
const SCORE_RANK = 100; // measured geometry first, Gemini's sentence second
// Then a work_on item Gemini itself tagged with this moment, then the main
// focus placed by score (the fallback for rows without tags).
const WORK_ON_RANK = 200;
const FOCUS_RANK = 300;

// The analysis's free-text coaching (details.workOn/focus/drill).
export interface V1Coaching {
  workOn?: CaddieWorkOnItem[];
  focus?: CaddieFocus;
  drill?: CaddieDrill;
}

// work_on[].checkpoint -> Coach Replay checkpoint. V1's fourth checkpoint is
// its follow-through (see v1Moments). whole_swing has no moment: such an
// item can only appear on the summary card.
const WORK_ON_CHECKPOINT_FOR: Partial<Record<CaddieWorkOnCheckpoint, CoachCheckpointId>> = {
  address: "address",
  top: "top",
  impact: "impact",
  follow_through: "finish",
};

const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const stored = (text: string): CoachText => ({ kind: "stored", text });
const isSure = (c: CaddieConfidence | undefined) => c === "high" || c === "medium";

// A work_on item as a claim: the issue as its title, why it matters as the
// body (or the issue alone when there's no why).
function workOnClaim(item: CaddieWorkOnItem, index: number): CoachClaim | undefined {
  const issue = trimmed(item.issue);
  if (!issue) return undefined;
  const why = trimmed(item.whyItMatters);
  const source = `details.workOn.${index}`;
  return why ? { title: stored(issue), body: stored(why), source } : { body: stored(issue), source };
}

function focusClaim(focus: CaddieFocus | undefined): CoachClaim | undefined {
  const title = trimmed(focus?.title);
  const instruction = trimmed(focus?.instruction);
  if (!title && !instruction) return undefined;
  return title && instruction ? { title: stored(title), body: stored(instruction), source: "details.focus" } : { body: stored(title || instruction), source: "details.focus" };
}

// The checkpoint whose criterion scored lowest, if any is below the "good"
// band. Ties go to the earlier checkpoint. balance_and_weight_transfer has
// no moment (see SCORE_CRITERION_FOR), so it never counts.
export function weakestCheckpoint(score: CaddieScore | undefined): CoachCheckpointId | undefined {
  if (!score) return undefined;
  let weakest: CoachCheckpointId | undefined;
  let lowest = SCORE_GOOD_MIN_POINTS;
  for (const id of COACH_CHECKPOINT_ORDER) {
    const points = score.criteria[SCORE_CRITERION_FOR[id]]?.points;
    if (typeof points !== "number" || !Number.isFinite(points)) continue;
    if (points < lowest) {
      lowest = points;
      weakest = id;
    }
  }
  return weakest;
}

export function v1Findings(assessment: SwingAssessment | undefined, score: CaddieScore | undefined, coaching?: V1Coaching): CoachFinding[] {
  const findings: CoachFinding[] = [];
  for (const seg of assessment?.segments ?? []) {
    if (seg.status === "unknown") continue;
    const kind = seg.status === "good" ? "good" : "fix";
    const source = `assessment.${seg.segment}`;
    findings.push({
      checkpoint: seg.anchorPhase,
      kind,
      rank: SEGMENT_RANK.indexOf(seg.segment),
      claim: { title: { kind: "key", key: SEGMENT_LABEL_KEYS[seg.segment] }, body: { kind: "key", key: SEGMENT_DESCRIPTION_KEYS[seg.segment][seg.status] }, source },
      cue: kind === "fix" ? { body: { kind: "key", key: SEGMENT_CUE_KEYS[seg.segment] }, source } : undefined,
    });
  }
  if (score) {
    for (const checkpoint of COACH_CHECKPOINT_ORDER) {
      const key = SCORE_CRITERION_FOR[checkpoint];
      const criterion = score.criteria[key];
      const reason = typeof criterion?.reason === "string" ? criterion.reason.trim() : "";
      if (!reason || typeof criterion.points !== "number") continue;
      const kind = criterion.points >= SCORE_GOOD_MIN_POINTS ? "good" : criterion.points <= SCORE_FIX_MAX_POINTS ? "fix" : undefined;
      if (!kind) continue;
      findings.push({ checkpoint, kind, rank: SCORE_RANK, claim: { body: { kind: "stored", text: reason }, source: `details.score.${key}.reason` } });
    }
  }
  // A work_on item Gemini tagged with a moment (high/medium confidence only)
  // is a fix there. Untagged, whole-swing and low-confidence items are left
  // for the summary card.
  (coaching?.workOn ?? []).forEach((item, i) => {
    const checkpoint = item.checkpoint ? WORK_ON_CHECKPOINT_FOR[item.checkpoint] : undefined;
    const claim = workOnClaim(item, i);
    if (!checkpoint || !claim || !isSure(item.confidence)) return;
    findings.push({ checkpoint, kind: "fix", rank: WORK_ON_RANK + i, claim });
  });
  // The main focus goes on the weakest-scoring checkpoint. The typical swing
  // scores 9-15 everywhere (the silent middle band above), so without this
  // most cards would only ever say what's going well.
  const weakest = weakestCheckpoint(score);
  const focus = focusClaim(coaching?.focus);
  if (weakest && focus) findings.push({ checkpoint: weakest, kind: "fix", rank: FOCUS_RANK, claim: focus });
  return findings;
}

// The closing card: the main focus when no shown checkpoint carries it,
// the top high/medium work_on items not already shown on a checkpoint, and
// the drill. At most two work lines, so the card reads in one glance.
// `shownFixSources` are the sources of the fixes the plan actually shows.
const SUMMARY_MAX_WORK_LINES = 2;
const SUMMARY_MAX_DRILL_STEPS = 3;

export function v1Summary(coaching: V1Coaching | undefined, shownFixSources: ReadonlySet<string>): CoachSummary | undefined {
  if (!coaching) return undefined;
  const focusCandidate = focusClaim(coaching.focus);
  const focus = focusCandidate && !shownFixSources.has(focusCandidate.source) ? focusCandidate : undefined;
  const workOn: CoachClaim[] = [];
  const room = SUMMARY_MAX_WORK_LINES - (focus ? 1 : 0);
  (coaching.workOn ?? []).forEach((item, i) => {
    if (workOn.length >= room || !isSure(item.confidence)) return;
    const claim = workOnClaim(item, i);
    if (claim && !shownFixSources.has(claim.source)) workOn.push(claim);
  });
  const name = trimmed(coaching.drill?.name);
  const steps = (coaching.drill?.steps ?? []).map(trimmed).filter(Boolean).slice(0, SUMMARY_MAX_DRILL_STEPS).map(stored);
  const drill = name ? { name: stored(name), steps, source: "details.drill" } : undefined;
  if (!focus && workOn.length === 0 && !drill) return undefined;
  return { focus, workOn, drill };
}

// analysis_json.checkpoint_cues (snake_case, as stored) -> details.
// Re-sanitized on read with the server's own rules: the row is the caller's
// own, but stored JSON is still treated as untrusted input.
export function checkpointCuesFromJson(raw: unknown): CaddieCheckpointCues | undefined {
  const cues = sanitizeCheckpointCues(raw);
  if (!cues) return undefined;
  const out: CaddieCheckpointCues = {};
  if (cues.address) out.address = cues.address;
  if (cues.top) out.top = cues.top;
  if (cues.impact) out.impact = cues.impact;
  if (cues.follow_through) out.followThrough = cues.follow_through;
  return out;
}

// V1's fourth checkpoint is its follow-through (see v1Moments), so that's
// the cue it takes.
const V1_CUE_FIELD: Record<CoachCheckpointId, keyof CaddieCheckpointCues> = {
  address: "address",
  top: "top",
  impact: "impact",
  finish: "followThrough",
};

export function v1Cues(checkpointCues: CaddieCheckpointCues | undefined): CoachCues {
  const cues: CoachCues = {};
  if (!checkpointCues) return cues;
  for (const id of COACH_CHECKPOINT_ORDER) {
    const field = V1_CUE_FIELD[id];
    const value = checkpointCues[field];
    const text = typeof value === "string" ? value.trim() : "";
    if (text) cues[id] = { body: { kind: "stored", text }, source: `details.checkpointCues.${field}` };
  }
  return cues;
}

export function coachPlanFromV1(input: {
  phases?: CaddieSwingPhases;
  assessment?: SwingAssessment;
  score?: CaddieScore;
  checkpointCues?: CaddieCheckpointCues;
  coaching?: V1Coaching;
}): CoachReplayPlan {
  const plan = buildCoachPlan("v1", v1Moments(input.phases), v1Findings(input.assessment, input.score, input.coaching), v1Cues(input.checkpointCues));
  const shown = new Set(plan.checkpoints.flatMap((c) => (c.fix ? [c.fix.source] : [])));
  const summary = v1Summary(input.coaching, shown);
  return summary ? { ...plan, summary } : plan;
}

// ── V2: local MediaPipe keyFrames (branch caddie-v2, not shipped) ───────
//
// Structural subset of V2's KeyFrameDetection, so main needn't import the
// V2 module to accept its output. V2 already names exactly these four
// moments; its finish is a real held finish unless held === false (the
// follow-through peak was used instead), labelled honestly either way.

export interface V2KeyFrameLike {
  status: "detected" | "inconclusive";
  timestampSeconds: number | null;
  confidenceLabel?: CaddieConfidence;
  held?: boolean;
}

export function v2Moments(keyFrames: Partial<Record<CoachCheckpointId, V2KeyFrameLike>>): CoachMoment[] {
  const moments: CoachMoment[] = [];
  for (const id of COACH_CHECKPOINT_ORDER) {
    const kf = keyFrames[id];
    if (!kf || kf.status !== "detected" || kf.timestampSeconds === null) continue;
    if (kf.confidenceLabel !== "high" && kf.confidenceLabel !== "medium") continue;
    const label: CoachMomentLabel = id === "finish" && kf.held === false ? "follow_through" : id;
    moments.push({ id, timeSeconds: kf.timestampSeconds, label, approximate: kf.confidenceLabel === "medium", source: `v2.keyFrames.${id}` });
  }
  return moments;
}

// ── Freeze length ────────────────────────────────────────────────────────

// How long a card stays up before the swing carries on by itself: a calm
// beat plus reading time for what's on it, capped so a long Gemini sentence
// doesn't stall the replay.
export function coachDwellMs(textLength: number): number {
  return Math.min(8000, Math.max(3500, 3000 + textLength * 35));
}

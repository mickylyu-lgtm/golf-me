// What the processing screen says about a running analysis, read ONLY from
// the persisted job row (stage, stage_updated_at, attempt_started_at —
// migration 20261107140000), never from a client-side timer of its own.
// The row stays the source of truth: this never decides that an analysis
// failed. A confirmed failure is status 'failed' (written by analyze-swing
// or by the database's stale sweep); until then the screen only says
// "still working", "taking longer than usual" or "checking on it".

export type CaddieProgressStep = "preparing" | "pose" | "sending" | "writing" | "saving";
export type CaddieProgressPhase = "working" | "slow" | "checking";

// analyze-swing persists trim, frame_extract, pose, gemini_upload and
// gemini_generate as it enters them (media_fetch on a Try again flip).
const STEP_FOR_STAGE: Record<string, CaddieProgressStep> = {
  queued: "preparing",
  media_fetch: "preparing",
  trim: "preparing",
  frame_extract: "pose",
  pose: "pose",
  pose_gate: "pose",
  gemini_upload: "sending",
  gemini_processing: "sending",
  gemini_generate: "writing",
  output_validation: "writing",
  save: "saving",
};

// A whole attempt past this is slower than usual (a healthy run is about a
// minute and a quarter; assumption from job 5f4c8655's timeline).
export const SLOW_AFTER_MS = 120_000;
// analyze-swing gives the first generateContent try 60 s
// (GEMINI_GENERATE_TRY_TIMEOUTS_MS); still writing after that means the
// server is on a retry, which it does by itself.
export const WRITING_RETRY_AFTER_MS = 65_000;
// Past the server's 330 s deadline plus the sweep's margin, the job should
// have settled; the app asks the database (RealCaddieContext's sweep) and
// says it is checking, never that it failed.
export const CHECKING_AFTER_MS = 400_000;

export interface CaddieProgress {
  step: CaddieProgressStep;
  phase: CaddieProgressPhase;
  /** True when the server is known to be on an automatic retry of the feedback step. */
  retrying: boolean;
  elapsedSeconds: number;
}

export function caddieProgress(
  analysis: { stage?: string; stageUpdatedAt?: string; attemptStartedAt?: string; createdAt: string },
  now: number = Date.now(),
): CaddieProgress {
  const step = (analysis.stage && STEP_FOR_STAGE[analysis.stage]) || "preparing";
  const startedAt = Date.parse(analysis.attemptStartedAt ?? analysis.createdAt);
  const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0;
  const stageAt = analysis.stageUpdatedAt ? Date.parse(analysis.stageUpdatedAt) : NaN;
  const inStageMs = Number.isFinite(stageAt) ? Math.max(0, now - stageAt) : 0;
  const retrying = step === "writing" && inStageMs > WRITING_RETRY_AFTER_MS;
  const phase: CaddieProgressPhase = elapsedMs > CHECKING_AFTER_MS ? "checking" : elapsedMs > SLOW_AFTER_MS || retrying ? "slow" : "working";
  return { step, phase, retrying, elapsedSeconds: Math.floor(elapsedMs / 1000) };
}

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

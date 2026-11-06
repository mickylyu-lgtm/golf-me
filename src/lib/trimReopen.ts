// "Change section" on Caddie > Upload a swing video reopens the trim
// selector on the window already in the draft. The draft doesn't store the
// clip's length, so when the preview <video> hasn't loaded its metadata the
// length has to be read asynchronously first. Anything can happen during
// that wait: the golfer removes the video, picks a different one, starts
// the analysis, or the page goes away. A lookup that resolves after any of
// those must never reopen the selector on the old video.
//
// The gate below hands out one token per reopen. A token is only honoured
// if it is still the latest, nobody cancelled it, and the draft is still
// the very same video (same File object and preview URL) it was started
// for. While a reopen is pending the page treats the selector as "busy":
// Remove and Ask Caddie are disabled and the analyze handler refuses.

export interface TrimDraftIdentity {
  file: unknown;
  previewUrl: string;
}

export interface TrimReopenGate {
  /** Starts a reopen for this draft; returns its token (supersedes any earlier one). */
  begin(draft: TrimDraftIdentity): number;
  /** True only for the latest, uncancelled token whose draft is still the current one. */
  isCurrent(token: number, currentDraft: TrimDraftIdentity | undefined): boolean;
  /** Ends this token's pending state (no-op for an old token). */
  end(token: number): void;
  /** Drops any pending reopen: a later answer is ignored. */
  cancel(): void;
  readonly pending: boolean;
}

export function createTrimReopenGate(): TrimReopenGate {
  let seq = 0;
  let active: { token: number; draft: TrimDraftIdentity } | null = null;
  return {
    begin(draft) {
      seq += 1;
      active = { token: seq, draft: { file: draft.file, previewUrl: draft.previewUrl } };
      return seq;
    },
    isCurrent(token, currentDraft) {
      if (!active || active.token !== token || !currentDraft) return false;
      return currentDraft.file === active.draft.file && currentDraft.previewUrl === active.draft.previewUrl;
    },
    end(token) {
      if (active && active.token === token) active = null;
    },
    cancel() {
      active = null;
    },
    get pending() {
      return active !== null;
    },
  };
}

function usableDuration(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

export type TrimReopenOutcome =
  | { kind: "open"; duration: number }
  // The draft changed, the reopen was cancelled or a newer one started:
  // do nothing at all (no selector, no toast).
  | { kind: "stale" }
  // Still the same draft, but no usable length: tell the golfer.
  | { kind: "noDuration" };

/**
 * Resolves the clip length for a reopen. Uses the preview element's length
 * when it has one (synchronous, no gate needed beyond the caller's checks);
 * otherwise reads it with `readDuration` and re-checks the token and the
 * current draft (via `getDraft`, read AFTER the await) before answering.
 */
export async function resolveTrimReopen(opts: {
  gate: TrimReopenGate;
  draft: TrimDraftIdentity;
  getDraft: () => TrimDraftIdentity | undefined;
  previewDuration: number | undefined;
  readDuration: () => Promise<number>;
}): Promise<TrimReopenOutcome> {
  const { gate, draft, getDraft } = opts;
  const token = gate.begin(draft);
  try {
    let duration = usableDuration(opts.previewDuration);
    if (duration === undefined) {
      try {
        duration = usableDuration(await opts.readDuration());
      } catch {
        duration = undefined;
      }
    }
    if (!gate.isCurrent(token, getDraft())) return { kind: "stale" };
    return duration === undefined ? { kind: "noDuration" } : { kind: "open", duration };
  } finally {
    gate.end(token);
  }
}

/** Ask Caddie may only start with a video, a picked club, and no selector open or reopening. */
export function canStartAnalysis(state: {
  hasVideo: boolean;
  hasClub: boolean;
  submitting: boolean;
  selectorOpen: boolean;
  reopening: boolean;
}): boolean {
  return state.hasVideo && state.hasClub && !state.submitting && !state.selectorOpen && !state.reopening;
}

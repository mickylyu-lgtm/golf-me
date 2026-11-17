// "Share Caddie Feedback" posts a text summary to Community, then flips
// caddie_analyses.shared_to_community. Those are two writes; if the post
// succeeded but the mark failed, the button used to re-enable and a second
// tap posted a duplicate. The post is the part that must never repeat, so it
// counts as done as soon as createPost resolves; the mark is retried once
// and otherwise only logged (the button stays done for this screen).
//
// Pure (no imports) so tests/caddieShare.test.ts runs it under node --test.

export interface ShareFeedbackDeps {
  createPost: () => Promise<unknown>;
  markShared: () => Promise<void>;
  /** Wait before the single mark retry. */
  retryDelayMs?: number;
  log?: (message: string, err: unknown) => void;
}

export interface ShareFeedbackResult {
  /** createPost resolved: never post this feedback again. */
  posted: true;
  /** shared_to_community was saved (false = only logged). */
  marked: boolean;
}

/** Rejects only when createPost itself failed (nothing was posted, safe to try again). */
export async function postFeedbackThenMark(deps: ShareFeedbackDeps): Promise<ShareFeedbackResult> {
  await deps.createPost();
  const log = deps.log ?? ((message: string, err: unknown) => console.error(message, err));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await deps.markShared();
      return { posted: true, marked: true };
    } catch (err) {
      if (attempt === 1) {
        log("GolfMe: Caddie feedback was posted, but marking the analysis shared failed.", err);
        return { posted: true, marked: false };
      }
      await new Promise((resolve) => setTimeout(resolve, deps.retryDelayMs ?? 1500));
    }
  }
  return { posted: true, marked: false };
}

export type FeedbackShareOutcome =
  | { post_id: string; outcome: "created" | "existing" }
  | { post_id: null; outcome: "unavailable" };

/** No non-atomic fallback: an unavailable migration must fail closed. */
export async function shareFeedbackAtomically(
  share: (confirmLegacy: boolean) => Promise<{ data: unknown; error: { message: string; hint?: string } | null }>,
  confirmLegacy: () => boolean,
): Promise<FeedbackShareOutcome | null> {
  let result = await share(false);
  if (result.error?.hint === "caddie_legacy_share_confirmation") {
    if (!confirmLegacy()) return null;
    result = await share(true);
  }
  if (result.error) throw new Error(result.error.message);
  const value = result.data as Partial<FeedbackShareOutcome> | null;
  if (value?.outcome === "unavailable" && value.post_id === null) return { outcome: "unavailable", post_id: null };
  if ((value?.outcome === "created" || value?.outcome === "existing") && typeof value.post_id === "string" && value.post_id) {
    return { outcome: value.outcome, post_id: value.post_id };
  }
  throw new Error("Missing feedback post confirmation.");
}

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

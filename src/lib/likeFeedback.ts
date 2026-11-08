// Post likes: which server errors still mean "done". Pure, so node tests
// cover it.

export interface PostVoteRow {
  post_id: string;
  voter_id: string;
}

// A like insert that hits the (post_id, voter_id) primary key means the
// server already has the like: the golfer's intent is satisfied.
export function isLikeAlreadyDone(wasLiked: boolean, code: string | undefined | null): boolean {
  return !wasLiked && code === "23505";
}


// Runs fn unless a call for the same id is still in flight; returns false
// when the tap was ignored. The id is released even when fn throws.
export async function runOncePerId(inFlight: Set<string>, id: string, fn: () => Promise<void>): Promise<boolean> {
  if (inFlight.has(id)) return false;
  inFlight.add(id);
  try {
    await fn();
    return true;
  } finally {
    inFlight.delete(id);
  }
}

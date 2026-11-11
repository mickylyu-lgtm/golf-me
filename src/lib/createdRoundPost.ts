export type CreatedRoundPostResult = "none" | "linked" | "failed";

// The round already exists. Linking is a separate, best-effort operation:
// failure must never invite a retry of hosting and create a duplicate round.
export async function linkCreatedRoundToPost(
  postId: string | null,
  callId: string,
  attach: (postId: string, callId: string) => Promise<void>,
  timeoutMs = 8_000,
): Promise<CreatedRoundPostResult> {
  if (!postId) return "none";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The underlying write may still complete after the deadline. Report
    // uncertainty and move on to the created round; never submit it again.
    await Promise.race([
      attach(postId, callId),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Post link timeout")), timeoutMs); }),
    ]);
    return "linked";
  } catch {
    return "failed";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

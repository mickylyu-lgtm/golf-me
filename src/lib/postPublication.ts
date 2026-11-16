/** The post insert succeeded, but its attachment write/rollback did not.
 * Preserve the draft and check the existing post instead of blindly retrying. */
export class PostPublicationUncertainError extends Error {
  readonly postId: string;
  constructor(postId: string) {
    super("post_publication_uncertain");
    this.name = "PostPublicationUncertainError";
    this.postId = postId;
  }
}

export async function rejectFailedPostMedia(
  postId: string,
  retryError: Error,
  undo: () => PromiseLike<{ data: { id?: unknown } | null; error: unknown }>,
): Promise<never> {
  let result;
  try {
    result = await undo();
  } catch {
    throw new PostPublicationUncertainError(postId);
  }
  if (result.error || result.data?.id !== postId) throw new PostPublicationUncertainError(postId);
  throw retryError;
}

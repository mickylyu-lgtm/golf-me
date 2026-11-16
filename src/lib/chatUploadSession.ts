// Session lookup happens before an upload's XHR timeout starts. A stalled
// auth refresh/lock must not leave a chat photo permanently "sending".
// Only the read is raced: a late session result cannot start an upload.
export async function readChatUploadToken(
  getSession: () => Promise<{ data: { session: { access_token: string } | null }; error?: unknown }>,
  timeoutMs = 15_000,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(getSession),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("chat upload session timed out")), timeoutMs);
      }),
    ]);
    if (result.error) throw new Error("chat upload session unavailable");
    return result.data.session?.access_token ?? null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

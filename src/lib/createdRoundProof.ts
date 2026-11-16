// Hosting is already committed. Optional proof must not trap the host on a
// sending screen or invite another host request. A deadline is uncertainty,
// not cancellation: the existing upload may still finish. Never retry here.
export async function completeCreatedRoundProof(
  attach: () => Promise<unknown>,
  timeoutMs = 15_000,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(attach),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Booking proof timeout")), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// An optional side upload (Caddie's thumbnail) that runs alongside the
// required one and never holds it back. The caller waits for it only a short
// grace period after the required work is done; if it isn't ready by then
// (or the submit is abandoned) it is skipped, and a result that lands later
// is discarded (its file removed) so no unreferenced private upload is left.

export interface OptionalUpload {
  /** The uploaded path if it is ready within `graceMs`, otherwise undefined (and a later result is discarded). */
  settle: (graceMs: number) => Promise<string | undefined>;
  /** The submit failed or was abandoned: discard whatever this produces. */
  abandon: () => void;
}

export function startOptionalUpload(options: {
  produce: () => Promise<string>;
  discard: (path: string) => void;
  onError?: (err: unknown) => void;
}): OptionalUpload {
  let abandoned = false;
  let result: string | undefined;
  let settledOk = false;
  const task = options.produce().then(
    (path) => {
      if (abandoned) options.discard(path);
      else {
        result = path;
        settledOk = true;
      }
      return path;
    },
    (err) => {
      options.onError?.(err);
      return undefined;
    },
  );
  return {
    async settle(graceMs) {
      if (abandoned) return undefined;
      if (!settledOk) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([task, new Promise((r) => (timer = setTimeout(r, Math.max(0, graceMs))))]);
        if (timer) clearTimeout(timer);
      }
      if (settledOk) return result;
      // Too late: give up on it, and drop the file if it lands afterwards.
      abandoned = true;
      return undefined;
    },
    abandon() {
      if (abandoned) return;
      abandoned = true;
      if (settledOk && result) {
        options.discard(result);
        result = undefined;
        settledOk = false;
      }
    },
  };
}

// Keeps an open Community feed in step with moderation on other devices
// (migration 20261107280000_community_feed_signal).
//
// Why: Realtime only sends a postgres_changes UPDATE to a subscriber who can
// still SELECT the new row. Removing a post/comment (or hiding a suspended
// user's content) makes it unreadable, so the people still looking at it are
// never told. The server bumps an opaque counter in
// public.community_feed_version instead; every signed-in client can read it,
// and a change means "refetch through the normal RLS-checked selects".
//
// Pure (no React, no Supabase import) so it can be tested deterministically:
// the caller injects readVersion / subscribe / refetch.

export type VersionRead =
  | { ok: true; version: number }
  /** missing = table not there (migration not applied); denied = no permission; error = anything else. */
  | { ok: false; reason: "missing" | "denied" | "error" };

export interface FeedSignalDeps {
  readVersion: () => Promise<VersionRead>;
  /**
   * Opens the one Realtime channel for the signal row. onVersion gets each
   * new counter value; onStatus the channel status strings supabase-js uses
   * ("SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"). Returns its
   * own cleanup (removeChannel).
   */
  subscribe: (handlers: { onVersion: (version: number) => void; onStatus: (status: string) => void }) => () => void;
  /** Requests a feed refetch (callers pass a coalesced one). */
  refetch: () => void;
}

export interface FeedSignal {
  /** Stops listening; idempotent. Nothing calls refetch afterwards. */
  stop: () => void;
  /** For tests/diagnostics. */
  state: () => { enabled: boolean | null; lastVersion: number | null; subscribed: boolean };
}

export function classifyVersionError(error: { code?: string; message?: string } | null | undefined): "missing" | "denied" | "error" {
  const code = error?.code ?? "";
  const msg = error?.message ?? "";
  // PostgREST: PGRST205 = table not in the schema cache; Postgres 42P01 = undefined_table.
  if (code === "PGRST205" || code === "42P01" || /could not find the table|does not exist/i.test(msg)) return "missing";
  if (code === "42501" || /permission denied/i.test(msg)) return "denied";
  return "error";
}

export function startFeedSignal(deps: FeedSignalDeps): FeedSignal {
  let stopped = false;
  let enabled: boolean | null = null;
  let lastVersion: number | null = null;
  let subscribed = false;
  let everSubscribed = false;
  let unsubscribe: (() => void) | null = null;

  const accept = (version: number) => {
    if (stopped || !Number.isFinite(version)) return;
    if (lastVersion !== null && version <= lastVersion) return; // duplicate / out of order
    const first = lastVersion === null;
    lastVersion = version;
    if (!first) deps.refetch();
  };

  // After a reconnect the signal may have been missed: compare with the server.
  const recheck = async () => {
    const r = await deps.readVersion();
    if (stopped || !r.ok) return;
    if (lastVersion === null || r.version > lastVersion) {
      lastVersion = r.version;
      deps.refetch();
    }
  };

  void deps.readVersion().then((r) => {
    if (stopped) return;
    if (!r.ok) {
      // Not applied / not allowed / failed: stay off. No retry loop; the feed
      // still refetches on its own events and on returning to the foreground.
      enabled = false;
      return;
    }
    enabled = true;
    lastVersion = r.version;
    unsubscribe = deps.subscribe({
      onVersion: (v) => accept(v),
      onStatus: (status) => {
        if (stopped) return;
        if (status === "SUBSCRIBED") {
          if (everSubscribed && !subscribed) void recheck();
          subscribed = true;
          everSubscribed = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          subscribed = false;
        }
      },
    });
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      subscribed = false;
      unsubscribe?.();
      unsubscribe = null;
    },
    state: () => ({ enabled, lastVersion, subscribed }),
  };
}

/**
 * One refetch at a time; a request while one runs schedules exactly one more
 * run afterwards (so a signal that lands mid-fetch is never lost, and a burst
 * of signals costs at most two fetches). No timers, so nothing to clean up
 * beyond dispose().
 */
export function createRefetchCoalescer(run: () => Promise<void>) {
  let loop: Promise<void> | null = null;
  let again = false;
  let disposed = false;
  // The returned promise settles after a run that STARTED after this request
  // (so `await refetch()` still means "the feed now reflects the server").
  const request = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (loop) {
      again = true;
      return loop;
    }
    loop = (async () => {
      try {
        do {
          again = false;
          try {
            await run();
          } catch {
            // run() reports its own errors; a failure doesn't stop a queued rerun.
          }
        } while (again && !disposed);
      } finally {
        loop = null;
      }
    })();
    return loop;
  };
  return {
    request,
    dispose: () => {
      disposed = true;
      again = false;
    },
    isRunning: () => loop !== null,
  };
}

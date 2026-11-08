// Run: npm run test:trust  (node --test, built-in type stripping)
// Open-feed reconciliation after moderation on another device
// (src/lib/feedSync.ts, migration 20261107280000_community_feed_signal).
// A fake server holds the rows each viewer may read (RLS) and the opaque
// counter; a fake Realtime delivers (or drops) the counter's UPDATE; the
// "feed" is whatever the last refetch read. Wired like RealCommunityContext:
// signal -> coalesced refetch, plus refetchOnResume.
import { test } from "node:test";
import assert from "node:assert/strict";

const listeners = new Map<string, Set<() => void>>();
const target = {
  addEventListener: (type: string, fn: () => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
};
const doc = { ...target, visibilityState: "visible" as "visible" | "hidden" };
Object.assign(globalThis, { document: doc, window: target });
const fire = (type: string) => listeners.get(type)?.forEach((fn) => fn());

const { startFeedSignal, createRefetchCoalescer, classifyVersionError } = await import("../src/lib/feedSync.ts");
const { refetchOnResume } = await import("../src/lib/resumeRefetch.ts");

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

interface Post {
  id: string;
  author: string;
  removed: boolean;
}

function world(opts: { versionRead?: "ok" | "missing" | "denied" | "error" } = {}) {
  const server = {
    version: 7,
    posts: [
      { id: "p1", author: "ann", removed: false },
      { id: "p2", author: "elon", removed: false },
    ] as Post[],
    hiddenAuthors: new Set<string>(),
    reads: 0,
    versionReads: 0,
  };
  // What the viewer may read: RLS (removed_at is null, author not hidden).
  const readable = () => server.posts.filter((p) => !p.removed && !server.hiddenAuthors.has(p.author)).map((p) => p.id);
  let feed: string[] = [];
  const fetchOnce = async () => {
    server.reads++;
    await Promise.resolve();
    feed = readable();
  };
  const coalescer = createRefetchCoalescer(fetchOnce);
  const channels = { open: 0, opened: 0 };
  let handlers: { onVersion: (v: number) => void; onStatus: (s: string) => void } | null = null;
  // Kept after unsubscribe: a frame already in flight can still arrive.
  let lastHandlers: typeof handlers = null;
  const signal = startFeedSignal({
    readVersion: async () => {
      server.versionReads++;
      const mode = opts.versionRead ?? "ok";
      if (mode === "ok") return { ok: true, version: server.version };
      return { ok: false, reason: mode };
    },
    subscribe: (h) => {
      handlers = h;
      lastHandlers = h;
      channels.open++;
      channels.opened++;
      queueMicrotask(() => h.onStatus("SUBSCRIBED"));
      return () => {
        handlers = null;
        channels.open--;
      };
    },
    refetch: () => void coalescer.request(),
  });
  const realtime = {
    connected: true,
    /** Server-side moderation: bumps the counter and (if connected) delivers it. */
    moderate(change: () => void) {
      change();
      server.version++;
      if (this.connected) handlers?.onVersion(server.version);
    },
    drop() {
      this.connected = false;
      handlers?.onStatus("CHANNEL_ERROR");
    },
    reconnect() {
      this.connected = true;
      handlers?.onStatus("SUBSCRIBED");
    },
    /** A raw delivery (duplicates, stale versions). */
    deliver(version: number) {
      handlers?.onVersion(version);
    },
    /** A frame that was already in flight when the channel was removed. */
    lateDeliver(version: number, status = "SUBSCRIBED") {
      lastHandlers?.onVersion(version);
      lastHandlers?.onStatus("CHANNEL_ERROR");
      lastHandlers?.onStatus(status);
    },
  };
  return { server, feed: () => feed, coalescer, signal, realtime, channels, initial: () => coalescer.request() };
}

test("signal delivered: removal disappears from the open feed after an authorized refetch", async () => {
  const w = world();
  await w.initial();
  await flush();
  assert.deepEqual(w.feed(), ["p1", "p2"]);
  const reads = w.server.reads;
  w.realtime.moderate(() => (w.server.posts[1].removed = true));
  await flush();
  assert.deepEqual(w.feed(), ["p1"]);
  assert.equal(w.server.reads, reads + 1, "exactly one refetch");
  w.signal.stop();
});

test("signal lost while disconnected: the re-join compares the counter and refetches once", async () => {
  const w = world();
  await w.initial();
  await flush();
  w.realtime.drop();
  w.realtime.moderate(() => (w.server.posts[1].removed = true)); // not delivered
  await flush();
  assert.deepEqual(w.feed(), ["p1", "p2"], "stale while the socket is down (expected)");
  const reads = w.server.reads;
  w.realtime.reconnect();
  await flush();
  assert.deepEqual(w.feed(), ["p1"]);
  assert.equal(w.server.reads, reads + 1);
  // A re-join with nothing new costs a counter read but no feed refetch.
  w.realtime.drop();
  w.realtime.reconnect();
  await flush();
  assert.equal(w.server.reads, reads + 1);
  w.signal.stop();
});

test("returning to the foreground refetches (no signal needed)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const w = world({ versionRead: "missing" }); // e.g. migration not applied
  await w.initial();
  await flush();
  const stop = refetchOnResume(() => void w.coalescer.request(), 5000);
  w.server.posts[1].removed = true; // no signal at all
  t.mock.timers.tick(60_000);
  doc.visibilityState = "visible";
  fire("visibilitychange");
  fire("focus");
  await flush();
  assert.deepEqual(w.feed(), ["p1"]);
  stop();
  w.signal.stop();
});

test("restore: the post comes back after the next signal", async () => {
  const w = world();
  await w.initial();
  await flush();
  w.realtime.moderate(() => (w.server.posts[1].removed = true));
  await flush();
  assert.deepEqual(w.feed(), ["p1"]);
  w.realtime.moderate(() => (w.server.posts[1].removed = false));
  await flush();
  assert.deepEqual(w.feed(), ["p1", "p2"]);
  w.signal.stop();
});

test("suspend with hide-content (a private-table change) still reaches the open feed", async () => {
  const w = world();
  await w.initial();
  await flush();
  w.realtime.moderate(() => w.server.hiddenAuthors.add("elon"));
  await flush();
  assert.deepEqual(w.feed(), ["p1"]);
  w.realtime.moderate(() => w.server.hiddenAuthors.delete("elon")); // lifted
  await flush();
  assert.deepEqual(w.feed(), ["p1", "p2"]);
  w.signal.stop();
});

test("permission denied / missing / failed counter read: no channel, no retry loop", async () => {
  for (const mode of ["denied", "missing", "error"] as const) {
    const w = world({ versionRead: mode });
    await w.initial();
    await flush();
    assert.equal(w.signal.state().enabled, false, mode);
    assert.equal(w.channels.opened, 0, `${mode}: never subscribes`);
    assert.equal(w.server.versionReads, 1, `${mode}: one read, no retry`);
    w.signal.stop();
  }
  assert.equal(classifyVersionError({ code: "42501", message: "permission denied for table community_feed_version" }), "denied");
  assert.equal(classifyVersionError({ code: "PGRST205", message: "Could not find the table 'public.community_feed_version' in the schema cache" }), "missing");
  assert.equal(classifyVersionError({ code: "42P01", message: 'relation "public.community_feed_version" does not exist' }), "missing");
  assert.equal(classifyVersionError({ code: "08006", message: "connection failure" }), "error");
});

test("cleanup: stop closes the one channel; later deliveries and re-joins do nothing", async () => {
  const w = world();
  await w.initial();
  await flush();
  assert.equal(w.channels.open, 1);
  w.signal.stop();
  w.signal.stop(); // idempotent
  assert.equal(w.channels.open, 0);
  const reads = w.server.reads;
  const versionReads = w.server.versionReads;
  w.realtime.moderate(() => (w.server.posts[1].removed = true));
  w.realtime.reconnect();
  w.realtime.lateDeliver(w.server.version + 5);
  await flush();
  assert.equal(w.server.reads, reads);
  assert.equal(w.server.versionReads, versionReads);
});

test("stop before the first counter read returns: never subscribes", async () => {
  const w = world();
  w.signal.stop();
  await flush();
  assert.equal(w.channels.opened, 0);
});

test("a signal landing mid-fetch is not lost (one queued rerun; bursts coalesce)", async () => {
  let release: (() => void) | null = null;
  let runs = 0;
  let serverState = "old";
  let seen = "";
  const c = createRefetchCoalescer(async () => {
    runs++;
    const snapshot = serverState;
    await new Promise<void>((r) => (release = r));
    seen = snapshot;
  });
  const first = c.request();
  serverState = "new"; // the removal commits while the first fetch is in flight
  const second = c.request();
  c.request();
  c.request();
  release!();
  await flush();
  release!();
  await Promise.all([first, second]);
  assert.equal(runs, 2, "the in-flight fetch plus exactly one rerun");
  assert.equal(seen, "new");
  assert.equal(c.isRunning(), false);
});

test("out-of-order or duplicate versions are ignored", async () => {
  const w = world();
  await w.initial();
  await flush();
  const reads = w.server.reads;
  const v = w.signal.state().lastVersion ?? -1;
  w.realtime.deliver(v); // duplicate
  w.realtime.deliver(v - 3); // stale
  w.realtime.deliver(Number.NaN); // malformed payload
  await flush();
  assert.equal(w.server.reads, reads);
  w.realtime.deliver(v + 1);
  w.realtime.deliver(v + 1); // the same event twice
  await flush();
  assert.equal(w.server.reads, reads + 1);
  w.signal.stop();
});

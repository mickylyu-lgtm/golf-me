// Per-viewer signed URLs for chat photos (private chat-media bucket). In
// memory only: never written to localStorage, the database or a message.
// Each URL is minted for THIS signed-in viewer by Storage, which checks the
// bucket's select policy at signing time (participant / current round
// member / the sender / an admin for a reported photo), so a viewer who
// can't see the message can't get a link either.
//
// - Requests in the same tick are batched into one createSignedUrls call.
// - A URL is reused until shortly before it expires, then re-signed.
// - A photo that fails to load (expired link, 400/403 after a policy change,
//   a deleted object) is invalidated and re-signed, at most MAX_ATTEMPTS
//   times in a row; after that it reads as unavailable until reset.
// - Local photos (this device's own just-sent photo, demo photos) are served
//   from their object URL and never signed.
// No React / Supabase imports: tests/chatImages.test.ts drives it with a
// fake signer and clock.

export interface SignedUrlResult {
  path: string;
  url: string | null;
}

export type SignMany = (paths: string[], ttlSeconds: number) => Promise<SignedUrlResult[]>;

export interface ChatImageUrlCacheOptions {
  sign: SignMany;
  ttlSeconds: number;
  now?: () => number;
  /** Re-sign this long before expiry. */
  refreshMarginMs?: number;
  /** Batching: runs `fn` after the current tick. */
  schedule?: (fn: () => void) => void;
}

export const MAX_ATTEMPTS = 3;

interface Entry {
  url: string;
  expiresAt: number;
}

export interface ChatImageUrlCache {
  /** A usable URL now, or null (call get()). */
  peek(path: string): string | null;
  /** Resolves to a URL, or null when it can't be signed (not visible / gone). */
  get(path: string): Promise<string | null>;
  /** The URL failed to load: drop it so the next get() re-signs. false = give up (too many tries). */
  invalidate(path: string): boolean;
  /** The photo displayed: its failure count starts over. */
  loaded(path: string): void;
  /** Serve this path from a local URL (own just-sent photo, demo). */
  setLocal(path: string, url: string): void;
  /** When the URL peek() returns stops being served (this device's clock): Infinity for a local URL, null when there is none. */
  expiresAt(path: string): number | null;
  /** Drop a still-valid URL so the next get() signs a fresh one, without counting it as a failure. */
  renew(path: string): void;
  /** Forget everything (sign-out / account switch). Returns the local URLs so the caller can revoke them. */
  reset(): string[];
  /** Subscribe to "this path's URL changed" (for re-rendering). */
  subscribe(listener: (path: string) => void): () => void;
}

export function createChatImageUrlCache(options: ChatImageUrlCacheOptions): ChatImageUrlCache {
  const now = options.now ?? Date.now;
  const margin = options.refreshMarginMs ?? 60_000;
  const schedule = options.schedule ?? ((fn) => void Promise.resolve().then(fn));
  const entries = new Map<string, Entry>();
  const local = new Map<string, string>();
  const attempts = new Map<string, number>();
  const waiting = new Map<string, ((url: string | null) => void)[]>();
  const listeners = new Set<(path: string) => void>();
  let batch: string[] | null = null;
  let generation = 0;

  const emit = (path: string) => {
    for (const l of listeners) l(path);
  };

  function fresh(path: string): string | null {
    const e = entries.get(path);
    if (!e) return null;
    if (e.expiresAt - margin <= now()) {
      entries.delete(path);
      return null;
    }
    return e.url;
  }

  function settle(path: string, url: string | null) {
    const cbs = waiting.get(path) ?? [];
    waiting.delete(path);
    for (const cb of cbs) cb(url);
  }

  async function flush() {
    const paths = batch ?? [];
    batch = null;
    if (paths.length === 0) return;
    const gen = generation;
    const signedAt = now();
    let results: SignedUrlResult[] = [];
    try {
      results = await options.sign(paths, options.ttlSeconds);
    } catch {
      results = [];
    }
    if (gen !== generation) {
      for (const p of paths) settle(p, null);
      return;
    }
    const byPath = new Map(results.map((r) => [r.path, r.url]));
    for (const p of paths) {
      const url = byPath.get(p) ?? null;
      if (url) {
        entries.set(p, { url, expiresAt: signedAt + options.ttlSeconds * 1000 });
        emit(p);
      }
      settle(p, url);
    }
  }

  return {
    peek(path) {
      return local.get(path) ?? fresh(path);
    },
    get(path) {
      const known = local.get(path) ?? fresh(path);
      if (known) return Promise.resolve(known);
      if ((attempts.get(path) ?? 0) >= MAX_ATTEMPTS) return Promise.resolve(null);
      return new Promise((resolve) => {
        const list = waiting.get(path);
        if (list) {
          list.push(resolve);
          return;
        }
        waiting.set(path, [resolve]);
        if (!batch) {
          batch = [];
          schedule(() => void flush());
        }
        batch.push(path);
      });
    },
    invalidate(path) {
      if (local.has(path)) return false;
      entries.delete(path);
      const n = (attempts.get(path) ?? 0) + 1;
      attempts.set(path, n);
      return n < MAX_ATTEMPTS;
    },
    loaded(path) {
      attempts.delete(path);
    },
    setLocal(path, url) {
      local.set(path, url);
      emit(path);
    },
    expiresAt(path) {
      if (local.has(path)) return Number.POSITIVE_INFINITY;
      if (!fresh(path)) return null;
      return entries.get(path)?.expiresAt ?? null;
    },
    renew(path) {
      if (!local.has(path)) entries.delete(path);
    },
    reset() {
      generation += 1;
      const urls = [...local.values()];
      entries.clear();
      local.clear();
      attempts.clear();
      batch = null;
      for (const p of [...waiting.keys()]) settle(p, null);
      return urls;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

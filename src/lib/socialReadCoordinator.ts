/** Provider-local, in-flight-only coordination. Never caches resolved data. */
export function createSocialReadCoordinator(concurrency = 4) {
  let active = 0;
  const queue: (() => void)[] = [];
  const flights = new WeakMap<object, Map<string, Promise<unknown>>>();
  const drain = () => { while (active < concurrency && queue.length) queue.shift()!(); };
  function limit<T>(read: () => Promise<T>, isCurrent: () => boolean): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        if (!isCurrent()) { reject(new Error("Social scope changed")); return; }
        active++;
        Promise.resolve().then(() => {
          if (!isCurrent()) throw new Error("Social scope changed");
          return read();
        }).then(resolve, reject).finally(() => { active--; drain(); });
      });
      drain();
    });
  }
  function deduplicate<T>(scope: object, key: string, read: () => Promise<T>): Promise<T> {
    let entries = flights.get(scope);
    if (!entries) { entries = new Map(); flights.set(scope, entries); }
    const existing = entries.get(key);
    if (existing) return existing as Promise<T>;
    const promise = Promise.resolve().then(read);
    entries.set(key, promise);
    const clear = () => { if (entries.get(key) === promise) entries.delete(key); };
    // Use both handlers rather than an ignored rejecting finally promise.
    promise.then(clear, clear);
    return promise;
  }
  return { limit, deduplicate };
}

/** Recheck in the caller's continuation immediately before synchronous writes. */
export function requireSocialScope(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new Error("Follower visibility changed");
}

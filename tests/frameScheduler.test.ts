// Run: npm run test:courses  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFrameScheduler } from "../src/lib/frameScheduler.ts";

// A fake frame queue: callbacks run only when flush() is called.
function fakeFrames() {
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    request: (cb: () => void) => {
      const id = next++;
      queue.set(id, cb);
      return id;
    },
    cancel: (id: number) => void queue.delete(id),
    flush: () => {
      const cbs = [...queue.values()];
      queue.clear();
      cbs.forEach((cb) => cb());
    },
    size: () => queue.size,
  };
}

test("repeated resizes in one frame run the check once", () => {
  const f = fakeFrames();
  let runs = 0;
  const s = createFrameScheduler(() => runs++, f.request, f.cancel);
  s.schedule();
  s.schedule();
  s.schedule();
  assert.equal(f.size(), 1);
  f.flush();
  assert.equal(runs, 1);
  s.schedule();
  f.flush();
  assert.equal(runs, 2);
});

test("a check queued before blur / keyboard close never runs after it", () => {
  const f = fakeFrames();
  let runs = 0;
  const s = createFrameScheduler(() => runs++, f.request, f.cancel);
  s.schedule(); // a resize just before the field lost focus
  s.dispose(); // the effect's cleanup (field blurred or keyboard closed)
  f.flush();
  assert.equal(runs, 0, "the stale scroll is cancelled");
  s.schedule(); // a late ResizeObserver callback after cleanup
  f.flush();
  assert.equal(runs, 0, "nothing can be queued once disposed");
  assert.equal(f.size(), 0);
});

test("even if the platform runs a cancelled frame, a disposed scheduler stays inert", () => {
  let queued: (() => void) | null = null;
  let runs = 0;
  const s = createFrameScheduler(
    () => runs++,
    (cb) => {
      queued = cb;
      return 1;
    },
    () => undefined, // cancel that doesn't actually cancel
  );
  s.schedule();
  s.dispose();
  (queued as unknown as () => void)();
  assert.equal(runs, 0);
});

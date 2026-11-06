// Run: npm run test:chat  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createScrollAnimator, easeOutCubic, motionDuration } from "../src/lib/keyboard/smoothScroll.ts";
import type { MotionEnv } from "../src/lib/keyboard/smoothScroll.ts";

// A fake scroller + clock + frame queue + input watcher.
function rig(opts: { instant?: boolean; start?: number } = {}) {
  let position = opts.start ?? 0;
  let clock = 0;
  let nextId = 1;
  const frames = new Map<number, () => void>();
  const writes: number[] = [];
  const inputs = new Set<() => void>();
  const env: MotionEnv = {
    now: () => clock,
    requestFrame(cb) {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    instant: () => opts.instant === true,
    watchUserInput(onInput) {
      inputs.add(onInput);
      return () => inputs.delete(onInput);
    },
  };
  const animator = createScrollAnimator(
    {
      read: () => position,
      write: (v) => {
        position = v;
        writes.push(v);
      },
    },
    env,
  );
  return {
    animator,
    writes,
    inputs,
    get position() {
      return position;
    },
    set position(v: number) {
      position = v;
    },
    pendingFrames: () => frames.size,
    // Advance one frame of `ms`.
    tick(ms = 16) {
      clock += ms;
      const due = Array.from(frames.entries());
      frames.clear();
      for (const [, cb] of due) cb();
    },
    runToEnd(ms = 16, max = 100) {
      for (let i = 0; i < max && frames.size > 0; i++) this.tick(ms);
    },
    touch() {
      for (const fn of Array.from(inputs)) fn();
    },
  };
}

test("duration: short moves are quicker, bounded 140-260 ms", () => {
  assert.equal(motionDuration(0), 140);
  assert.equal(motionDuration(100), 180);
  assert.equal(motionDuration(-100), 180);
  assert.equal(motionDuration(5000), 260);
});

test("easing: 0 -> 1, monotonic, clamped", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(2), 1);
  assert.equal(easeOutCubic(-1), 0);
  let last = 0;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const v = easeOutCubic(t);
    assert.ok(v >= last);
    last = v;
  }
});

test("animates over several frames, one direction, no overshoot, ends exactly at the target", () => {
  const r = rig();
  let done: boolean | null = null;
  r.animator.animateTo(200, { onDone: (reached) => (done = reached) });
  assert.equal(r.writes.length, 0, "nothing until the first frame");
  r.runToEnd();
  assert.ok(r.writes.length >= 5, `frames: ${r.writes.length}`);
  for (let i = 1; i < r.writes.length; i++) assert.ok(r.writes[i] >= r.writes[i - 1]);
  assert.ok(Math.max(...r.writes) <= 200);
  assert.equal(r.position, 200);
  assert.equal(done, true);
  assert.equal(r.animator.isRunning(), false);
  assert.equal(r.inputs.size, 0, "input listeners detached");
  assert.equal(r.pendingFrames(), 0);
});

test("finishes within its duration (+1 frame)", () => {
  const r = rig();
  r.animator.animateTo(300);
  let elapsed = 0;
  while (r.pendingFrames() > 0) {
    r.tick(16);
    elapsed += 16;
  }
  assert.ok(elapsed <= motionDuration(300) + 16, `elapsed ${elapsed}`);
});

test("dropped frames: the deadline writes the target", () => {
  const r = rig();
  r.animator.animateTo(150);
  r.tick(16);
  r.tick(1000);
  assert.equal(r.position, 150);
  assert.equal(r.animator.isRunning(), false);
});

test("instant (reduced motion / switch off): one write, at once, no frames", () => {
  const r = rig({ instant: true });
  let done: boolean | null = null;
  r.animator.animateTo(240, { onDone: (reached) => (done = reached) });
  assert.deepEqual(r.writes, [240]);
  assert.equal(done, true);
  assert.equal(r.pendingFrames(), 0);
  assert.equal(r.inputs.size, 0);
});

test("no-op: a target within 2 px writes at most once and schedules nothing", () => {
  const r = rig({ start: 100 });
  r.animator.animateTo(101);
  assert.equal(r.pendingFrames(), 0);
  assert.ok(r.writes.length <= 1);
  r.animator.animateTo(100);
  assert.equal(r.pendingFrames(), 0);
});

test("coalescing: repeated calls for the same target keep one motion", () => {
  const r = rig();
  r.animator.animateTo(200);
  r.tick();
  r.tick();
  const before = r.writes.length;
  const midway = r.position;
  for (let i = 0; i < 5; i++) r.animator.animateTo(200.6);
  assert.equal(r.pendingFrames(), 1, "still exactly one frame queued");
  r.tick();
  assert.equal(r.writes.length, before + 1);
  assert.ok(r.position > midway, "kept going, not restarted from 0");
  r.runToEnd();
  assert.equal(r.position, 200);
});

test("retarget: a new target continues from the current position", () => {
  const r = rig();
  r.animator.animateTo(200);
  r.tick();
  r.tick();
  const at = r.position;
  r.animator.animateTo(300);
  r.tick();
  assert.ok(r.position >= at && r.position - at < 80, `no jump on retarget: ${at} -> ${r.position}`);
  r.runToEnd();
  assert.equal(r.position, 300);
});

test("replaced motion's onDone reports false", () => {
  const r = rig();
  const results: boolean[] = [];
  r.animator.animateTo(200, { onDone: (v) => results.push(v) });
  r.tick();
  r.animator.animateTo(50, {});
  assert.deepEqual(results, [false]);
});

test("guard false stops before writing, leaves the position", () => {
  const r = rig();
  let ok = true;
  let done: boolean | null = null;
  r.animator.animateTo(200, { guard: () => ok, onDone: (v) => (done = v) });
  r.tick();
  const at = r.position;
  const writes = r.writes.length;
  ok = false;
  r.tick();
  assert.equal(r.writes.length, writes, "no write after the guard failed");
  assert.equal(r.position, at);
  assert.equal(done, false);
  assert.equal(r.inputs.size, 0);
  assert.equal(r.pendingFrames(), 0);
});

test("user input (touch / wheel) cancels at once", () => {
  const r = rig();
  r.animator.animateTo(200);
  r.tick();
  assert.equal(r.inputs.size, 1);
  r.touch();
  assert.equal(r.animator.isRunning(), false);
  assert.equal(r.pendingFrames(), 0);
  assert.equal(r.inputs.size, 0);
  const at = r.position;
  r.tick();
  assert.equal(r.position, at);
});

test("input listeners exist only while running (the focusing tap can't cancel it)", () => {
  const r = rig();
  assert.equal(r.inputs.size, 0);
  r.animator.animateTo(120);
  assert.equal(r.inputs.size, 1);
  r.runToEnd();
  assert.equal(r.inputs.size, 0);
});

test("cancel(): stops, cleans up, onDone(false)", () => {
  const r = rig();
  let done: boolean | null = null;
  r.animator.animateTo(200, { onDone: (v) => (done = v) });
  r.tick();
  r.animator.cancel();
  assert.equal(done, false);
  assert.equal(r.pendingFrames(), 0);
  assert.equal(r.inputs.size, 0);
  r.animator.cancel();
});

test("someone else scrolls meanwhile: continues from there, no jump back, same target", () => {
  const r = rig();
  r.animator.animateTo(300);
  r.tick();
  r.tick();
  r.position = 250; // e.g. a WebKit pan
  r.tick();
  assert.ok(r.position >= 250, `no jump back: ${r.position}`);
  r.runToEnd();
  assert.equal(r.position, 300);
});

test("yieldToOtherScrolls: another write stops it (a sheet's restore wins)", () => {
  const r = rig();
  let done: boolean | null = null;
  r.animator.animateTo(300, { yieldToOtherScrolls: true, onDone: (v) => (done = v) });
  r.tick();
  r.position = 0;
  r.tick();
  assert.equal(r.position, 0);
  assert.equal(done, false);
  assert.equal(r.animator.isRunning(), false);
});

test("a clamped write (target past the end) still terminates at the deadline", () => {
  let position = 0;
  let clock = 0;
  const frames: Array<() => void> = [];
  const animator = createScrollAnimator(
    { read: () => position, write: (v) => (position = Math.min(v, 100)) },
    {
      now: () => clock,
      requestFrame: (cb) => frames.push(cb),
      cancelFrame: () => {},
      instant: () => false,
      watchUserInput: () => () => {},
    },
  );
  animator.animateTo(400);
  for (let i = 0; i < 200 && frames.length; i++) {
    clock += 16;
    frames.shift()!();
  }
  assert.equal(animator.isRunning(), false);
  assert.ok(clock < 1000, `ended by ${clock} ms`);
});

test("scrolling up (negative moves) works the same", () => {
  const r = rig({ start: 400 });
  r.animator.animateTo(100);
  r.runToEnd();
  for (let i = 1; i < r.writes.length; i++) assert.ok(r.writes[i] <= r.writes[i - 1]);
  assert.equal(r.position, 100);
});

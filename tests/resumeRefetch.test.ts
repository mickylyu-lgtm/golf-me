// Run: npm run test:trust  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal document/window stand-ins: listeners plus a visibility state.
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

const { refetchOnResume } = await import("../src/lib/resumeRefetch.ts");

test("coming back to the app refetches, once even when visibility and focus both fire", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  let calls = 0;
  const stop = refetchOnResume(() => calls++, 5000);
  t.mock.timers.tick(60_000);
  fire("visibilitychange");
  fire("focus");
  assert.equal(calls, 1);
  stop();
});

test("no refetch right after the initial load, or while hidden", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  let calls = 0;
  const stop = refetchOnResume(() => calls++, 5000);
  t.mock.timers.tick(1000);
  fire("focus");
  assert.equal(calls, 0, "too soon after the initial fetch");
  t.mock.timers.tick(60_000);
  doc.visibilityState = "hidden";
  fire("visibilitychange");
  assert.equal(calls, 0, "going to the background doesn't fetch");
  doc.visibilityState = "visible";
  stop();
});

test("cleanup removes the listeners", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  let calls = 0;
  refetchOnResume(() => calls++, 5000)();
  t.mock.timers.tick(60_000);
  fire("visibilitychange");
  fire("focus");
  assert.equal(calls, 0);
});

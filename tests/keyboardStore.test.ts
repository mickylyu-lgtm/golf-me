// Run: npm run test:chat  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKeyboardStore } from "../src/lib/keyboard/store.ts";
import type { KeyboardEventHandlers, KeyboardWillEvent } from "../src/lib/keyboard/store.ts";

// A fake native plugin: counts installs, captures the handlers.
function fakeNative() {
  const native = { installs: 0, handlers: null as KeyboardEventHandlers | null };
  const store = createKeyboardStore((handlers) => {
    native.installs += 1;
    native.handlers = handlers;
  });
  const fire = () => {
    assert.ok(native.handlers, "native listeners installed");
    return native.handlers;
  };
  return { store, native, fire };
}

test("a subscriber added after the keyboard opened reads the height at once", () => {
  const { store, fire } = fakeNative();
  const first: number[] = [];
  store.subscribe(() => first.push(store.getHeight()));
  fire().willShow(312);
  assert.deepEqual(first, [312]);
  // The sheet mounting now (useSyncExternalStore's first getSnapshot).
  let renders = 0;
  store.subscribe(() => renders++);
  assert.equal(store.getHeight(), 312, "no 0 until the next keyboardWillShow");
  assert.equal(renders, 0);
});

test("show, height change while open, hide", () => {
  const { store, fire } = fakeNative();
  const seen: number[] = [];
  store.subscribe(() => seen.push(store.getHeight()));
  fire().willShow(312);
  fire().willShow(312); // same height: no re-render
  fire().willShow(356); // e.g. emoji keyboard
  fire().willHide();
  fire().willHide();
  assert.deepEqual(seen, [312, 356, 0]);
  assert.equal(store.getHeight(), 0);
});

test("hide then show again", () => {
  const { store, fire } = fakeNative();
  const seen: number[] = [];
  store.subscribe(() => seen.push(store.getHeight()));
  fire().willShow(300);
  fire().willHide();
  fire().willShow(300);
  assert.deepEqual(seen, [300, 0, 300]);
});

test("WillShow reporting 0 (QuickType bar / hardware keyboard) reads as closed; bad payloads are 0", () => {
  const { store, fire } = fakeNative();
  store.subscribe(() => {});
  fire().willShow(300);
  fire().willShow(0);
  assert.equal(store.getHeight(), 0);
  fire().willShow(Number.NaN);
  assert.equal(store.getHeight(), 0);
  fire().willShow(-5);
  assert.equal(store.getHeight(), 0);
});

test("many subscribers mounting and unmounting install the native listeners once and leave none behind", () => {
  const { store, native, fire } = fakeNative();
  assert.equal(native.installs, 0, "lazy: nothing installed before the first subscriber");
  const calls: number[] = [];
  const unsubs: Array<() => void> = [];
  for (let i = 0; i < 50; i++) unsubs.push(store.subscribe(() => calls.push(i)));
  for (let i = 0; i < 20; i++) unsubs.push(store.subscribeEvents(() => calls.push(100 + i)));
  assert.equal(native.installs, 1);
  for (const unsub of unsubs) unsub();
  for (const unsub of unsubs) unsub(); // double unsubscribe (StrictMode) is harmless
  for (let i = 0; i < 10; i++) store.subscribe(() => {})(); // churn
  assert.equal(native.installs, 1, "never re-installed or duplicated");
  fire().willShow(280);
  fire().willHide();
  assert.deepEqual(calls, [], "no stale subscriber is called");
  // A fresh subscriber after everyone left still works.
  const seen: number[] = [];
  store.subscribe(() => seen.push(store.getHeight()));
  fire().willShow(290);
  assert.deepEqual(seen, [290]);
  assert.equal(native.installs, 1);
});

test("unsubscribing during a notification: self and a later subscriber", () => {
  const { store, fire } = fakeNative();
  const calls: string[] = [];
  let unsubB = () => {};
  const unsubA = store.subscribe(() => {
    calls.push("a");
    unsubA(); // unsubscribe self
    unsubB(); // and a later one, before its turn
  });
  unsubB = store.subscribe(() => calls.push("b"));
  store.subscribe(() => calls.push("c"));
  fire().willShow(300);
  assert.deepEqual(calls, ["a", "c"], "b was removed before its turn and is not called");
  fire().willHide();
  assert.deepEqual(calls, ["a", "c", "c"]);
});

test("a subscriber added during a notification waits for the next change", () => {
  const { store, fire } = fakeNative();
  const calls: string[] = [];
  let added = false;
  store.subscribe(() => {
    calls.push("a");
    if (!added) {
      added = true;
      store.subscribe(() => calls.push("late"));
    }
  });
  fire().willShow(300);
  assert.deepEqual(calls, ["a"]);
  fire().willHide();
  assert.deepEqual(calls, ["a", "a", "late"]);
});

test("a throwing subscriber doesn't starve the others", () => {
  const { store, fire } = fakeNative();
  const calls: string[] = [];
  store.subscribe(() => {
    throw new Error("boom");
  });
  store.subscribe(() => calls.push("ok"));
  const reported: unknown[] = [];
  const g = globalThis as { reportError?: (error: unknown) => void };
  const original = g.reportError;
  g.reportError = (error) => reported.push(error);
  try {
    fire().willShow(300);
  } finally {
    g.reportError = original;
  }
  assert.deepEqual(calls, ["ok"]);
  assert.equal(reported.length, 1, "the error still surfaces");
  assert.equal(store.getHeight(), 300);
});

test("raw events: every WillShow (even same height or 0) and WillHide, in order", () => {
  const { store, fire } = fakeNative();
  const events: KeyboardWillEvent[] = [];
  store.subscribeEvents((event) => events.push(event));
  fire().willShow(300);
  fire().willShow(300);
  fire().willShow(0);
  fire().willHide();
  fire().didShow(300); // not a "will" event
  assert.deepEqual(events, [
    { type: "willShow", height: 300 },
    { type: "willShow", height: 300 },
    { type: "willShow", height: 0 },
    { type: "willHide" },
  ]);
});

test("height listeners see the new height before raw event listeners run", () => {
  const { store, fire } = fakeNative();
  const order: string[] = [];
  store.subscribeEvents(() => order.push(`event:${store.getHeight()}`));
  store.subscribe(() => order.push(`height:${store.getHeight()}`));
  fire().willShow(300);
  assert.deepEqual(order, ["height:300", "event:300"]);
});

test("DidShow only fills in a missed WillShow; never moves or reopens", () => {
  // Missed WillShow (listeners registered mid-animation): DidShow corrects.
  {
    const { store, fire } = fakeNative();
    store.subscribe(() => {});
    fire().didShow(312);
    assert.equal(store.getHeight(), 312);
  }
  // WillShow already set the height: DidShow never moves it.
  {
    const { store, fire } = fakeNative();
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.getHeight()));
    fire().willShow(312);
    fire().didShow(320);
    assert.deepEqual(seen, [312]);
  }
  // A late DidShow after a newer WillHide doesn't reopen.
  {
    const { store, fire } = fakeNative();
    store.subscribe(() => {});
    fire().willShow(312);
    fire().willHide();
    fire().didShow(312);
    assert.equal(store.getHeight(), 0);
  }
});

// Slide timing (getSlideMs / getLastWillAt): only for the chat follow motion.
function timedNative() {
  let t = 1000;
  let handlers: KeyboardEventHandlers | null = null;
  const store = createKeyboardStore(
    (h) => {
      handlers = h;
    },
    () => t,
  );
  store.subscribe(() => {});
  const fire = (): KeyboardEventHandlers => {
    assert.ok(handlers);
    return handlers;
  };
  return { store, fire, advance: (ms: number) => (t += ms) };
}

test("slide timing: WillShow (closed -> open) to DidShow, WillHide to DidHide", () => {
  const { store, fire, advance } = timedNative();
  assert.equal(store.getSlideMs("show"), null);
  assert.equal(store.getLastWillAt(), null);
  fire().willShow(336);
  assert.equal(store.getLastWillAt(), 1000);
  advance(270);
  fire().didShow(336);
  assert.equal(store.getSlideMs("show"), 270);
  advance(1000);
  fire().willHide();
  assert.equal(store.getLastWillAt(), 2270);
  advance(240);
  fire().didHide();
  assert.equal(store.getSlideMs("hide"), 240);
  assert.equal(store.getHeight(), 0, "DidHide never changes the height");
});

test("slide timing ignores field-to-field WillShows, stray Did events and implausible gaps", () => {
  const { store, fire, advance } = timedNative();
  fire().willShow(336);
  advance(250);
  fire().didShow(336);
  // Already open: another WillShow (another field / emoji) isn't a slide from closed.
  fire().willShow(376);
  advance(30);
  fire().didShow(376);
  assert.equal(store.getSlideMs("show"), 250);
  // A DidHide with no WillHide seen (the plugin's cancelled hide): nothing.
  fire().didHide();
  assert.equal(store.getSlideMs("hide"), null);
  // Too long to be a slide (a stalled thread): ignored.
  fire().willHide();
  advance(5000);
  fire().didHide();
  assert.equal(store.getSlideMs("hide"), null);
  // Too short: ignored.
  fire().willShow(336);
  advance(10);
  fire().didShow(336);
  assert.equal(store.getSlideMs("show"), 250);
  assert.equal(store.getHeight(), 336);
});

test("off-native (no source): always 0, nothing installed, subscriptions are no-ops", () => {
  const store = createKeyboardStore(null);
  let calls = 0;
  const unsub = store.subscribe(() => calls++);
  store.subscribeEvents(() => calls++)();
  unsub();
  assert.equal(store.getHeight(), 0);
  assert.equal(calls, 0);
});

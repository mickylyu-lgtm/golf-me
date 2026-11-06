// Run: node --test tests/tapFeedback.test.ts  (built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OUTCOME_THROTTLE_MS,
  TAP_THROTTLE_MS,
  createTapFeedback,
  hapticForElement,
  installTapFeedback,
  type HapticDriver,
  type HapticElementLike,
} from "../src/lib/tapFeedback.ts";

function fakeDriver(native = true) {
  const calls: string[] = [];
  const driver: HapticDriver = {
    isNative: () => native,
    impact: (style) => {
      calls.push(`impact:${style}`);
      return Promise.resolve();
    },
    selection: () => {
      calls.push("selection");
      return Promise.resolve();
    },
    success: () => {
      calls.push("success");
      return Promise.resolve();
    },
  };
  return { driver, calls };
}

test("native: each kind maps to its plugin call", () => {
  const { driver, calls } = fakeDriver();
  let t = 0;
  const haptic = createTapFeedback(driver, () => t);
  assert.equal(haptic("tap"), true);
  t += 1000;
  haptic("selection");
  t += 1000;
  haptic("medium");
  t += 1000;
  haptic("success");
  assert.deepEqual(calls, ["impact:light", "selection", "impact:medium", "success"]);
});

test("web: never calls the plugin", () => {
  const { driver, calls } = fakeDriver(false);
  const haptic = createTapFeedback(driver, () => 0);
  for (const k of ["tap", "selection", "medium", "success"] as const) assert.equal(haptic(k), false);
  assert.deepEqual(calls, []);
});

test("taps are throttled; outcomes have their own window", () => {
  const { driver, calls } = fakeDriver();
  let t = 1000;
  const haptic = createTapFeedback(driver, () => t);
  assert.equal(haptic("tap"), true);
  t += TAP_THROTTLE_MS - 1;
  assert.equal(haptic("tap"), false);
  assert.equal(haptic("selection"), false);
  // A success right after the tap still lands.
  assert.equal(haptic("success"), true);
  t += 1;
  assert.equal(haptic("tap"), true);
  assert.equal(haptic("medium"), false);
  t += OUTCOME_THROTTLE_MS;
  assert.equal(haptic("medium"), true);
  assert.deepEqual(calls, ["impact:light", "success", "impact:light", "impact:medium"]);
});

test("never throws: a throwing or rejecting driver is swallowed", async () => {
  const throwing: HapticDriver = {
    isNative: () => {
      throw new Error("no bridge");
    },
    impact: () => undefined,
    selection: () => undefined,
    success: () => undefined,
  };
  assert.equal(createTapFeedback(throwing)("tap"), false);
  const rejecting: HapticDriver = {
    isNative: () => true,
    impact: () => Promise.reject(new Error("plugin missing")),
    selection: () => {
      throw new Error("sync fail");
    },
    success: () => Promise.reject(new Error("x")),
  };
  let t = 0;
  const haptic = createTapFeedback(rejecting, () => (t += 1000));
  assert.equal(haptic("tap"), true);
  assert.equal(haptic("selection"), false);
  assert.equal(haptic("success"), true);
  // Let the rejections settle; an unhandled one would fail the run.
  await new Promise((r) => setTimeout(r, 10));
});

// --- element resolution ---------------------------------------------------

function el(attrs: Record<string, string>, parent: FakeEl | null = null): FakeEl {
  return new FakeEl(attrs, parent);
}

class FakeEl implements HapticElementLike {
  listeners: Array<(e: unknown) => void> = [];
  attrs: Record<string, string>;
  parent: FakeEl | null;
  constructor(attrs: Record<string, string>, parent: FakeEl | null) {
    this.attrs = attrs;
    this.parent = parent;
  }
  getAttribute(name: string) {
    return name in this.attrs ? this.attrs[name] : null;
  }
  hasAttribute(name: string) {
    return name in this.attrs;
  }
  matches() {
    const a = this.attrs;
    return "data-haptic" in a || ["tab", "radio", "switch", "menuitemradio"].includes(a.role ?? "");
  }
  closest(): FakeEl | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let n: FakeEl | null = this;
    while (n && !n.matches()) n = n.parent;
    return n;
  }
  addEventListener(_t: string, l: (e: unknown) => void) {
    this.listeners.push(l);
  }
  removeEventListener(_t: string, l: (e: unknown) => void) {
    this.listeners = this.listeners.filter((x) => x !== l);
  }
}

test("hapticForElement: explicit kinds, roles, opt-out, disabled", () => {
  const button = el({ "data-haptic": "tap" });
  assert.equal(hapticForElement(el({}, button)), "tap"); // icon inside the button
  assert.equal(hapticForElement(el({ "data-haptic": "medium" })), "medium");
  assert.equal(hapticForElement(el({ "data-haptic": "none" })), null);
  assert.equal(hapticForElement(el({ "data-haptic": "tap", disabled: "" })), null);
  assert.equal(hapticForElement(el({ role: "switch", "aria-checked": "true" })), "tap");
  assert.equal(hapticForElement(el({ role: "menuitemradio", "aria-checked": "true" })), "tap");
  assert.equal(hapticForElement(el({ role: "tab", "aria-selected": "false" })), "selection");
  assert.equal(hapticForElement(el({ role: "radio", "aria-checked": "false" })), "selection");
  assert.equal(hapticForElement(el({})), null);
  assert.equal(hapticForElement(null), null);
  assert.equal(hapticForElement({}), null); // a text node or window
});

test("hapticForElement: no selection tick on the option already selected", () => {
  assert.equal(hapticForElement(el({ role: "tab", "aria-selected": "true" })), null);
  assert.equal(hapticForElement(el({ role: "radio", "aria-checked": "true" })), null);
  assert.equal(hapticForElement(el({ "data-haptic": "selection", "aria-pressed": "true" })), null);
  assert.equal(hapticForElement(el({ "data-haptic": "selection", "aria-current": "page" })), null);
  assert.equal(hapticForElement(el({ "data-haptic": "selection", "aria-pressed": "false" })), "selection");
});

// --- delegated listener ----------------------------------------------------

function fakeDocument() {
  const capture: Array<(e: unknown) => void> = [];
  return {
    capture,
    addEventListener(_t: string, l: (e: unknown) => void, c: boolean) {
      if (c) capture.push(l);
    },
    removeEventListener(_t: string, l: (e: unknown) => void) {
      const i = capture.indexOf(l);
      if (i >= 0) capture.splice(i, 1);
    },
  };
}

// Simulates a click: document capture, then (unless a handler on the way
// down stopped it) the tappable's own listeners.
function click(doc: ReturnType<typeof fakeDocument>, target: FakeEl, opts: { detail?: number; stoppedInCapture?: boolean } = {}) {
  const e = { target, detail: opts.detail ?? 1 };
  for (const l of [...doc.capture]) l(e);
  if (opts.stoppedInCapture) return;
  const tappable = target.closest();
  if (tappable) for (const l of [...tappable.listeners]) l(e);
}

test("installTapFeedback: one haptic per click, read before the handlers", () => {
  const doc = fakeDocument();
  const fired: string[] = [];
  const uninstall = installTapFeedback(doc as never, (k) => fired.push(k));
  const tab = el({ role: "tab", "aria-selected": "false" });
  const icon = el({}, tab);
  click(doc, icon);
  assert.deepEqual(fired, ["selection"]);
  assert.equal(tab.listeners.length, 0, "the one-off listener is removed after firing");
  uninstall();
  click(doc, icon);
  assert.deepEqual(fired, ["selection"]);
});

test("installTapFeedback: a click swallowed in capture never buzzes; keyboard clicks never buzz", () => {
  const doc = fakeDocument();
  const fired: string[] = [];
  installTapFeedback(doc as never, (k) => fired.push(k));
  const emoji = el({ role: "menuitemradio", "aria-checked": "false" });
  click(doc, emoji, { stoppedInCapture: true });
  assert.deepEqual(fired, []);
  click(doc, emoji, { detail: 0 });
  assert.deepEqual(fired, []);
  // The next real click disarms the stale listener and fires once.
  click(doc, emoji);
  assert.deepEqual(fired, ["tap"]);
  assert.equal(emoji.listeners.length, 0);
});

test("installTapFeedback: untagged elements do nothing", () => {
  const doc = fakeDocument();
  const fired: string[] = [];
  installTapFeedback(doc as never, (k) => fired.push(k));
  click(doc, el({}));
  assert.deepEqual(fired, []);
});

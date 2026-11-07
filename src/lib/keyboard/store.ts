// One app-wide record of the iOS keyboard, fed by ONE set of Capacitor
// Keyboard plugin listeners (wired in lib/useKeyboardHeight.ts). Pure: no
// Capacitor, React or DOM imports, so tests/keyboardStore.test.ts runs
// under plain node.
//
// Why a store (Micky/Atlas, 2026-11): useKeyboardHeight used to keep its
// own useState(0) and add its own keyboardWillShow/WillHide pair per
// component. A sheet or screen mounted while the keyboard was already
// open read 0 until the next keyboardWillShow, so it sat under the
// keyboard. Now every reader gets the current height from its first
// render, and the native listeners are installed once, on the first
// subscriber, and kept for the app's life (no add/remove churn, never
// duplicated however many components mount and unmount).
//
// Events:
// - keyboardWillShow(h): THE signal. Sets the height (also a second
//   WillShow while open, e.g. switching to the emoji keyboard). The plugin
//   reports 0 for the QuickType-only bar / hardware keyboard, which reads
//   as closed. DirectMessageThread and the docking composers size
//   themselves from this.
// - keyboardWillHide: height 0.
// - keyboardDidShow(h): a correction only, for a WillShow this store never
//   saw (the keyboard was opening while the listeners were still being
//   registered). Applied only while the height reads 0 and the last
//   "will" event wasn't a hide, so it never moves a height WillShow set
//   (DM timing unchanged) and a late DidShow after a newer WillHide can't
//   reopen anything.
// - keyboardDidHide: deliberately NOT applied. The plugin delays its
//   WillHide by a run-loop turn and cancels it when a WillShow follows
//   (focus moving field to field), but iOS's own DidHide can still arrive
//   for that cancelled hide while the keyboard is up; zeroing on it would
//   drop a sheet back under an open keyboard.
//
// Raw "will" events are also forwarded, unfiltered and in order, to
// imperative listeners (subscribeEvents) for the global hooks that react
// to every WillShow even when the height didn't change
// (useRevealFocusedFieldAboveKeyboard, useDismissKeyboardOnDrag).
//
// Slide timing (getSlideMs): the plugin doesn't pass on UIKit's animation
// duration, but iOS sends Will* when the keyboard starts sliding and Did*
// when it has finished, so the gap between a WillShow that opened a closed
// keyboard and the DidShow after it is this device's real slide time (the
// same for WillHide -> DidHide). Only used to time the chat composer's
// follow motion (lib/useKeyboardFollow.ts); it never changes the height.
// A DidHide without a WillHide this store saw (the cancelled hide above)
// measures nothing.

export type KeyboardWillEvent = { type: "willShow"; height: number } | { type: "willHide" };

export interface KeyboardEventHandlers {
  willShow(height: number): void;
  willHide(): void;
  didShow(height: number): void;
  // Timing only (see above): never changes the height.
  didHide(): void;
}

// Installs the native listeners. Called at most once per store.
export type KeyboardSource = (handlers: KeyboardEventHandlers) => void;

export interface KeyboardStore {
  getHeight(): number;
  // Height changes (deduplicated). For useSyncExternalStore.
  subscribe(listener: () => void): () => void;
  // Every WillShow / WillHide, as received.
  subscribeEvents(listener: (event: KeyboardWillEvent) => void): () => void;
  // The last measured full slide (ms) up ("show") or down ("hide"), or null
  // before one has been seen.
  getSlideMs(kind: "show" | "hide"): number | null;
  // When the last WillShow / WillHide arrived (the clock passed in), null
  // before any: the moment the current slide started.
  getLastWillAt(): number | null;
  // Exposed for tests; production calls go through the installed source.
  handlers: KeyboardEventHandlers;
}

// A Will -> Did gap outside this range isn't a keyboard slide (a stalled
// JS thread, a backgrounded app) and is ignored.
export const SLIDE_SAMPLE_MIN_MS = 80;
export const SLIDE_SAMPLE_MAX_MS = 1000;

function sanitize(height: unknown): number {
  const n = typeof height === "number" ? height : Number(height);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// One listener throwing must not starve the others (or the native
// callback); the error still surfaces (window error event / console), just
// without unwinding the loop.
function reportListenerError(error: unknown) {
  const report = (globalThis as { reportError?: (error: unknown) => void }).reportError;
  if (typeof report === "function") {
    report(error);
    return;
  }
  setTimeout(() => {
    throw error;
  }, 0);
}

function callSafely(fn: () => void) {
  try {
    fn();
  } catch (error) {
    reportListenerError(error);
  }
}

// Calls each listener still subscribed at the moment its turn comes, so
// one that unsubscribes another mid-notification (e.g. a sheet closing
// another) never calls a stale subscriber, and one subscribed mid-way waits
// for the next change.
function notify<T>(listeners: Set<T>, call: (listener: T) => void) {
  for (const listener of Array.from(listeners)) {
    if (listeners.has(listener)) callSafely(() => call(listener));
  }
}

// `source` null (web/PWA): height is always 0 and nothing is installed.
export function createKeyboardStore(source: KeyboardSource | null, now: () => number = () => Date.now()): KeyboardStore {
  let height = 0;
  let lastWill: "show" | "hide" | null = null;
  let installed = false;
  const heightListeners = new Set<() => void>();
  const eventListeners = new Set<(event: KeyboardWillEvent) => void>();
  // The slide being timed: started by a WillShow that opened a closed
  // keyboard or a WillHide that closed an open one.
  let slide: { kind: "show" | "hide"; at: number } | null = null;
  const slideMs: { show: number | null; hide: number | null } = { show: null, hide: null };
  // When the last WillShow / WillHide arrived: the start of that slide.
  let lastWillAt: number | null = null;

  function endSlide(kind: "show" | "hide") {
    const s = slide;
    if (!s || s.kind !== kind) return;
    slide = null;
    const ms = now() - s.at;
    if (ms >= SLIDE_SAMPLE_MIN_MS && ms <= SLIDE_SAMPLE_MAX_MS) slideMs[kind] = ms;
  }

  function setHeight(next: number) {
    if (next === height) return;
    height = next;
    notify(heightListeners, (listener) => listener());
  }

  const handlers: KeyboardEventHandlers = {
    willShow(raw) {
      const next = sanitize(raw);
      lastWillAt = now();
      if (height === 0 && next > 0) slide = { kind: "show", at: lastWillAt };
      else if (next === 0) slide = null;
      lastWill = "show";
      setHeight(next);
      notify(eventListeners, (listener) => listener({ type: "willShow", height: next }));
    },
    willHide() {
      lastWillAt = now();
      slide = height > 0 ? { kind: "hide", at: lastWillAt } : null;
      lastWill = "hide";
      setHeight(0);
      notify(eventListeners, (listener) => listener({ type: "willHide" }));
    },
    didShow(raw) {
      endSlide("show");
      if (lastWill === "hide" || height > 0) return;
      setHeight(sanitize(raw));
    },
    didHide() {
      endSlide("hide");
    },
  };

  function ensureInstalled() {
    if (installed || !source) return;
    installed = true;
    source(handlers);
  }

  return {
    getHeight: () => height,
    subscribe(listener) {
      if (!source) return () => {};
      heightListeners.add(listener);
      ensureInstalled();
      return () => {
        heightListeners.delete(listener);
      };
    },
    subscribeEvents(listener) {
      if (!source) return () => {};
      eventListeners.add(listener);
      ensureInstalled();
      return () => {
        eventListeners.delete(listener);
      };
    },
    getSlideMs: (kind) => slideMs[kind],
    getLastWillAt: () => lastWillAt,
    handlers,
  };
}

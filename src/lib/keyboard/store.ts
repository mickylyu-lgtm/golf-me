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

export type KeyboardWillEvent = { type: "willShow"; height: number } | { type: "willHide" };

export interface KeyboardEventHandlers {
  willShow(height: number): void;
  willHide(): void;
  didShow(height: number): void;
}

// Installs the native listeners. Called at most once per store.
export type KeyboardSource = (handlers: KeyboardEventHandlers) => void;

export interface KeyboardStore {
  getHeight(): number;
  // Height changes (deduplicated). For useSyncExternalStore.
  subscribe(listener: () => void): () => void;
  // Every WillShow / WillHide, as received.
  subscribeEvents(listener: (event: KeyboardWillEvent) => void): () => void;
  // Exposed for tests; production calls go through the installed source.
  handlers: KeyboardEventHandlers;
}

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
export function createKeyboardStore(source: KeyboardSource | null): KeyboardStore {
  let height = 0;
  let lastWill: "show" | "hide" | null = null;
  let installed = false;
  const heightListeners = new Set<() => void>();
  const eventListeners = new Set<(event: KeyboardWillEvent) => void>();

  function setHeight(next: number) {
    if (next === height) return;
    height = next;
    notify(heightListeners, (listener) => listener());
  }

  const handlers: KeyboardEventHandlers = {
    willShow(raw) {
      const next = sanitize(raw);
      lastWill = "show";
      setHeight(next);
      notify(eventListeners, (listener) => listener({ type: "willShow", height: next }));
    },
    willHide() {
      lastWill = "hide";
      setHeight(0);
      notify(eventListeners, (listener) => listener({ type: "willHide" }));
    },
    didShow(raw) {
      if (lastWill === "hide" || height > 0) return;
      setHeight(sanitize(raw));
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
    handlers,
  };
}

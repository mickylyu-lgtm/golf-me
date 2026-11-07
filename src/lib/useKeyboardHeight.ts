import { useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import type { KeyboardInfo } from "@capacitor/keyboard";
import { createKeyboardStore } from "./keyboard/store";
import type { KeyboardSource, KeyboardWillEvent } from "./keyboard/store";

// Returns the on-screen keyboard's real height in px (0 when closed).
// Replaces useKeyboardOpen/useVisualViewportHeight for anything that needs
// to know how much space the keyboard actually takes -- with
// resize:"body" configured (capacitor.config.ts), the plugin's own docs
// say "the viewport does not change," which means window.innerHeight and
// window.visualViewport.height likely never update for the keyboard under
// this mode either (confirmed live: a fix built on visualViewport.height
// still produced broken/blank layout on a real device). keyboardHeight
// from the plugin's keyboardWillShow event payload is real native data
// reported directly by iOS, not something inferred from a viewport value
// this resize mode explicitly doesn't touch.
//
// All readers share one app-wide store (lib/keyboard/store.ts): one set of
// native listeners for the app's life, and a component mounted while the
// keyboard is already open (a sheet opened from a focused comment box)
// reads the real height on its first render instead of 0.
// useSyncExternalStore re-renders every reader synchronously (sync lane,
// before the next paint) on keyboardWillShow/WillHide, so layout effects
// keyed on the height (DirectMessageThread) still run in that same commit.

const capacitorKeyboardSource: KeyboardSource = (handlers) => {
  const add = (registration: Promise<unknown>) => void registration.catch(() => {});
  add(Keyboard.addListener("keyboardWillShow", (info: KeyboardInfo) => handlers.willShow(info.keyboardHeight)));
  add(Keyboard.addListener("keyboardWillHide", () => handlers.willHide()));
  add(Keyboard.addListener("keyboardDidShow", (info: KeyboardInfo) => handlers.didShow(info.keyboardHeight)));
  // Slide timing only (store.ts getSlideMs); never changes the height.
  add(Keyboard.addListener("keyboardDidHide", () => handlers.didHide()));
};

const keyboardStore = createKeyboardStore(Capacitor.isNativePlatform() ? capacitorKeyboardSource : null, () => performance.now());

const getServerHeight = () => 0;

export function useKeyboardHeight(): number {
  return useSyncExternalStore(keyboardStore.subscribe, keyboardStore.getHeight, getServerHeight);
}

// Current height outside React (0 off-native).
export function getKeyboardHeight(): number {
  return keyboardStore.getHeight();
}

// Every keyboardWillShow / keyboardWillHide, as received, for imperative
// app-wide hooks. Returns the unsubscribe. A no-op off-native.
export function subscribeKeyboardEvents(listener: (event: KeyboardWillEvent) => void): () => void {
  return keyboardStore.subscribeEvents(listener);
}

// This device's last measured keyboard slide up / down in ms (WillShow ->
// DidShow, WillHide -> DidHide), or null before one was seen / off-native.
export function getKeyboardSlideMs(kind: "show" | "hide"): number | null {
  return keyboardStore.getSlideMs(kind);
}

// performance.now() of the last keyboardWillShow / WillHide, or null.
export function getKeyboardWillAt(): number | null {
  return keyboardStore.getLastWillAt();
}

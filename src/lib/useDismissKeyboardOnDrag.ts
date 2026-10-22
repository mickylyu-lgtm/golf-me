import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

// iOS-style "dismiss keyboard on drag" for the native app (Micky,
// 2026-10-22: typing in Find Golfers' search and then scrolling the
// results left the keyboard up, hiding the bottom of the list). Mounted
// once in App.tsx's AppGate.
//
// Rules:
// - Native only, and only while the Keyboard plugin reports the keyboard
//   open (the same keyboardWillShow/keyboardWillHide events
//   useKeyboardHeight uses). Web/PWA keeps the browser's own behavior
//   (iOS Safari has its own Done button and visualViewport handling).
// - Only when a text field (input/textarea/contenteditable) has focus.
// - Only a real finger drag: a single touch that moves more than
//   DRAG_THRESHOLD_PX, mostly vertically. Taps never move that far, and
//   programmatic scrolls (revealFocusedField, docking restores) produce no
//   touch events at all.
// - Never when the drag starts inside the focused field itself (moving the
//   caret, scrolling a long textarea) or while text is selected.
// - Never inside an element marked data-keyboard-drag-dismiss="off" (see
//   GroupChat, CourseAutocomplete's suggestion panel), and never on the DM
//   thread (frozen; excluded here by route so its file is untouched).
//
// Dismissal is a plain blur() of the focused field -- the same thing a tap
// outside does, and what CourseAutocomplete already uses -- so every
// component's existing keyboard-close path runs exactly as it does today.
// Listeners are passive and never call preventDefault, so the drag still
// scrolls normally.

const DRAG_THRESHOLD_PX = 10;
const OPT_OUT_SELECTOR = '[data-keyboard-drag-dismiss="off"]';
const DM_THREAD_PATH = /^\/messages\/[^/]+\/?$/;
const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

let lastDragDismissAt = 0;

// True for a short while after this hook closed the keyboard. Lets a
// component that normally restores its pre-keyboard scroll position on
// close (KeyboardAwareModal) skip that restore, which would otherwise
// fight the very drag that closed the keyboard.
export function wasKeyboardDismissedByDrag(withinMs = 1500): boolean {
  return Date.now() - lastDragDismissAt < withinMs;
}

function focusedTextField(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  if (active instanceof HTMLTextAreaElement) return active;
  if (active instanceof HTMLInputElement) return NON_TEXT_INPUT_TYPES.has(active.type) ? null : active;
  return active.isContentEditable ? active : null;
}

function hasTextSelection(field: HTMLElement): boolean {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    try {
      if (field.selectionStart !== null && field.selectionStart !== field.selectionEnd) return true;
    } catch {
      // Some input types (e.g. email/number) throw on selectionStart.
    }
  }
  const selection = document.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
}

export function useDismissKeyboardOnDrag() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let keyboardOpen = false;
    const showListener = Keyboard.addListener("keyboardWillShow", () => {
      keyboardOpen = true;
    });
    const hideListener = Keyboard.addListener("keyboardWillHide", () => {
      keyboardOpen = false;
    });

    // Per-gesture state; null when this gesture is not a candidate.
    let start: { x: number; y: number; field: HTMLElement } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      start = null;
      if (!keyboardOpen || e.touches.length !== 1) return;
      const field = focusedTextField();
      if (!field) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (field.contains(target)) return;
      if (target instanceof Element && target.closest(OPT_OUT_SELECTOR)) return;
      if (DM_THREAD_PATH.test(window.location.pathname)) return;
      const touch = e.touches[0];
      start = { x: touch.clientX, y: touch.clientY, field };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1) {
        start = null;
        return;
      }
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - start.x);
      const dy = Math.abs(touch.clientY - start.y);
      if (dy < DRAG_THRESHOLD_PX || dy < dx) return;
      const { field } = start;
      start = null;
      // Focus may have moved or the keyboard closed mid-gesture.
      if (!keyboardOpen || document.activeElement !== field || hasTextSelection(field)) return;
      lastDragDismissAt = Date.now();
      field.blur();
    };

    const onTouchEnd = () => {
      start = null;
    };

    const options: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener("touchstart", onTouchStart, options);
    document.addEventListener("touchmove", onTouchMove, options);
    document.addEventListener("touchend", onTouchEnd, options);
    document.addEventListener("touchcancel", onTouchEnd, options);
    return () => {
      void showListener.then((l) => l.remove());
      void hideListener.then((l) => l.remove());
      document.removeEventListener("touchstart", onTouchStart, options);
      document.removeEventListener("touchmove", onTouchMove, options);
      document.removeEventListener("touchend", onTouchEnd, options);
      document.removeEventListener("touchcancel", onTouchEnd, options);
    };
  }, []);
}

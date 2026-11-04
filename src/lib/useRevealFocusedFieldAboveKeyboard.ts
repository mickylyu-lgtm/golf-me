import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { KEYBOARD_GAP_PX, KEYBOARD_REVEAL_OPT_OUT_SELECTOR, isDmThreadPath, textEntryElement } from "./keyboard/fields";
import { getKeyboardHeight, subscribeKeyboardEvents } from "./useKeyboardHeight";

// iOS app: keep a focused text field on a normal page above the keyboard
// (Micky, 2026-10-23: Host a Round's Notes textarea opened the keyboard but
// stayed hidden behind it, only its label showing). Mounted once in
// App.tsx's AppGate.
//
// Why nothing did this before: with capacitor.config.ts's Keyboard
// resize:"body", the plugin removes WKWebView's own keyboard observers (so
// WebKit never learns the keyboard's size and never scrolls the field into
// view) and only sets document.body's inline height. window.innerHeight,
// 100vh and position:fixed stay full-screen and body's content simply
// overflows it, so the document's scroll range doesn't grow either: a field
// in the lower part of a short page has nowhere to scroll to.
//
// What this does:
// - On focus of a text field, an invisible absolutely-positioned spacer is
//   hung from the top of the document, tall enough that the page can scroll
//   the field all the way up (absolutely-positioned boxes count toward the
//   scrollable area without moving anything in the layout). It goes in
//   before the keyboard starts opening, so the room already exists when the
//   scroll happens.
// - When the keyboard opens (and when focus moves to another field while
//   it's open), the window is scrolled just enough that the field's bottom
//   sits a gap above the keyboard, never pushing its top under the sticky
//   app header.
// - When the keyboard closes, the spacer is removed and the page keeps
//   whatever position is still valid (like Safari; nothing is yanked back).
//
// Skipped (they own their keyboard layout already, or the window isn't
// what scrolls them):
// - Anything inside [data-keyboard-reveal="off"] (PostDetail's docking
//   comment composer, round group chat, Host a Round's course search).
// - The DM thread, by route, so its frozen file is untouched.
// - Fields inside a position:fixed container (sheets/modals -- the
//   keyboardAware Modal lifts itself above the keyboard and scrolls its own
//   scroller) or inside their own scrolling container (ProfileSetup).
// - While the page is scroll-locked (document.body overflow hidden): some
//   component has taken over the keyboard layout.
// Web/PWA: never runs; the browser handles the keyboard itself.

// Keyboard events come from the app-wide keyboard store
// (lib/useKeyboardHeight.ts): every keyboardWillShow / keyboardWillHide,
// exactly as the plugin sends them.

const GAP_PX = KEYBOARD_GAP_PX;
const textField = textEntryElement;

// The field scrolls with the window (not a sheet, not its own scroller).
function scrollsWithWindow(field: HTMLElement): boolean {
  if (field.closest(KEYBOARD_REVEAL_OPT_OUT_SELECTOR)) return false;
  if (isDmThreadPath(window.location.pathname)) return false;
  if (document.body.style.overflow === "hidden") return false;
  for (let el: HTMLElement | null = field.parentElement; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.position === "fixed") return false;
    if ((style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) return false;
  }
  return true;
}

export function useRevealFocusedFieldAboveKeyboard() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let keyboardHeight = getKeyboardHeight();
    let spacer: HTMLDivElement | null = null;
    let frame = 0;

    function ensureRoom(field: HTMLElement) {
      // Enough for the field's bottom to reach the top of the screen, which
      // covers any keyboard height.
      const needed = Math.ceil(field.getBoundingClientRect().bottom + window.scrollY + window.innerHeight);
      if (!spacer) {
        spacer = document.createElement("div");
        spacer.setAttribute("aria-hidden", "true");
        spacer.style.cssText = "position:absolute;top:0;left:0;width:1px;visibility:hidden;pointer-events:none;";
        document.body.appendChild(spacer);
      }
      if ((parseFloat(spacer.style.height) || 0) < needed) spacer.style.height = `${needed}px`;
    }

    function removeRoom() {
      spacer?.remove();
      spacer = null;
    }

    function reveal() {
      const field = textField(document.activeElement);
      if (!field || keyboardHeight <= 0 || !scrollsWithWindow(field)) return;
      ensureRoom(field);
      const rect = field.getBoundingClientRect();
      const visibleBottom = window.innerHeight - keyboardHeight - GAP_PX;
      if (rect.bottom <= visibleBottom) return;
      const headerBottom = Math.max(document.querySelector("header")?.getBoundingClientRect().bottom ?? 0, 0);
      const delta = Math.min(rect.bottom - visibleBottom, rect.top - (headerBottom + GAP_PX));
      if (delta > 0) window.scrollTo(0, Math.round(window.scrollY + delta));
    }

    function scheduleReveal() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    }

    const onFocusIn = (e: FocusEvent) => {
      const field = textField(e.target instanceof Element ? e.target : null);
      if (!field) return;
      // Scheduled before the check (reveal() checks again a frame later):
      // focus moving from a docked composer to this field with the keyboard
      // up undocks it, and its page lock is only released after this runs.
      if (keyboardHeight > 0) scheduleReveal();
      if (!scrollsWithWindow(field)) return;
      ensureRoom(field);
    };

    const unsubscribeKeyboard = subscribeKeyboardEvents((event) => {
      if (event.type === "willShow") {
        keyboardHeight = event.height;
        scheduleReveal();
      } else {
        keyboardHeight = 0;
        cancelAnimationFrame(frame);
        removeRoom();
      }
    });

    // A blur without the keyboard closing (e.g. tapping a button) also
    // drops the room once focus has really left every text field.
    const onFocusOut = () => {
      window.setTimeout(() => {
        if (keyboardHeight === 0 && !textField(document.activeElement)) removeRoom();
      }, 0);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      unsubscribeKeyboard();
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      cancelAnimationFrame(frame);
      removeRoom();
    };
  }, []);
}

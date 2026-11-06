import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { KEYBOARD_GAP_PX, KEYBOARD_REVEAL_OPT_OUT_SELECTOR, isDmThreadPath, textEntryElement } from "./keyboard/fields";
import { animateWindowTo, cancelWindowAnimation, keyboardMotionActive } from "./keyboard/smoothScroll";
import { pageRevealDelta } from "./minimalReveal";
import { getKeyboardHeight, subscribeKeyboardEvents } from "./useKeyboardHeight";
import { wasKeyboardDismissedByDrag } from "./useDismissKeyboardOnDrag";

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
// Motion (lib/keyboard/smoothScroll.ts, Micky 2026-11-06 "feels abrupt"):
// both moves end exactly where they always did, but travel there in
// 140-260 ms instead of one frame, alongside the keyboard's own slide.
// - Opening: the same smallest scroll as before (lib/minimalReveal
//   pageRevealDelta). It stops if focus leaves the field, the keyboard
//   closes, the route changes, or the golfer touches the screen; a repeat
//   reveal for the same field coalesces into the running motion.
// - Closing: if the page sits beyond its natural end (it used the spacer's
//   room), it glides back to that end -- the very position the browser used
//   to snap it to when the spacer went -- and only then drops the spacer.
//   Not after a drag-dismiss (the finger is driving) and not with the
//   motion switched off; a keyboard reopening meanwhile keeps the spacer.
// Reduced motion / switch off: one-frame writes, as before.
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
    // The closing glide still needs the spacer's room until it ends.
    let settling = false;

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

    // Keyboard closed (willHide). Without motion (switched off, reduced
    // motion) or after a drag-dismiss: drop the spacer now, as always.
    // Otherwise measure on the next frame -- after React has committed the
    // closed-keyboard layout (CourseAutocomplete's own scroll room inside
    // #root goes then), while this spacer still holds the page -- and glide
    // back to the page's own end before dropping it.
    function onKeyboardClosed() {
      if (!spacer || !keyboardMotionActive() || wasKeyboardDismissedByDrag()) {
        settling = false;
        cancelWindowAnimation();
        removeRoom();
        return;
      }
      settling = true;
      frame = requestAnimationFrame(settleThenRemoveRoom);
    }

    function settleThenRemoveRoom() {
      if (keyboardHeight > 0 || !spacer) {
        settling = false;
        return;
      }
      const root = document.getElementById("root");
      // The page's own height: everything but the spacer (a child of body)
      // renders inside #root; sheets are portaled but position:fixed.
      const naturalMax = root ? Math.max(0, root.scrollHeight - window.innerHeight) : null;
      if (naturalMax === null || window.scrollY <= naturalMax + 1 || document.body.style.overflow === "hidden") {
        settling = false;
        cancelWindowAnimation();
        removeRoom();
        return;
      }
      const room = spacer;
      animateWindowTo(naturalMax, {
        guard: () => keyboardHeight === 0,
        onDone: () => {
          settling = false;
          // Reopened meanwhile: that keyboard's reveal needs the room.
          if (spacer === room && keyboardHeight === 0) removeRoom();
        },
      });
    }

    function reveal() {
      const field = textField(document.activeElement);
      if (!field || keyboardHeight <= 0 || !scrollsWithWindow(field)) return;
      ensureRoom(field);
      const rect = field.getBoundingClientRect();
      const headerBottom = Math.max(document.querySelector("header")?.getBoundingClientRect().bottom ?? 0, 0);
      const delta = pageRevealDelta({
        fieldTop: rect.top,
        fieldBottom: rect.bottom,
        visibleTop: headerBottom + GAP_PX,
        visibleBottom: window.innerHeight - keyboardHeight - GAP_PX,
      });
      if (delta > 0) {
        animateWindowTo(Math.round(window.scrollY + delta), {
          guard: () => keyboardHeight > 0 && document.activeElement === field,
        });
      }
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
        // Reopened before a closing glide began: it never will (its frame is
        // replaced below); a running one stops on its own guard.
        settling = false;
        scheduleReveal();
      } else {
        keyboardHeight = 0;
        cancelAnimationFrame(frame);
        onKeyboardClosed();
      }
    });

    // A blur without the keyboard closing (e.g. tapping a button) also
    // drops the room once focus has really left every text field.
    const onFocusOut = () => {
      window.setTimeout(() => {
        if (keyboardHeight === 0 && !settling && !textField(document.activeElement)) removeRoom();
      }, 0);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      unsubscribeKeyboard();
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      cancelAnimationFrame(frame);
      cancelWindowAnimation();
      removeRoom();
    };
  }, []);
}

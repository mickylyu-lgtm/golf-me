import { KEYBOARD_GAP_PX } from "./keyboard/fields.ts";
import { animateScrollTop } from "./keyboard/smoothScroll.ts";
import { scrollerRevealDelta } from "./minimalReveal.ts";

// Gap kept between the focused field / sheet top and the screen edges.
// Defined once in lib/keyboard/fields.ts; re-exported here so existing
// imports keep working.
export { KEYBOARD_GAP_PX };

// Scrolls only `scroller` (never the window) so the focused element inside
// it sits at least KEYBOARD_GAP_PX inside its visible edges. Shared by
// KeyboardAwareModal (components/ui/Modal.tsx) and full-screen pages with
// their own scroller (ProfileSetup). Same distance as ever, travelled over
// a short motion (lib/keyboard/smoothScroll.ts; instant with reduced
// motion). It stops if the field loses focus, the scroller leaves the page,
// or anything else sets the scroller's position meanwhile (the sheet's own
// restore when the keyboard closes always wins).
export function revealFocusedField(scroller: HTMLElement) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !scroller.contains(active)) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const fieldRect = active.getBoundingClientRect();
  const delta = scrollerRevealDelta({
    fieldTop: fieldRect.top,
    fieldBottom: fieldRect.bottom,
    scrollerTop: scrollerRect.top,
    scrollerBottom: scrollerRect.bottom,
    gap: KEYBOARD_GAP_PX,
  });
  if (delta === 0) return;
  animateScrollTop(scroller, scroller.scrollTop + delta, {
    guard: () => document.activeElement === active,
  });
}

import { KEYBOARD_GAP_PX } from "./keyboard/fields.ts";

// Gap kept between the focused field / sheet top and the screen edges.
// Defined once in lib/keyboard/fields.ts; re-exported here so existing
// imports keep working.
export { KEYBOARD_GAP_PX };

// Scrolls only `scroller` (never the window) so the focused element inside
// it sits at least KEYBOARD_GAP_PX inside its visible edges. Shared by
// KeyboardAwareModal (components/ui/Modal.tsx) and full-screen pages with
// their own scroller (ProfileSetup).
export function revealFocusedField(scroller: HTMLElement) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !scroller.contains(active)) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const fieldRect = active.getBoundingClientRect();
  const overflowBelow = fieldRect.bottom - (scrollerRect.bottom - KEYBOARD_GAP_PX);
  const overflowAbove = scrollerRect.top + KEYBOARD_GAP_PX - fieldRect.top;
  if (overflowBelow > 0) scroller.scrollTop += overflowBelow;
  else if (overflowAbove > 0) scroller.scrollTop -= overflowAbove;
}

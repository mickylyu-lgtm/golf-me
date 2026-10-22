// Gap kept between the focused field / sheet top and the screen edges.
export const KEYBOARD_GAP_PX = 12;

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

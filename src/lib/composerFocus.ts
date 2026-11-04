// Which field the iOS keyboard was opened for. PostDetail's comment box
// and the round chat dock themselves above the keyboard (and lock the
// page), but the plugin's keyboard events don't say which field opened it:
// docking on "any keyboard" also docked them when the keyboard was for an
// inline reply or a sheet's textarea, locking the page so that field could
// end up covered. A composer now docks only while it owns the focus:
// - focus lands inside the composer -> it owns the keyboard;
// - focus lands on another text field -> it doesn't;
// - focus lands on anything else (a button, nothing) -> unchanged, so
//   tapping Post/Send or the keyboard closing behaves exactly as before.
// No React imports, so tests/composerFocus.test.ts runs under plain node.

import { isTextEntryElement } from "./keyboard/fields.ts";
import type { ElementLike } from "./keyboard/fields.ts";

// Fields that bring up the keyboard: one rule for every keyboard hook
// (lib/keyboard/fields.ts), re-exported so existing imports keep working.
export { isTextEntryElement };

export function nextComposerOwnsFocus(owns: boolean, focus: { insideComposer: boolean; isTextField: boolean }): boolean {
  if (focus.insideComposer) return true;
  if (focus.isTextField) return false;
  return owns;
}

// Undocking because another field took the focus with the keyboard still
// up: that field is revealed on its own (useRevealFocusedFieldAboveKeyboard),
// so the composer must not scroll the page back to where it was.
export function focusMovedToOtherField(active: (ElementLike & object) | null | undefined, insideComposer: boolean): boolean {
  return !insideComposer && isTextEntryElement(active);
}

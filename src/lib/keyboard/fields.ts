// Shared vocabulary for the iOS keyboard code: which elements bring up the
// keyboard, the gap kept above it, and the opt-outs. No React/Capacitor
// imports and no DOM access at import time, so tests run under plain node.

// Gap kept between the focused field / sheet top and the keyboard or
// screen edges (Modal's sheet, revealFocusedField, the page-level reveal,
// CourseAutocomplete's suggestion panel).
export const KEYBOARD_GAP_PX = 12;

// Input types that never bring up the text keyboard. One list for every
// keyboard hook (it used to be three copies). The date/time types open
// iOS's picker, not the keyboard: drag-to-dismiss used to count them as
// text fields, but it only acts while the keyboard is open, and focusing a
// picker closes the keyboard, so excluding them changes nothing there.
const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "color", "date", "datetime-local", "file", "hidden", "image", "month", "radio", "range", "reset", "submit", "time", "week"]);

export interface ElementLike {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
}

// Fields that bring up the keyboard: textarea, text-like inputs (an input
// with no type is text), contenteditable.
export function isTextEntryElement(el: ElementLike | null | undefined): boolean {
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((el.type || "text").toLowerCase());
  return el.isContentEditable === true;
}

// DOM form: the element itself when it is an HTML text-entry field.
export function textEntryElement(el: Element | null | undefined): HTMLElement | null {
  if (typeof HTMLElement === "undefined" || !(el instanceof HTMLElement)) return null;
  return isTextEntryElement(el) ? el : null;
}

// The DM thread owns its keyboard layout (frozen file); the global hooks
// exclude it by route so that file is never touched.
export const DM_THREAD_PATH = /^\/messages\/[^/]+\/?$/;
export function isDmThreadPath(pathname: string): boolean {
  return DM_THREAD_PATH.test(pathname);
}

// Containers that handle their own keyboard reveal / drag behaviour.
export const KEYBOARD_REVEAL_OPT_OUT_SELECTOR = '[data-keyboard-reveal="off"]';
export const KEYBOARD_DRAG_DISMISS_OPT_OUT_SELECTOR = '[data-keyboard-drag-dismiss="off"]';
// A field that borrows the keyboard for a moment over a chat (the reaction
// emoji picker's search, which hands the focus back when it closes): a
// docked composer keeps owning the keyboard meanwhile (useComposerFocus).
export const KEEPS_COMPOSER_FOCUS_SELECTOR = "[data-keeps-composer-focus]";

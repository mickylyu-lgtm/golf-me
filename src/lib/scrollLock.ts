// One page scroll lock shared by everything that needs the page to stay
// still (keyboard-aware sheets, docked chat/comment composers, the full-
// screen viewer, Coach Replay fullscreen). Each caller used to save
// body.style.overflow, set "hidden", and restore its saved value on
// release, which only works when locks are released in reverse order: a
// dock releasing while a sheet was still open unlocked the page under the
// sheet, and the sheet then "restored" hidden, leaving the page stuck.
// Now locks are counted: the page is hidden while at least one is held and
// gets its original value back when the last one is released, in any order.
// No React imports, so tests/scrollLock.test.ts runs under plain node.

interface StyleTarget {
  style: { overflow: string };
}

const holders = new Set<symbol>();
let original: string | null = null;

function target(): StyleTarget | null {
  return typeof document === "undefined" ? null : document.body;
}

// Takes a lock; returns its release function (safe to call more than once).
export function lockPageScroll(el: StyleTarget | null = target()): () => void {
  const token = Symbol("scroll-lock");
  if (el && holders.size === 0) {
    original = el.style.overflow;
    el.style.overflow = "hidden";
  }
  holders.add(token);
  return () => {
    if (!holders.delete(token)) return;
    if (el && holders.size === 0) {
      el.style.overflow = original ?? "";
      original = null;
    }
  };
}

export function isPageScrollLocked(): boolean {
  return holders.size > 0;
}

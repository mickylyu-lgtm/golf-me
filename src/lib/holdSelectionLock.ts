// While a DM bubble is being held (useMessageLongPress) and while its focus
// overlay is up (MessageActionsMenu), nothing on the page may become a text
// selection. On iPhone a hold that isn't on a text field otherwise turns into
// WebKit's own select-the-page gesture: the whole screen goes blue and a
// selection handle is left behind (seen on the send button) after the menu
// closes (Micky, 2026-11-05). Counted, so the press and the overlay can hand
// over without a gap; text fields keep normal selection (index.css).

const LOCK_CLASS = "gm-hold-lock";
let count = 0;

function clearPageSelection() {
  if (typeof window === "undefined") return;
  const active = document.activeElement;
  // A focused text field keeps its own caret/selection.
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
  try {
    window.getSelection()?.removeAllRanges();
  } catch {
    // Never let this break the gesture.
  }
}

export function lockHoldSelection(): () => void {
  if (typeof document === "undefined") return () => {};
  count += 1;
  if (count === 1) document.documentElement.classList.add(LOCK_CLASS);
  clearPageSelection();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    clearPageSelection();
    if (count === 0) document.documentElement.classList.remove(LOCK_CLASS);
  };
}

// "Is something already covering the screen?" for onboarding prompts that
// must never stack (first-round hosting popup vs. the push pre-permission
// prompt, the tutorial, any open Modal/ConfirmDialog/sheet, the fullscreen
// media viewer, the native launch overlay).
//
// Two signals:
//   * the DOM: every Modal (ModalFrame), the tutorial overlay, the media
//     viewer and the push prompt render role="dialog" aria-modal="true";
//     EntryOverlay carries data-blocking-overlay while it's up;
//   * claims: an overlay that is still deciding whether to show (the push
//     prompt's async permission check) claims the screen first, so a prompt
//     waiting its turn doesn't appear in that gap and then get covered.

const claims = new Set<string>();

export function claimOverlay(key: string): void {
  claims.add(key);
}

export function releaseOverlay(key: string): void {
  claims.delete(key);
}

export function isBlockingOverlayOpen(exceptKey?: string): boolean {
  for (const key of claims) if (key !== exceptKey) return true;
  if (typeof document === "undefined") return false;
  return document.querySelector('[aria-modal="true"], [data-blocking-overlay]') !== null;
}

// The golfer is mid-action if they're typing somewhere.
export function isUserTyping(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

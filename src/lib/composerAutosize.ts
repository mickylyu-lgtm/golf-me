// ChatComposer's auto-growing textarea: how tall it should be for its
// content. No React or DOM imports, so tests/composerAutosize.test.ts runs
// under plain node.
//
// The content height is measured on a hidden mirror textarea, never on the
// real one. The old way (real textarea: height = "auto", read scrollHeight,
// set the height back) collapsed the composer to one line inside every
// keystroke. WebKit (iPhone Safari and the WKWebView app) clamps scroll
// positions at that forced layout: the message list above (which grew for
// that instant) lost up to the composer's extra height of scrollTop, and
// the textarea itself was thrown to its last line once capped. Nothing
// changed size overall, so the list's ResizeObserver never re-pinned it:
// the chat jumped while typing a long message.

// Grows line by line up to this many lines, then scrolls inside.
export const COMPOSER_MAX_LINES = 5;

export interface ComposerMetrics {
  // The mirror's scrollHeight: content + vertical padding.
  contentHeight: number;
  // Computed line-height in px.
  lineHeight: number;
  // Vertical padding (top + bottom) in px.
  paddingY: number;
  // Vertical border (top + bottom) in px; the textarea is border-box.
  borderY: number;
}

// The border-box height for the textarea: never less than one line, never
// more than COMPOSER_MAX_LINES lines. Whole pixels, rounded up, so a
// fractional line-height (e.g. 16px x 1.375) never leaves a 1px scroll.
export function composerTextareaHeight(m: ComposerMetrics, maxLines = COMPOSER_MAX_LINES): number {
  const line = Number.isFinite(m.lineHeight) && m.lineHeight > 0 ? m.lineHeight : 22;
  const chrome = (Number.isFinite(m.paddingY) ? m.paddingY : 0) + (Number.isFinite(m.borderY) ? m.borderY : 0);
  const min = Math.ceil(line + chrome);
  const max = Math.ceil(line * maxLines + chrome);
  const content = Number.isFinite(m.contentHeight) ? Math.ceil(m.contentHeight + (Number.isFinite(m.borderY) ? m.borderY : 0)) : min;
  return Math.min(Math.max(content, min), max);
}

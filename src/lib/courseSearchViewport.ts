// Inline course search only. All dimensions are layout-viewport CSS pixels.
// Native resize:body and WebKit visualViewport can describe the same keyboard.
export function courseSearchViewport(g: {
  height: number; keyboardHeight: number; viewportTop: number;
  viewportHeight: number; headerBottom: number;
}) {
  return {
    top: Math.max(0, g.headerBottom, g.viewportTop) + 12,
    bottom: Math.max(0, Math.min(g.height - Math.max(0, g.keyboardHeight),
      g.viewportTop + g.viewportHeight) - 12),
  };
}

export function courseSearchListHeight(listTop: number, visibleBottom: number) {
  return Math.max(0, Math.min(256, Math.floor(visibleBottom - listTop)));
}

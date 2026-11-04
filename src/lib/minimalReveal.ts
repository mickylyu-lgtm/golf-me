// How far to scroll the page so a focused field (plus room under it for its
// first suggestions) sits inside the visible band between the app header
// and the keyboard: the smallest move that does it, and none at all when it
// already fits. The Host a Round course field used to be scrolled up under
// the header on every focus, scrolled again 600 ms later, and put back on
// close (Micky, 2026-11-04: "the course search jumps toward the top").
// Viewport px in, page px delta out (positive = scroll down). No React or
// DOM imports, so tests/minimalReveal.test.ts runs under plain node.

export interface RevealGeometry {
  fieldTop: number;
  fieldBottom: number;
  // Wanted space below the field (suggestions), best effort.
  room: number;
  visibleTop: number;
  visibleBottom: number;
}

export function revealDelta(g: RevealGeometry): number {
  // Field above the band (behind the header): bring its top down into view.
  if (g.fieldTop < g.visibleTop) return Math.round(g.fieldTop - g.visibleTop);
  const wantedBottom = g.fieldBottom + Math.max(0, g.room);
  if (wantedBottom <= g.visibleBottom) return 0;
  // Scroll the field up just enough to show the room below it, but never so
  // far that the field itself goes behind the header.
  const needed = wantedBottom - g.visibleBottom;
  const allowed = Math.max(0, g.fieldTop - g.visibleTop);
  return Math.round(Math.min(needed, allowed));
}

// The "focus" a DM bubble gets while its hold menu is open (Instagram /
// Telegram style): the thread dims and blurs, a COPY of the held bubble is
// drawn above the dim, gently enlarged, and the reactions + actions menu sit
// above or below it. Pure rules only (no React/DOM), so node tests run them;
// the component is components/chat/MessageActionsMenu.tsx, the press cue is
// lib/useMessageLongPress.ts.
//
// Why a copy at the measured rect, not the real bubble lifted: the real
// bubble lives inside the thread's scroll container (overflow clipped,
// inside the swipe-to-reveal rows wrapper that gets its own transform), so
// raising it above a page-level backdrop would mean re-parenting it or
// changing z-index/transform on its ancestors, and enlarging it near the
// list's edges would be clipped. A fixed-position copy touches none of that:
// the list's scroll position, size and stacking stay exactly as they are,
// and the real bubble only gets opacity 0 (no layout change) while the copy
// stands in for it.

// While the finger is down: the bubble eases down to this scale, starting
// after a short delay (so a tap or the start of a scroll doesn't flicker)
// and arriving as the menu opens (LONG_PRESS_MS in lib/messageLongPress.ts).
export const PRESS_SCALE = 0.97;
export const PRESS_FEEDBACK_DELAY_MS = 100;

// The copy's enlargement while the menu is open, and how long closing takes.
export const FOCUS_SCALE = 1.05;
export const FOCUS_EXIT_MS = 150;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FocusLayoutInput {
  // The bubble's own (unscaled) box, in viewport coordinates.
  bubble: Rect;
  // How far its reaction pill hangs below that box (unscaled px; it is
  // drawn with the copy, so the menu must clear it too).
  overhangBottom?: number;
  menu: { width: number; height: number };
  // The visible area (visualViewport), already inset by the safe areas.
  viewport: { top: number; bottom: number; left: number; right: number };
  // My message: the menu lines up with the bubble's right edge.
  alignRight: boolean;
  reducedMotion: boolean;
  scale?: number;
  // Distance kept from the viewport edges, and between bubble and menu.
  margin?: number;
  gap?: number;
}

export interface FocusLayout {
  // Transform for the copy, about its centre: translate(dx, dy) scale(scale).
  scale: number;
  dx: number;
  dy: number;
  menuTop: number;
  menuLeft: number;
  placement: "above" | "below";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

// Shift needed to bring [start, start+size] inside [lo, hi]; 0 when it is
// already inside, or when it can't fit at all (never pushed further out).
function shiftInto(start: number, size: number, lo: number, hi: number): number {
  if (size > hi - lo) return 0;
  if (start < lo) return lo - start;
  if (start + size > hi) return hi - (start + size);
  return 0;
}

// Never shrinks (scale >= 1) and never enlarges past what fits on screen.
export function focusScale(bubble: { width: number; height: number }, room: { width: number; height: number }, target = FOCUS_SCALE): number {
  if (!(bubble.width > 0) || !(bubble.height > 0)) return 1;
  const fit = Math.min(room.width / bubble.width, room.height / bubble.height);
  return Math.max(1, Math.min(target, fit));
}

export function focusLayout(input: FocusLayoutInput): FocusLayout {
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 8;
  const { bubble, menu, viewport, alignRight } = input;
  const overhang = Math.max(0, input.overhangBottom ?? 0);
  const minTop = viewport.top + margin;
  const maxBottom = viewport.bottom - margin;
  const minLeft = viewport.left + margin;
  const maxRight = viewport.right - margin;

  const menuLeftFor = (left: number, width: number) =>
    clamp(alignRight ? left + width - menu.width : left, minLeft, Math.max(minLeft, maxRight - menu.width));

  // Reduced motion: no enlargement and no movement, the menu goes where it
  // always went (above, else below, clamped), possibly over a tall bubble.
  if (input.reducedMotion) {
    const above = bubble.top - gap - menu.height;
    const placement: "above" | "below" = above >= minTop ? "above" : "below";
    const menuTop =
      placement === "above" ? above : clamp(bubble.top + bubble.height + overhang + gap, minTop, Math.max(minTop, maxBottom - menu.height));
    return { scale: 1, dx: 0, dy: 0, menuTop, menuLeft: menuLeftFor(bubble.left, bubble.width), placement };
  }

  const cx = bubble.left + bubble.width / 2;
  const cy = bubble.top + bubble.height / 2;
  const room = { width: maxRight - minLeft, height: maxBottom - minTop };
  const target = input.scale ?? FOCUS_SCALE;

  // Try the full scale first; if bubble + menu only fit unscaled, drop to 1.
  const footprint = { width: bubble.width, height: bubble.height + overhang };
  for (const scale of target > 1 ? [focusScale(footprint, room, target), 1] : [1]) {
    const w = bubble.width * scale;
    const h = bubble.height * scale;
    // Scaled bubble + its pill: what has to stay on screen and clear the menu.
    const fh = h + overhang * scale;
    const top = cy - h / 2;
    const left = cx - w / 2;
    const dx = shiftInto(left, w, minLeft, maxRight);

    // Where the (scaled) bubble's top may go so the menu fits on that side;
    // the move is the smallest one that makes room. Ties go above.
    const options: { placement: "above" | "below"; top: number }[] = [];
    const aboveLo = minTop + menu.height + gap;
    const aboveHi = maxBottom - fh;
    if (aboveLo <= aboveHi) options.push({ placement: "above", top: clamp(top, aboveLo, aboveHi) });
    const belowLo = minTop;
    const belowHi = maxBottom - fh - gap - menu.height;
    if (belowLo <= belowHi) options.push({ placement: "below", top: clamp(top, belowLo, belowHi) });
    if (options.length === 0) continue;
    const best = options.reduce((a, b) => (Math.abs(b.top - top) < Math.abs(a.top - top) ? b : a));
    const menuTop = best.placement === "above" ? best.top - gap - menu.height : best.top + fh + gap;
    return { scale, dx, dy: best.top - top, menuTop, menuLeft: menuLeftFor(left + dx, w), placement: best.placement };
  }

  // Bubble + menu taller than the screen (a very long message): the bubble
  // stays where it is, unscaled; the menu goes above it if there's room,
  // else below, clamped on screen (it may then cover part of the bubble).
  const above = bubble.top - gap - menu.height;
  const placement: "above" | "below" = above >= minTop ? "above" : "below";
  const menuTop =
    placement === "above" ? above : clamp(bubble.top + bubble.height + overhang + gap, minTop, Math.max(minTop, maxBottom - menu.height));
  return { scale: 1, dx: 0, dy: 0, menuTop, menuLeft: menuLeftFor(bubble.left, bubble.width), placement };
}

// How far the bubble's descendants (its reaction pill) reach below its own
// box, from on-screen bottoms divided by the scale it's drawn at.
export function overhangBelow(boxBottom: number, childBottoms: readonly number[], drawnScale = 1): number {
  const lowest = Math.max(boxBottom, ...childBottoms.filter(Number.isFinite));
  return drawnScale > 0 ? (lowest - boxBottom) / drawnScale : 0;
}

// The scale the bubble is drawn at right now (mid press animation), from
// its on-screen width over its own width; anything odd reads as 1.
export function currentPressScale(onScreenWidth: number, ownWidth: number): number {
  if (!(onScreenWidth > 0) || !(ownWidth > 0)) return 1;
  const s = onScreenWidth / ownWidth;
  return s >= PRESS_SCALE - 0.01 && s <= 1 ? s : 1;
}

// Keeps a closed overlay mounted for its exit animation. `key` changes on
// every new open (also one that interrupts an exit), so the overlay
// remounts instead of resuming a half-finished close.
export interface Presence<T> {
  value: T | null;
  exiting: boolean;
  key: number;
}

export function presenceFor<T>(prev: Presence<T>, next: T | null): Presence<T> {
  if (next !== null) return prev.value === next && !prev.exiting ? prev : { value: next, exiting: false, key: prev.key + 1 };
  if (prev.value !== null && !prev.exiting) return { ...prev, exiting: true };
  return prev;
}

export function presenceExited<T>(prev: Presence<T>): Presence<T> {
  return prev.exiting ? { value: null, exiting: false, key: prev.key } : prev;
}

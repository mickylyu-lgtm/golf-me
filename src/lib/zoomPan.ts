// Pure math for the fullscreen photo viewer's pinch / pan / double-tap zoom
// (components/community/ZoomableImage). No DOM here so it can be unit tested
// (tests/zoomPan.test.ts).
//
// Coordinate model: the <img> element fills the viewport box and is drawn
// with object-fit: contain, transform-origin at its centre. A transform is
// { scale, x, y } meaning `translate3d(x, y, 0) scale(scale)`. Points are
// measured from the CENTRE of the viewport box, so a point p on the picture
// ends up on screen at p * scale + (x, y).

export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The viewport box, and the picture's drawn size inside it at 1x (its
 * object-fit: contain size, usually smaller than the box on one axis). */
export interface ZoomDims {
  viewW: number;
  viewH: number;
  contentW: number;
  contentH: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;

export const IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 };

/** object-fit: contain size of a natural-size picture in a box. Falls back to
 * the box itself while the picture's natural size is still unknown. */
export function containSize(naturalW: number, naturalH: number, viewW: number, viewH: number): { w: number; h: number } {
  if (!(naturalW > 0) || !(naturalH > 0) || !(viewW > 0) || !(viewH > 0)) return { w: viewW, h: viewH };
  const k = Math.min(viewW / naturalW, viewH / naturalH);
  return { w: naturalW * k, h: naturalH * k };
}

export function clampScale(scale: number, min = MIN_SCALE, max = MAX_SCALE): number {
  return Math.min(max, Math.max(min, scale));
}

/** How far the picture may move from centre on each axis at a scale: zero
 * while the scaled picture still fits that axis (kept centred), otherwise
 * half the overflow, so an edge can never come inside the screen edge. */
export function panLimits(scale: number, dims: ZoomDims): { maxX: number; maxY: number } {
  return {
    maxX: Math.max(0, (dims.contentW * scale - dims.viewW) / 2),
    maxY: Math.max(0, (dims.contentH * scale - dims.viewH) / 2),
  };
}

/** Hard clamp: scale into [min, max] (about the current centre of the
 * viewport, so the picture doesn't jump), then the pan into its limits. */
export function clampState(state: ZoomState, dims: ZoomDims, min = MIN_SCALE, max = MAX_SCALE): ZoomState {
  let s = state;
  const scale = clampScale(s.scale, min, max);
  if (scale !== s.scale) s = zoomAboutPoint(s, scale, { x: 0, y: 0 });
  const { maxX, maxY } = panLimits(s.scale, dims);
  // "+ 0" turns a -0 (clamped to the -0 limit) into a plain 0.
  return { scale: s.scale, x: Math.min(maxX, Math.max(-maxX, s.x)) + 0, y: Math.min(maxY, Math.max(-maxY, s.y)) + 0 };
}

/** Rubber band: past [min, max], movement is resisted (it keeps growing,
 * ever slower) instead of stopping dead. Inside the range it is unchanged. */
export function rubberBand(value: number, min: number, max: number, dimension: number, k = 0.55): number {
  const band = (over: number) => (1 - 1 / ((over * k) / Math.max(1, dimension) + 1)) * dimension;
  if (value < min) return min - band(min - value);
  if (value > max) return max + band(value - max);
  return value;
}

/** Soft clamp used while a finger is still down: scale and pan may overshoot
 * their limits a little (rubber band), then snap back on release with
 * clampState. */
export function softClampState(state: ZoomState, dims: ZoomDims, min = MIN_SCALE, max = MAX_SCALE): ZoomState {
  let scale = state.scale;
  if (scale < min) scale = min * Math.pow(scale / min, 0.4);
  else if (scale > max) scale = max * Math.pow(scale / max, 0.4);
  let s = state;
  if (scale !== s.scale) s = zoomAboutPoint(s, scale, { x: 0, y: 0 });
  const { maxX, maxY } = panLimits(s.scale, dims);
  return {
    scale: s.scale,
    x: rubberBand(s.x, -maxX, maxX, dims.viewW),
    y: rubberBand(s.y, -maxY, maxY, dims.viewH),
  };
}

/** Change scale keeping the picture point under `focus` (centre-relative
 * screen coords) exactly where it is. */
export function zoomAboutPoint(state: ZoomState, newScale: number, focus: Point): ZoomState {
  const r = newScale / state.scale;
  return { scale: newScale, x: focus.x - (focus.x - state.x) * r, y: focus.y - (focus.y - state.y) * r };
}

/** Two-finger pinch: from the transform and finger midpoint/distance when the
 * pinch began, the transform now. The picture point that was under the
 * starting midpoint follows the current midpoint (so pinching also pans),
 * and the scale follows the finger spread. Unclamped. */
export function pinchState(start: ZoomState, startMid: Point, startDist: number, mid: Point, dist: number): ZoomState {
  const scale = start.scale * (dist / Math.max(1, startDist));
  const px = (startMid.x - start.x) / start.scale;
  const py = (startMid.y - start.y) / start.scale;
  return { scale, x: mid.x - px * scale, y: mid.y - py * scale };
}

/** Double tap: zoomed in at all goes back to fit; at fit, zooms to
 * DOUBLE_TAP_SCALE centred on the tapped point (clamped, so tapping near an
 * edge doesn't reveal black beyond the picture). */
export function doubleTapTarget(state: ZoomState, tap: Point, dims: ZoomDims, target = DOUBLE_TAP_SCALE): ZoomState {
  if (state.scale > MIN_SCALE + 0.01) return IDENTITY;
  return clampState(zoomAboutPoint(state, target, tap), dims);
}

/** Wheel / trackpad: a ctrl+wheel (trackpad pinch) or wheel delta to a zoom
 * factor. Trackpad pinches send small deltas many times a second, a mouse
 * wheel sends ~100 per notch; both map smoothly through exp. */
export function wheelZoomFactor(deltaY: number, ctrlKey: boolean): number {
  const d = Math.max(-100, Math.min(100, deltaY));
  return Math.exp(-d * (ctrlKey ? 0.01 : 0.002));
}

export function isZoomed(state: ZoomState): boolean {
  return state.scale > MIN_SCALE + 0.001;
}

export function sameState(a: ZoomState, b: ZoomState, eps = 0.01): boolean {
  return Math.abs(a.scale - b.scale) < eps / 100 && Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

// The maths for a chat box that follows the iOS keyboard's slide
// (lib/useKeyboardFollow.ts). No React or DOM imports, so
// tests/keyboardFollow.test.ts runs under plain node.
//
// Why: the box (DirectMessageThread, the full-screen round chat) is sized
// to end at the keyboard's top. keyboardWillShow arrives as the keyboard
// STARTS its slide, and the box used to take its final height in that same
// frame: the composer and the newest messages jumped up and a keyboard-tall
// blank strip showed under them until the keyboard caught up (on close the
// reverse: the composer dropped behind the keyboard that was still going
// down). Now the box's bottom edge travels with the keyboard's top edge.
//
// The box's bottom at any moment is min(closed bottom, keyboard top): with
// the keyboard closed the box ends above the tab bar, so a rising keyboard
// only starts pushing it once its top edge reaches the composer, and a
// closing one lets it back down only until it is above the tab bar again.
// In heights (fullH = viewport bottom - box top):
//   height(inset) = min(closedH, fullH - inset)
// where `inset` is the keyboard height the box is showing right now.
//
// Timing: the plugin doesn't forward UIKit's animation duration or curve.
// The duration is this device's own measured slide (keyboard store:
// WillShow -> DidShow, WillHide -> DidHide), DEFAULT_SLIDE_MS (UIKit's
// usual 0.25 s, the same figure Keyboard.m's delayed body resize is built
// on) until one has been measured. The curve is an ease-out approximation
// of the keyboard's own (KEYBOARD_EASE); it's the one thing tuned by eye on
// a device, here only.

export const DEFAULT_SLIDE_MS = 250;
export const MIN_SLIDE_MS = 150;
export const MAX_SLIDE_MS = 600;
// Height changes smaller than this are left to the instant layout.
export const MIN_FOLLOW_PX = 2;

// cubic-bezier(x1, y1, x2, y2) as a function of progress 0..1, x1/x2 in
// [0, 1] (monotonic in x). Bisection on x: exact enough for a few px.
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const bx = (s: number) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  const by = (s: number) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  return (p: number) => {
    if (!(p > 0)) return 0;
    if (p >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < p) lo = mid;
      else hi = mid;
    }
    return by((lo + hi) / 2);
  };
}

// Fast start, long soft landing, never past 1 (y1, y2 <= 1).
export const KEYBOARD_EASE = cubicBezier(0.38, 0.7, 0.125, 1);

export function slideDuration(measuredMs: number | null): number {
  if (measuredMs === null || !Number.isFinite(measuredMs)) return DEFAULT_SLIDE_MS;
  return Math.min(MAX_SLIDE_MS, Math.max(MIN_SLIDE_MS, measuredMs));
}

export interface FollowPlan {
  fullH: number;
  closedH: number;
  fromInset: number;
  toInset: number;
}

export function followHeight(plan: Pick<FollowPlan, "fullH" | "closedH">, inset: number): number {
  return Math.max(0, Math.min(plan.closedH, plan.fullH - inset));
}

// null: nothing worth animating (no change, unknown geometry), so the
// committed layout is shown as is. closedH may be unknown (null) only when
// neither end is the closed state (a height change while open).
export function planFollow(input: { fullH: number; closedH: number | null; fromInset: number; toInset: number }): FollowPlan | null {
  const { fullH, fromInset, toInset } = input;
  if (![fullH, fromInset, toInset].every(Number.isFinite) || fullH <= 0) return null;
  if (fromInset === toInset) return null;
  let closedH = input.closedH;
  if (closedH === null || !Number.isFinite(closedH)) {
    if (fromInset <= 0 || toInset <= 0) return null;
    closedH = Infinity;
  }
  const plan = { fullH, closedH, fromInset, toInset };
  if (Math.abs(followHeight(plan, fromInset) - followHeight(plan, toInset)) < MIN_FOLLOW_PX) return null;
  return plan;
}

// The keyboard inset the box shows `elapsed` ms into a slide.
export function insetAt(plan: Pick<FollowPlan, "fromInset" | "toInset">, elapsed: number, duration: number, ease: (p: number) => number = KEYBOARD_EASE): number {
  const p = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 1;
  return plan.fromInset + (plan.toInset - plan.fromInset) * ease(p);
}

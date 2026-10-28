// Opposite rails alone don't keep two on-video callouts apart on a narrow
// (portrait) picture: each label grows inward from its rail and they met in
// the middle (Micky, 2026-10-28: "Steady spine angle" over the red label,
// both over the play button). Keeps the two labels a label's height apart
// vertically and, while paused, clear of the native play button in the
// centre. Only the label moves; its leader line still runs to the real joint.

export const CALLOUT_MIN_GAP = 30; // label height (~24 px) plus a little air
export const PLAY_BUTTON_CLEARANCE = 44; // half the native play button plus a margin

/** Mutates each callout's y. `top`/`bottom` bound the label centres;
 * callouts come in priority order (the first one keeps its place). */
export function separateCallouts(callouts: { y: number }[], top: number, bottom: number, paused: boolean): void {
  const clampY = (y: number) => Math.min(Math.max(y, top), bottom);
  if (paused) {
    const centerY = (top + bottom) / 2;
    for (const c of callouts) {
      if (Math.abs(c.y - centerY) < PLAY_BUTTON_CLEARANCE) {
        c.y = clampY(c.y < centerY ? centerY - PLAY_BUTTON_CLEARANCE : centerY + PLAY_BUTTON_CLEARANCE);
      }
    }
  }
  if (callouts.length === 2 && Math.abs(callouts[0].y - callouts[1].y) < CALLOUT_MIN_GAP) {
    const [first, second] = callouts;
    const below = first.y + CALLOUT_MIN_GAP;
    second.y = below <= bottom ? below : clampY(first.y - CALLOUT_MIN_GAP);
  }
}

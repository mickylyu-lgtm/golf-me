// A tiny movement can be fast without being an intentional swipe. Require
// a minimum travel for the velocity shortcut; long drags still dismiss.
const DISMISS_DISTANCE_PX = 120;
const MIN_FLING_DISTANCE_PX = 24;
const DISMISS_VELOCITY_PX_MS = 0.5;

export function shouldDismissFullscreenMedia(distanceY: number, elapsedMs: number): boolean {
  return distanceY > DISMISS_DISTANCE_PX ||
    (distanceY >= MIN_FLING_DISTANCE_PX && distanceY / Math.max(1, elapsedMs) > DISMISS_VELOCITY_PX_MS);
}

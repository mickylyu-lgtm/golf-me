// The course page's "drone" overview: a tilted satellite view that slowly
// circles the course. Pure (no MapLibre, no DOM) so the motion rules are
// tested under node (tests/droneOrbit.test.ts); CourseOverviewMap drives
// MapLibre with them.

// One full circle a minute: slow enough to read the holes, fast enough to
// look alive.
export const ORBIT_DEG_PER_SEC = 6;
export const OVERVIEW_PITCH = 60;
export const OVERVIEW_ZOOM = 15.6;
// The still view under reduced motion: same tilt, a fixed heading.
export const STILL_BEARING = 30;
// After the golfer drags/pinches, the orbit waits this long before it
// carries on from wherever they left the camera.
export const ORBIT_RESUME_AFTER_MS = 8000;
// A frame after a long gap (tab in background, a stall) never jumps the
// camera by more than this much time.
const MAX_FRAME_DT_MS = 100;

export function normalizeBearing(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const b = deg % 360;
  return b < 0 ? b + 360 : b;
}

/** Bearing after `elapsedMs` of continuous orbit from `start`. */
export function orbitBearing(start: number, elapsedMs: number, degPerSec = ORBIT_DEG_PER_SEC): number {
  return normalizeBearing(start + (Math.max(0, elapsedMs) / 1000) * degPerSec);
}

/** One animation frame: the next bearing given the time since the last
 * frame (clamped, so a stall never makes the camera leap). */
export function orbitStep(bearing: number, dtMs: number, degPerSec = ORBIT_DEG_PER_SEC): number {
  const dt = Number.isFinite(dtMs) ? Math.min(Math.max(dtMs, 0), MAX_FRAME_DT_MS) : 0;
  return orbitBearing(bearing, dt, degPerSec);
}

export type OverviewMotion = "orbit" | "still";

/** Reduced motion gets a still, tilted view; everyone else the orbit. */
export function overviewMotion(prefersReducedMotion: boolean): OverviewMotion {
  return prefersReducedMotion ? "still" : "orbit";
}

export interface OrbitConditions {
  motion: OverviewMotion;
  /** The map box is on screen. */
  inView: boolean;
  /** The page/app is in the foreground. */
  pageVisible: boolean;
  /** A finger or the mouse is on the map right now. */
  interacting: boolean;
  /** When the golfer last touched the map (ms), or null. */
  lastInteractionAt: number | null;
  now: number;
}

/** Should the camera be orbiting on this frame? */
export function orbitRunning(c: OrbitConditions): boolean {
  if (c.motion !== "orbit" || !c.inView || !c.pageVisible || c.interacting) return false;
  if (c.lastInteractionAt != null && c.now - c.lastInteractionAt < ORBIT_RESUME_AFTER_MS) return false;
  return true;
}

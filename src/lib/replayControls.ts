// Pure rules for Caddie's own replay controls (CaddieSwingReplay, analysis
// mode). The native <video controls> chrome is not used there: its big play
// button and scrubber covered the swing at every coach checkpoint, and its
// fullscreen button opened the OS player, where no coaching card can show
// (Micky, 2026-11-08).

/** How long revealed controls stay up after the last interaction. */
export const CONTROLS_IDLE_MS = 2800;

export interface ControlsVisibilityInput {
  /** The golfer tapped the video or used a control recently (idle timer running). */
  revealed: boolean;
  /** Scrubbing, a pointer pressed on the controls, or keyboard focus inside them. */
  held: boolean;
  paused: boolean;
  /** Paused by Coach Replay at a checkpoint, with its card up. */
  frozenAtCheckpoint: boolean;
}

/**
 * Whether the replay controls are shown. A coach checkpoint pause never
 * shows them by itself; any other pause (the golfer's own, the app going to
 * the background, the clip's end, the first load) keeps them up so there is
 * always a visible way to play.
 */
export function controlsVisible({ revealed, held, paused, frozenAtCheckpoint }: ControlsVisibilityInput): boolean {
  if (held || revealed) return true;
  return paused && !frozenAtCheckpoint;
}

/** Clock for a short swing clip, with tenths: 0:03.4. */
export function formatReplayTime(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const tenths = Math.floor(s * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  const rest = tenths - m * 600;
  const whole = Math.floor(rest / 10);
  return `${m}:${whole.toString().padStart(2, "0")}.${rest % 10}`;
}

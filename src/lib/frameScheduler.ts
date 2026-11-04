// At most one pending animation-frame callback, cancellable, and inert once
// disposed. CourseAutocomplete's keep-the-field-visible check is re-run
// from a ResizeObserver on the next frame; that frame used to be queued with
// a bare requestAnimationFrame and never cancelled, so a check queued just
// before the field lost focus or the keyboard closed still ran afterwards
// and scrolled the page with the old keyboard height. No React/DOM imports
// (the frame functions are passed in), so tests/frameScheduler.test.ts runs
// under plain node.

export interface FrameScheduler {
  // Queue `run` for the next frame; repeated calls before it fires coalesce.
  schedule: () => void;
  // Cancel any pending frame; later schedule() calls do nothing.
  dispose: () => void;
}

export function createFrameScheduler(
  run: () => void,
  requestFrame: (cb: () => void) => number,
  cancelFrame: (id: number) => void,
): FrameScheduler {
  let pending: number | null = null;
  let disposed = false;
  return {
    schedule() {
      if (disposed || pending !== null) return;
      pending = requestFrame(() => {
        pending = null;
        if (!disposed) run();
      });
    },
    dispose() {
      disposed = true;
      if (pending !== null) cancelFrame(pending);
      pending = null;
    },
  };
}

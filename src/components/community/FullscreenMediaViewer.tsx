import { useRef, useState } from "react";
import type { PostMediaItem } from "../../types";
import { MediaCarousel } from "./MediaCarousel";

interface FullscreenMediaViewerProps {
  media: PostMediaItem[];
  initialIndex?: number;
  onClose: () => void;
}

const DISMISS_DISTANCE_PX = 120;
const DISMISS_VELOCITY = 0.5;
// Below this, a touchmove is read as part of the carousel's own horizontal
// swipe-between-items gesture, not a dismiss drag — avoids fighting the
// scroll-snap track over which axis "owns" a mostly-diagonal drag.
const AXIS_LOCK_PX = 8;
// A touch that starts on the video's own tap/hold controls (play/pause,
// hold-for-2x — [data-video-controls]) needs a much more deliberate drag
// before it's read as a dismiss rather than the video's own gesture, the
// same "stricter threshold, not a full exclusion" pattern RootTabCarousel
// uses for buttons/cards. A full exclusion isn't an option here the way it
// is for a slider — the video is full-bleed, so it IS the entire dismiss
// surface; excluding it would leave nothing to drag from at all. Without
// this, ordinary finger tremor during a tap or hold nudged the whole
// viewer's drag state just enough to snap back on release, reading as a
// glitch on every touch.
const INTERACTIVE_AXIS_LOCK_PX = 45;
// The tap that OPENS this viewer and the drag-to-dismiss gesture that
// CLOSES it share the same touch surface (this is full-bleed — there's no
// separate "outside" to tap). If this component mounts while that opening
// tap's touch sequence is still resolving (synthetic click delay, a
// slightly-held tap, etc.), a trailing touchmove/touchend from that same
// gesture can reach this component's own listeners the instant it mounts
// and get misread as an immediate dismiss drag — the viewer flickers open
// and shut on a single tap. Refusing to dismiss for a brief window after
// mount is the standard guard for this class of bug: real dismiss drags
// take real user reaction time, well past this window.
const IGNORE_DISMISS_MS = 300;

// The fullscreen home for both a swing post's single video and a
// multi-photo/video post's carousel — same drag-down-to-dismiss gesture
// either way (opened via double-tap on the feed card). Vertical drags are
// intercepted here; horizontal ones are left alone so MediaCarousel's own
// native scroll-snap still swipes between items normally.
export function FullscreenMediaViewer({ media, initialIndex = 0, onClose }: FullscreenMediaViewerProps) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const mountedAtRef = useRef(Date.now());
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    lastY: number;
    axis: "none" | "vertical" | "horizontal";
    startedOnInteractive: boolean;
  } | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    // A touchstart landing inside the ignore window is the same physical
    // gesture that opened this viewer leaking in, not a real new touch —
    // never start tracking it as a potential dismiss.
    if (Date.now() - mountedAtRef.current < IGNORE_DISMISS_MS) return;
    const startedOnInteractive = e.target instanceof Element && e.target.closest("[data-video-controls]") !== null;
    const t = e.touches[0];
    dragStateRef.current = { startX: t.clientX, startY: t.clientY, startTime: Date.now(), lastY: t.clientY, axis: "none", startedOnInteractive };
  }

  function onTouchMove(e: React.TouchEvent) {
    const state = dragStateRef.current;
    if (!state) return;
    const t = e.touches[0];
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;
    const lockPx = state.startedOnInteractive ? INTERACTIVE_AXIS_LOCK_PX : AXIS_LOCK_PX;

    if (state.axis === "none" && (Math.abs(dx) > lockPx || Math.abs(dy) > lockPx)) {
      state.axis = Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
    }
    if (state.axis !== "vertical") return;

    state.lastY = t.clientY;
    setDragging(true);
    // Only follows downward drags; dragging up just resists, nothing to
    // reveal above a fullscreen viewer.
    setDragY(dy > 0 ? dy : dy / 4);
  }

  function onTouchEnd() {
    const state = dragStateRef.current;
    dragStateRef.current = null;
    setDragging(false);
    if (!state || state.axis !== "vertical") return;
    const totalDy = state.lastY - state.startY;
    const elapsedMs = Math.max(1, Date.now() - state.startTime);
    const velocity = Math.abs(totalDy) / elapsedMs;
    if (totalDy > DISMISS_DISTANCE_PX || (totalDy > 0 && velocity > DISMISS_VELOCITY)) {
      onClose();
    } else {
      setDragY(0);
    }
  }

  // The backdrop fades out as the sheet is dragged away, same idea as
  // iOS/Instagram's photo viewer — gives the drag visual weight instead of
  // the content just sliding over a flat black field.
  const backdropOpacity = Math.max(0, 1 - Math.abs(dragY) / 400);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[95] overflow-hidden"
      style={{ backgroundColor: `rgba(0,0,0,${backdropOpacity})` }}
    >
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className={`h-dvh w-full ${dragging ? "" : "transition-transform duration-200 ease-out"}`}
        style={{ transform: `translateY(${dragY}px)` }}
      >
        <MediaCarousel media={media} variant="lightbox" initialIndex={initialIndex} />
      </div>
    </div>
  );
}

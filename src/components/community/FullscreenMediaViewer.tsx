import { useRef, useState } from "react";
import { X } from "lucide-react";
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

// The fullscreen home for both a swing post's single video and a
// multi-photo/video post's carousel — same drag-down-to-dismiss gesture
// either way (opened via double-tap on the feed card). Vertical drags are
// intercepted here; horizontal ones are left alone so MediaCarousel's own
// native scroll-snap still swipes between items normally.
export function FullscreenMediaViewer({ media, initialIndex = 0, onClose }: FullscreenMediaViewerProps) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startX: number; startY: number; startTime: number; lastY: number; axis: "none" | "vertical" | "horizontal" } | null>(
    null,
  );

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    dragStateRef.current = { startX: t.clientX, startY: t.clientY, startTime: Date.now(), lastY: t.clientY, axis: "none" };
  }

  function onTouchMove(e: React.TouchEvent) {
    const state = dragStateRef.current;
    if (!state) return;
    const t = e.touches[0];
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;

    if (state.axis === "none" && (Math.abs(dx) > AXIS_LOCK_PX || Math.abs(dy) > AXIS_LOCK_PX)) {
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
      onClick={onClose}
      className="fixed inset-0 z-[95] flex items-center justify-center"
      style={{ backgroundColor: `rgba(0,0,0,${backdropOpacity})` }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
        className="absolute right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        style={{ top: "max(1rem, env(safe-area-inset-top))" }}
      >
        <X size={18} />
      </button>
      <div
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className={`h-full max-h-[85vh] w-full max-w-2xl ${dragging ? "" : "transition-transform duration-200 ease-out"}`}
        style={{ transform: `translateY(${dragY}px)` }}
      >
        <MediaCarousel media={media} variant="lightbox" initialIndex={initialIndex} />
      </div>
    </div>
  );
}

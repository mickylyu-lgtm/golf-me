import { useEffect, type RefObject } from "react";
import { classifySwipe, lockDirection } from "./chatSwipe";

// Instagram-DM-style "drag the thread sideways to see when each message was
// sent" (Micky, 2026-10-25). Dragging LEFT slides every row left by up to
// REVEAL_PX; each row's time label sits just past the list's right clip
// edge, so it slides into view with the rows. Letting go springs back.
//
// Built to stay out of everything else on the DM thread (whose
// keyboard/viewport/scroll-anchoring code is frozen):
// - Pointer events plus `touch-action: pan-y` on the list. The browser keeps
//   doing native vertical scrolling and sends pointercancel the moment it
//   takes a gesture as a scroll, so this never fights a vertical scroll and
//   never needs a non-passive touchmove listener (which would make every
//   scroll wait on the main thread).
// - Direction lock after AXIS_SLOP_PX (lockDirection + classifySwipe): only
//   a leftward drag that did NOT start on a reply-enabled message bubble is
//   ours. A leftward drag starting on a bubble is swipe-to-reply
//   (useSwipeToReply); vertical is scroll; rightward is nothing here (edge
//   swipe back lives in useEdgeSwipeBack). Each is ignored for its whole
//   lifetime.
// - Touch/pen only. A mouse drag stays a text selection on desktop.
// - Only the rows wrapper moves, via one transform written at most once per
//   animation frame. Nothing touches scrollTop, the list's size, or the
//   composer, so the frozen scroll/keyboard logic sees no change.
// - A click that ends a real horizontal drag is swallowed (capture phase),
//   so a drag that happens to end on a link or button never activates it.
//   Plain taps and long-presses never pass the slop, so they're untouched.
// - prefers-reduced-motion: the rows still follow the finger (direct
//   manipulation), but snap back with no spring animation.

export const REVEAL_PX = 76;
// Past REVEAL_PX the drag keeps moving at a fraction of the finger, then stops.
const OVERDRAG_RESISTANCE = 0.25;
const MAX_OVERDRAG_PX = 24;
const SPRING_BACK = "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function hasTextSelection(): boolean {
  const selection = document.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
}

export function dragOffset(dx: number): number {
  // Leftward only (dx < 0). Returned value is <= 0.
  if (dx >= 0) return 0;
  const pull = -dx;
  if (pull <= REVEAL_PX) return -pull;
  return -(REVEAL_PX + Math.min(MAX_OVERDRAG_PX, (pull - REVEAL_PX) * OVERDRAG_RESISTANCE));
}

export function useSwipeToRevealTimes(
  listRef: RefObject<HTMLElement | null>,
  rowsRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const list = listRef.current;
    const rows = rowsRef.current;
    if (!enabled || !list || !rows) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let axis: "none" | "x" | "y" = "none";
    let startedOnBubble = false;
    let offset = 0;
    let frame = 0;
    let suppressClickUntil = 0;

    const paint = () => {
      frame = 0;
      rows.style.transform = offset === 0 ? "" : `translate3d(${offset}px, 0, 0)`;
    };
    const schedulePaint = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const release = () => {
      const wasDragging = axis === "x";
      pointerId = null;
      axis = "none";
      if (!wasDragging) return;
      suppressClickUntil = Date.now() + 400;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      offset = 0;
      rows.style.transition = prefersReducedMotion() ? "" : SPRING_BACK;
      rows.style.transform = "";
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      if (hasTextSelection()) return;
      pointerId = e.pointerId;
      // Bubbles carry data-reply-bubble only while replying is possible.
      startedOnBubble = e.target instanceof Element && e.target.closest("[data-reply-bubble]") !== null;
      startX = e.clientX;
      startY = e.clientY;
      axis = "none";
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (axis === "none") {
        const action = classifySwipe(lockDirection(dx, dy), { onBubble: startedOnBubble, inEdge: false });
        if (action === "pending") return;
        if (action === "times") {
          axis = "x";
          rows.style.transition = "";
        } else {
          // Scroll, a reply swipe on a bubble, or a rightward drag: not
          // this gesture.
          axis = "y";
        }
      }
      if (axis !== "x") return;
      offset = dragOffset(dx);
      schedulePaint();
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      release();
    };

    const onClickCapture = (e: MouseEvent) => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    list.addEventListener("pointerdown", onPointerDown, { passive: true });
    list.addEventListener("pointermove", onPointerMove, { passive: true });
    list.addEventListener("pointerup", onPointerEnd, { passive: true });
    list.addEventListener("pointercancel", onPointerEnd, { passive: true });
    list.addEventListener("click", onClickCapture, true);
    return () => {
      list.removeEventListener("pointerdown", onPointerDown);
      list.removeEventListener("pointermove", onPointerMove);
      list.removeEventListener("pointerup", onPointerEnd);
      list.removeEventListener("pointercancel", onPointerEnd);
      list.removeEventListener("click", onClickCapture, true);
      if (frame) cancelAnimationFrame(frame);
      rows.style.transform = "";
      rows.style.transition = "";
    };
  }, [listRef, rowsRef, enabled]);
}

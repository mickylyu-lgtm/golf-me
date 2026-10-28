import { useEffect, useRef, type RefObject } from "react";
import { classifyMove, dragOffset, isEdgeStart, shouldComplete } from "./edgeSwipeBack";

// iOS-style "swipe from the left edge to go back" (Micky, 2026-10-25), used
// by SwipeBackToInbox around the DM thread. Start within EDGE_PX of the
// page column's left edge and drag right: the page follows the finger over
// a dimmed backdrop; let go past 35% of the width (or fling) and it slides
// out and onBack() runs, otherwise it springs back.
//
// Built to stay out of the DM thread's frozen keyboard/viewport/scroll code:
// - Passive touch listeners on the wrapper only (never preventDefault, no
//   non-passive touchmove anywhere). Touch events keep firing while the
//   browser scrolls, unlike pointer events, so a touch that starts on the
//   header or composer (touch-action auto) is still seen.
// - A gesture that starts away from the edge, goes left or goes mostly
//   vertical is dropped for its whole lifetime, so swipe-left-for-times
//   (useSwipeToRevealTimes) and native vertical scroll behave as before.
// - Touches that start in a text field are ignored (caret drag / text
//   selection in the composer), and so is any gesture that starts while
//   text is selected.
// - Only `slider` moves, via one transform written at most once per
//   animation frame. Nothing reads or writes scroll positions or sizes,
//   and the inline styles exist only during the gesture.
// - Focus is never touched during the drag; the focused field (composer)
//   is blurred only once a swipe has committed.
// - prefers-reduced-motion: the page still follows the finger (direct
//   manipulation), but completes or returns with no animation.

const SPRING_BACK_MS = 260;
const SLIDE_OUT_MS = 200;
const SPRING_BACK = `transform ${SPRING_BACK_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
const SLIDE_OUT = `transform ${SLIDE_OUT_MS}ms cubic-bezier(0.25, 0.8, 0.4, 1)`;
const BACKDROP_MAX_OPACITY = 0.14;
const PAGE_SHADOW = "-6px 0 18px rgba(15, 23, 42, 0.12)";
const PAGE_BACKGROUND = "#faf9f6";
// If onBack() didn't unmount us (navigation refused), put the page back.
const UNMOUNT_FALLBACK_MS = 700;
const VELOCITY_WINDOW_MS = 100;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function hasTextSelection(): boolean {
  const selection = document.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
}

function isTextFieldTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('textarea, input, select, [contenteditable]:not([contenteditable="false"])'));
}

export function useEdgeSwipeBack(
  wrapperRef: RefObject<HTMLElement | null>,
  sliderRef: RefObject<HTMLElement | null>,
  backdropRef: RefObject<HTMLElement | null>,
  onBack: () => void,
) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const slider = sliderRef.current;
    const backdrop = backdropRef.current;
    if (!wrapper || !slider || !backdrop) return;

    let touchId: number | null = null;
    let phase: "idle" | "pending" | "dragging" | "settling" = "idle";
    let startX = 0;
    let startY = 0;
    let offset = 0;
    let width = 1;
    let samples: { t: number; x: number }[] = [];
    let frame = 0;
    let timer = 0;

    const paint = () => {
      frame = 0;
      slider.style.transform = `translate3d(${offset}px, 0, 0)`;
      backdrop.style.opacity = String(BACKDROP_MAX_OPACITY * Math.max(0, 1 - offset / width));
    };
    const schedulePaint = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const cancelFrame = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    // The clip comes off two frames after the transform is cleared, not in
    // the same task: index.css's reduced-motion rule gives every element a
    // 0.01ms transition, so for one frame the page still renders at its
    // dragged offset, and without the clip that frame widened the document
    // (headless check: scrollWidth 438 on a 390 viewport).
    let clipFrame = 0;
    const cancelClipRelease = () => {
      if (clipFrame) cancelAnimationFrame(clipFrame);
      clipFrame = 0;
    };
    const releaseClipSoon = () => {
      cancelClipRelease();
      clipFrame = requestAnimationFrame(() => {
        clipFrame = requestAnimationFrame(() => {
          clipFrame = 0;
          if (phase === "idle") wrapper.style.overflowX = "";
        });
      });
    };

    const beginDrag = () => {
      phase = "dragging";
      width = wrapper.getBoundingClientRect().width || window.innerWidth || 1;
      cancelClipRelease();
      wrapper.style.overflowX = "clip";
      backdrop.style.display = "block";
      slider.style.transition = "";
      slider.style.willChange = "transform";
      slider.style.backgroundColor = PAGE_BACKGROUND;
      slider.style.boxShadow = PAGE_SHADOW;
    };

    const resetStyles = () => {
      cancelFrame();
      slider.style.transform = "";
      slider.style.transition = "";
      slider.style.willChange = "";
      slider.style.backgroundColor = "";
      slider.style.boxShadow = "";
      backdrop.style.display = "none";
      backdrop.style.opacity = "0";
      backdrop.style.transition = "";
      offset = 0;
      phase = "idle";
      releaseClipSoon();
    };

    const springBack = () => {
      cancelFrame();
      offset = 0;
      if (prefersReducedMotion()) {
        resetStyles();
        return;
      }
      phase = "settling";
      slider.style.transition = SPRING_BACK;
      backdrop.style.transition = `opacity ${SPRING_BACK_MS}ms ease-out`;
      slider.style.transform = "translate3d(0, 0, 0)";
      backdrop.style.opacity = String(BACKDROP_MAX_OPACITY);
      timer = window.setTimeout(resetStyles, SPRING_BACK_MS + 20);
    };

    const complete = () => {
      cancelFrame();
      phase = "settling";
      // Blur only now that the swipe has committed, never during the drag.
      const active = document.activeElement;
      if (active instanceof HTMLElement && wrapper.contains(active)) active.blur();
      const go = () => {
        onBackRef.current();
        timer = window.setTimeout(resetStyles, UNMOUNT_FALLBACK_MS);
      };
      if (prefersReducedMotion()) {
        go();
        return;
      }
      slider.style.transition = SLIDE_OUT;
      backdrop.style.transition = `opacity ${SLIDE_OUT_MS}ms ease-out`;
      slider.style.transform = `translate3d(${width}px, 0, 0)`;
      backdrop.style.opacity = "0";
      timer = window.setTimeout(go, SLIDE_OUT_MS);
    };

    const findTouch = (list: TouchList) => {
      for (let i = 0; i < list.length; i++) if (list[i].identifier === touchId) return list[i];
      return null;
    };

    const velocity = () => {
      if (samples.length < 2) return 0;
      const last = samples[samples.length - 1];
      const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS) ?? samples[0];
      const dt = last.t - first.t;
      return dt > 0 ? (last.x - first.x) / dt : 0;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (phase === "settling") return;
      if (e.touches.length > 1) {
        // A second finger: this isn't a back swipe.
        if (phase === "dragging") springBack();
        else phase = "idle";
        touchId = null;
        return;
      }
      const touch = e.changedTouches[0];
      if (!touch) return;
      const left = wrapper.getBoundingClientRect().left;
      if (!isEdgeStart(touch.clientX - left) || isTextFieldTarget(e.target) || hasTextSelection()) {
        phase = "idle";
        touchId = null;
        return;
      }
      touchId = touch.identifier;
      startX = touch.clientX;
      startY = touch.clientY;
      samples = [{ t: e.timeStamp, x: touch.clientX }];
      phase = "pending";
    };

    const onTouchMove = (e: TouchEvent) => {
      if (phase !== "pending" && phase !== "dragging") return;
      const touch = findTouch(e.changedTouches);
      if (!touch) return;
      const dx = touch.clientX - startX;
      if (phase === "pending") {
        const kind = classifyMove(dx, touch.clientY - startY);
        if (kind === "pending") return;
        if (kind === "other") {
          phase = "idle";
          touchId = null;
          return;
        }
        beginDrag();
      }
      offset = dragOffset(dx);
      samples.push({ t: e.timeStamp, x: touch.clientX });
      if (samples.length > 12) samples.shift();
      schedulePaint();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (touchId === null || !findTouch(e.changedTouches)) return;
      touchId = null;
      if (phase === "pending") {
        phase = "idle";
        return;
      }
      if (phase !== "dragging") return;
      if (e.type === "touchcancel" || !shouldComplete(offset, width, velocity())) springBack();
      else complete();
    };

    wrapper.addEventListener("touchstart", onTouchStart, { passive: true });
    wrapper.addEventListener("touchmove", onTouchMove, { passive: true });
    wrapper.addEventListener("touchend", onTouchEnd, { passive: true });
    wrapper.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      wrapper.removeEventListener("touchstart", onTouchStart);
      wrapper.removeEventListener("touchmove", onTouchMove);
      wrapper.removeEventListener("touchend", onTouchEnd);
      wrapper.removeEventListener("touchcancel", onTouchEnd);
      window.clearTimeout(timer);
      resetStyles();
      cancelClipRelease();
      wrapper.style.overflowX = "";
    };
  }, [wrapperRef, sliderRef, backdropRef]);
}

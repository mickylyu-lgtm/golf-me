import { useEffect, useRef } from "react";
import {
  IDENTITY,
  clampState,
  containSize,
  doubleTapTarget,
  isZoomed,
  pinchState,
  softClampState,
  wheelZoomFactor,
  zoomAboutPoint,
  type Point,
  type ZoomDims,
  type ZoomState,
} from "../../lib/zoomPan";

interface ZoomableImageProps {
  src: string;
  /** The slide currently showing. Swiping away from this one resets it. */
  active: boolean;
}

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 40;
const TAP_MOVE_PX = 10;
const SNAP_MS = 220;

type Gesture =
  | { kind: "pinch"; start: ZoomState; startMid: Point; startDist: number }
  | { kind: "pan"; start: ZoomState; from: Point }
  | null;

// One photo in the fullscreen viewer (FullscreenMediaViewer -> MediaCarousel
// lightbox), zoomable like Instagram / iMessage: pinch (1x to 4x, anchored
// at the fingers), pan while zoomed (edges clamped to the screen edges),
// double tap to toggle fit / 2.5x at the tapped point, ctrl+wheel (trackpad
// pinch) and wheel on a computer. Overshoot while a finger is down rubber-
// bands and springs back on release.
//
// The transform is written straight to the <img> from a rAF, from refs; no
// React state, so a pinch never re-renders anything and nothing re-lays out.
//
// How it shares touches with the rest of the viewer:
// - at 1x the slide keeps touch-action pan-x pan-y, so a one-finger swipe is
//   still the carousel's native scroll-snap (next photo) or the viewer's
//   drag-down-to-close; the browser's own pinch / double-tap zoom is off.
// - once zoomed (or while two fingers are down) it switches to touch-action
//   none, cancels touchmove, and marks itself [data-zoom-active], which the
//   viewer's dismiss tracking skips. A horizontal drag then pans the photo
//   instead of changing slide or closing.
export function ZoomableImage({ src, active }: ZoomableImageProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const stateRef = useRef<ZoomState>(IDENTITY);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<Gesture>(null);
  // This press sequence was a multi-touch (pinch) or moved: never a tap.
  const notTapRef = useRef(false);
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const snapTimerRef = useRef<number | null>(null);

  function dims(): ZoomDims {
    const box = boxRef.current;
    const img = imgRef.current;
    const viewW = box?.clientWidth ?? 0;
    const viewH = box?.clientHeight ?? 0;
    const c = containSize(img?.naturalWidth ?? 0, img?.naturalHeight ?? 0, viewW, viewH);
    return { viewW, viewH, contentW: c.w, contentH: c.h };
  }

  // Client coords -> coords from the box's centre (the transform origin).
  function local(clientX: number, clientY: number): Point {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  }

  function paint() {
    rafRef.current = null;
    const img = imgRef.current;
    const box = boxRef.current;
    if (!img || !box) return;
    const s = stateRef.current;
    img.style.transform = `translate3d(${s.x}px, ${s.y}px, 0) scale(${s.scale})`;
    const engaged = isZoomed(s) || pointersRef.current.size > 1 || gestureRef.current !== null;
    box.style.touchAction = engaged ? "none" : "pan-x pan-y";
    if (engaged) box.setAttribute("data-zoom-active", "");
    else box.removeAttribute("data-zoom-active");
  }

  function schedule() {
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(paint);
  }

  function stopSnap() {
    if (snapTimerRef.current !== null) {
      window.clearTimeout(snapTimerRef.current);
      snapTimerRef.current = null;
    }
    if (imgRef.current) imgRef.current.style.transition = "";
  }

  // Move to a resting transform: animated unless reduced motion asks not to.
  function settle(target: ZoomState, animate = true) {
    stopSnap();
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    stateRef.current = target;
    const img = imgRef.current;
    if (img && animate && !reduce) {
      img.style.transition = `transform ${SNAP_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
      snapTimerRef.current = window.setTimeout(stopSnap, SNAP_MS + 40);
    }
    // Paint now (not next frame) so the transition starts from this frame.
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    paint();
  }

  function pinchMetrics(): { mid: Point; dist: number } | null {
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return { mid: local((a.x + b.x) / 2, (a.y + b.y) / 2), dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  function beginPinch() {
    const m = pinchMetrics();
    if (!m) return;
    stopSnap();
    gestureRef.current = { kind: "pinch", start: stateRef.current, startMid: m.mid, startDist: m.dist };
  }

  function beginPanFromRemaining() {
    const remaining = [...pointersRef.current.values()][0];
    if (remaining && isZoomed(stateRef.current)) {
      gestureRef.current = { kind: "pan", start: stateRef.current, from: remaining };
    } else {
      gestureRef.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === "mouse") e.currentTarget.setPointerCapture?.(e.pointerId);
    if (pointersRef.current.size === 1) {
      notTapRef.current = false;
      downRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (isZoomed(stateRef.current)) {
        stopSnap();
        gestureRef.current = { kind: "pan", start: stateRef.current, from: { x: e.clientX, y: e.clientY } };
      }
    } else {
      notTapRef.current = true;
      beginPinch();
    }
    schedule();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = pointersRef.current.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const down = downRef.current;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_MOVE_PX) notTapRef.current = true;
    const g = gestureRef.current;
    if (!g) return;
    if (g.kind === "pinch") {
      const m = pinchMetrics();
      if (!m) return;
      stateRef.current = softClampState(pinchState(g.start, g.startMid, g.startDist, m.mid, m.dist), dims());
    } else {
      stateRef.current = softClampState(
        { scale: g.start.scale, x: g.start.x + (e.clientX - g.from.x), y: g.start.y + (e.clientY - g.from.y) },
        dims(),
      );
    }
    schedule();
  }

  function endPointer(e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) {
    if (!pointersRef.current.delete(e.pointerId)) return;
    const left = pointersRef.current.size;
    if (left >= 2) {
      beginPinch();
      return;
    }
    if (left === 1) {
      // Lifting one finger of a pinch: carry on as a one-finger pan.
      stateRef.current = softClampState(stateRef.current, dims());
      beginPanFromRemaining();
      schedule();
      return;
    }
    gestureRef.current = null;
    const resting = clampState(stateRef.current, dims());

    const down = downRef.current;
    downRef.current = null;
    const now = performance.now();
    if (!cancelled && !notTapRef.current && down && now - down.t < DOUBLE_TAP_MS) {
      const last = lastTapRef.current;
      if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_SLOP_PX) {
        lastTapRef.current = null;
        settle(doubleTapTarget(resting, local(e.clientX, e.clientY), dims()));
        return;
      }
      lastTapRef.current = { x: e.clientX, y: e.clientY, t: now };
    } else {
      lastTapRef.current = null;
    }
    settle(resting);
  }

  // Native listeners (non-passive, so they may cancel): touchmove while this
  // slide owns the gesture, Safari's own gesture* page-zoom events, wheel.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onTouchMove = (e: TouchEvent) => {
      if (!e.cancelable) return;
      if (e.touches.length > 1 || isZoomed(stateRef.current) || gestureRef.current !== null) e.preventDefault();
    };
    const onGesture = (e: Event) => e.preventDefault();
    const onWheel = (e: WheelEvent) => {
      // A sideways trackpad swipe at fit is the carousel's own scroll.
      if (!e.ctrlKey && !isZoomed(stateRef.current) && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (e.deltaY === 0) return;
      e.preventDefault();
      stopSnap();
      const s = stateRef.current;
      const next = zoomAboutPoint(s, s.scale * wheelZoomFactor(e.deltaY, e.ctrlKey), local(e.clientX, e.clientY));
      stateRef.current = clampState(next, dims());
      schedule();
    };
    box.addEventListener("touchmove", onTouchMove, { passive: false });
    box.addEventListener("gesturestart", onGesture);
    box.addEventListener("gesturechange", onGesture);
    box.addEventListener("gestureend", onGesture);
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      box.removeEventListener("touchmove", onTouchMove);
      box.removeEventListener("gesturestart", onGesture);
      box.removeEventListener("gesturechange", onGesture);
      box.removeEventListener("gestureend", onGesture);
      box.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swiped to another slide (or a new picture): back to fit, no animation.
  useEffect(() => {
    if (active) return;
    pointersRef.current.clear();
    gestureRef.current = null;
    lastTapRef.current = null;
    settle(IDENTITY, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, src]);

  // Rotation / window resize: keep the pan inside the new limits.
  useEffect(() => {
    const onResize = () => {
      stateRef.current = clampState(stateRef.current, dims());
      schedule();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={boxRef}
      data-zoomable
      className="h-full w-full shrink-0 snap-center select-none overflow-hidden bg-black"
      style={{ touchAction: "pan-x pan-y" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, false)}
      onPointerCancel={(e) => endPointer(e, true)}
    >
      <img
        ref={imgRef}
        src={src}
        alt=""
        loading="lazy"
        draggable={false}
        className="pointer-events-none h-full w-full origin-center object-contain will-change-transform"
        style={{ transform: "translate3d(0px, 0px, 0) scale(1)" }}
      />
    </div>
  );
}

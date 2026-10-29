import { useEffect, useRef, type RefObject } from "react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { classifySwipe, crossedReplyThreshold, isPastReplyThreshold, lockDirection, replyDragOffset, replyProgress } from "./chatSwipe";
import { isEdgeStart } from "./edgeSwipeBack";

// Swipe RIGHT on a message bubble to reply (Micky, 2026-10-28: "it should
// be swipe right on message"). The bubble follows the finger right with a
// reply arrow fading in on its left, where the bubble came from; crossing
// REPLY_THRESHOLD_PX fires one light haptic; letting go past it calls
// onReply(messageId). Always springs back. A rightward drag starting in the
// edge-swipe-back strip is "back" instead (it wins, even on a bubble); a
// leftward drag anywhere is useSwipeToRevealTimes.
//
// DOM contract (DirectMessageThread renders it):
//   [data-reply-row]                  the message row, position: relative
//     [data-reply-arrow]              the arrow, absolutely positioned
//     [data-reply-avatar]             the row's avatar
//     [data-reply-bubble="<msg id>"]  the bubble: a drag must START on it,
//                                     and only it moves
// When the avatar sits in the bubble's path (my own messages: avatar on the
// right), it fades out as the bubble slides toward it and back in on
// release, so the two never visibly overlap. Their avatar (on the left) is
// left alone: the bubble moves away from it.
// The thread sets data-reply-bubble only while replying is possible.
//
// Coexists with the thread's other gestures the same way
// useSwipeToRevealTimes does, and never touches the frozen keyboard/
// viewport/scroll code:
// - Passive pointer listeners on the list (touch-action: pan-y there), so
//   native vertical scroll wins and sends pointercancel; no non-passive
//   touchmove anywhere.
// - Direction lock via the shared lockDirection()/classifySwipe(): only
//   "reply" (right, started on a bubble outside the edge strip) is ours;
//   useSwipeToRevealTimes only takes leftward drags, so the times never
//   move with it.
// - Touch/pen only; mouse drags stay text selection. A start while text is
//   selected is ignored (long-press selection).
// - Only one bubble, its arrow and (mine) its avatar get inline styles, during the gesture
//   and its spring back; nothing reads/writes scrollTop or sizes.
// - The click that ends a real drag is swallowed (capture phase), so a drag
//   ending on the avatar button never navigates. Taps/long-presses never
//   pass the slop, so they're untouched.
// - prefers-reduced-motion: the row still follows the finger (direct
//   manipulation) but snaps back with no spring.

const SPRING_BACK = "transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease-out";
const ARROW_SIZE_PX = 28;
const AVATAR_FADE_PX = 16;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function hasTextSelection(): boolean {
  const selection = document.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
}

function lightHaptic() {
  // Fire-and-forget. Native: the Haptics plugin (already used by BottomNav
  // and Avatar). Web: navigator.vibrate where it exists (Android); a no-op
  // on iOS Safari, which has no vibration API.
  try {
    if (Capacitor.isNativePlatform()) void Haptics.impact({ style: ImpactStyle.Light });
    else navigator.vibrate?.(8);
  } catch {
    // Never let feedback break the gesture.
  }
}

export function useSwipeToReply(listRef: RefObject<HTMLElement | null>, enabled: boolean, onReply: (messageId: string) => void) {
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;

  useEffect(() => {
    const list = listRef.current;
    if (!enabled || !list) return;

    let pointerId: number | null = null;
    let phase: "idle" | "pending" | "dragging" = "idle";
    let startX = 0;
    let startY = 0;
    let messageId = "";
    let bubble: HTMLElement | null = null;
    let arrow: HTMLElement | null = null;
    let avatar: HTMLElement | null = null;
    let startInEdge = false;
    let arrowBaseX = 0;
    let offset = 0;
    let frame = 0;
    let suppressClickUntil = 0;
    const settling = new Set<number>();

    const paint = () => {
      frame = 0;
      if (!bubble || !arrow) return;
      const progress = replyProgress(offset);
      bubble.style.transform = `translate3d(${offset}px, 0, 0)`;
      arrow.style.opacity = String(progress);
      // Gone well before the bubble reaches it (the gap is 8 px).
      if (avatar) avatar.style.opacity = String(Math.max(0, 1 - offset / AVATAR_FADE_PX));
      // Centred in the strip the bubble uncovers on its left, growing in.
      const strip = Math.min(offset, 60);
      const x = arrowBaseX + Math.max(0, strip - ARROW_SIZE_PX) / 2;
      arrow.style.transform = `translate3d(${x}px, 0, 0) scale(${0.6 + 0.4 * progress})`;
    };
    const schedulePaint = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const cancelFrame = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    const springBack = () => {
      cancelFrame();
      const c = bubble;
      const a = arrow;
      const v = avatar;
      arrow = null;
      bubble = null;
      avatar = null;
      offset = 0;
      if (!c || !a) return;
      const clear = () => {
        c.style.transform = "";
        c.style.transition = "";
        c.style.willChange = "";
        a.style.transform = "";
        a.style.transition = "";
        a.style.opacity = "";
        if (v) {
          v.style.transition = "";
          v.style.opacity = "";
        }
      };
      if (prefersReducedMotion()) {
        clear();
        return;
      }
      c.style.transition = SPRING_BACK;
      a.style.transition = SPRING_BACK;
      c.style.transform = "translate3d(0, 0, 0)";
      a.style.opacity = "0";
      if (v) {
        v.style.transition = "opacity 200ms ease-out";
        v.style.opacity = "1";
      }
      const t = window.setTimeout(() => {
        settling.delete(t);
        clear();
      }, 300);
      settling.add(t);
    };

    const begin = () => {
      const row = bubble?.closest<HTMLElement>("[data-reply-row]");
      arrow = row?.querySelector<HTMLElement>("[data-reply-arrow]") ?? null;
      if (!row || !bubble || !arrow) {
        phase = "idle";
        pointerId = null;
        bubble = null;
        arrow = null;
        return false;
      }
      // The bubble's resting left edge, relative to the row: the strip it
      // uncovers (and the arrow) grows rightward from there.
      const bubbleRect = bubble.getBoundingClientRect();
      arrowBaseX = bubbleRect.left - row.getBoundingClientRect().left;
      // Fade the avatar only if it's in the bubble's path (to its right).
      const av = row.querySelector<HTMLElement>("[data-reply-avatar]");
      avatar = av && av.getBoundingClientRect().left >= bubbleRect.right - 1 ? av : null;
      if (avatar) avatar.style.transition = "";
      // A new drag during the previous one's spring back: that row is
      // already at rest values, so just drop its pending cleanup instead of
      // letting it wipe this drag's styles if it's the same row.
      for (const t of settling) window.clearTimeout(t);
      settling.clear();
      bubble.style.transition = "";
      bubble.style.willChange = "transform";
      arrow.style.transition = "";
      phase = "dragging";
      return true;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      if (phase === "dragging") return;
      phase = "idle";
      pointerId = null;
      if (hasTextSelection()) return;
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-reply-bubble]") : null;
      if (!target || !list.contains(target)) return;
      const id = target.dataset.replyBubble;
      if (!id) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      messageId = id;
      bubble = target;
      const root = list.closest("[data-swipe-back-root]");
      startInEdge = isEdgeStart(e.clientX - (root ? root.getBoundingClientRect().left : 0));
      phase = "pending";
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      if (phase === "pending") {
        const action = classifySwipe(lockDirection(dx, e.clientY - startY), { onBubble: true, inEdge: startInEdge });
        if (action === "pending") return;
        if (action !== "reply") {
          phase = "idle";
          pointerId = null;
          bubble = null;
          return;
        }
        if (!begin()) return;
      }
      if (phase !== "dragging") return;
      const next = replyDragOffset(dx);
      if (crossedReplyThreshold(offset, next)) lightHaptic();
      offset = next;
      schedulePaint();
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      const wasDragging = phase === "dragging";
      phase = "idle";
      if (!wasDragging) {
        bubble = null;
        return;
      }
      suppressClickUntil = Date.now() + 400;
      const fire = e.type === "pointerup" && isPastReplyThreshold(offset);
      const id = messageId;
      springBack();
      // Synchronously inside the pointerup (a user gesture), so the
      // caller may focus the composer the same way ChatComposer's send
      // button does.
      if (fire) onReplyRef.current(id);
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
      for (const t of settling) window.clearTimeout(t);
      settling.clear();
      cancelFrame();
      if (bubble) {
        bubble.style.transform = "";
        bubble.style.transition = "";
        bubble.style.willChange = "";
      }
      if (avatar) {
        avatar.style.transition = "";
        avatar.style.opacity = "";
      }
      if (arrow) {
        arrow.style.transform = "";
        arrow.style.transition = "";
        arrow.style.opacity = "";
      }
    };
  }, [listRef, enabled]);
}

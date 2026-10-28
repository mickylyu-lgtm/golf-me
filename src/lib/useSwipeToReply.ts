import { useEffect, useRef, type RefObject } from "react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { crossedReplyThreshold, isPastReplyThreshold, lockDirection, replyDragOffset, replyProgress } from "./chatSwipe";
import { isEdgeStart } from "./edgeSwipeBack";

// Swipe RIGHT on a message bubble to reply (Micky, 2026-10-26), like
// Instagram/WhatsApp. The bubble's row follows the finger with a reply
// arrow fading in behind it; crossing REPLY_THRESHOLD_PX fires one light
// haptic; letting go past it calls onReply(messageId). Always springs back.
//
// DOM contract (DirectMessageThread renders it):
//   [data-reply-row]                    static row, position: relative
//     [data-reply-arrow]                the arrow, absolutely positioned
//     [data-reply-content]              what moves (avatar + bubble + time)
//       [data-reply-bubble="<msg id>"]  a drag must START on this
//
// Coexists with the thread's other gestures the same way
// useSwipeToRevealTimes does, and never touches the frozen keyboard/
// viewport/scroll code:
// - Passive pointer listeners on the list (touch-action: pan-y there), so
//   native vertical scroll wins and sends pointercancel; no non-passive
//   touchmove anywhere.
// - Direction lock via the shared lockDirection(): only "right" is ours;
//   "left" is swipe-to-reveal-times, "vertical" is scroll.
// - Starts inside the edge-swipe-back strip (EDGE_PX from the left of
//   [data-swipe-back-root]) are ignored, so that strip always means "back".
// - Touch/pen only; mouse drags stay text selection. A start while text is
//   selected is ignored (long-press selection).
// - Only one row's content and arrow get inline styles, during the gesture
//   and its spring back; nothing reads/writes scrollTop or sizes.
// - The click that ends a real drag is swallowed (capture phase), so a drag
//   ending on the avatar button never navigates. Taps/long-presses never
//   pass the slop, so they're untouched.
// - prefers-reduced-motion: the row still follows the finger (direct
//   manipulation) but snaps back with no spring.

const SPRING_BACK = "transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease-out";
const ARROW_SIZE_PX = 28;

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
    let content: HTMLElement | null = null;
    let arrow: HTMLElement | null = null;
    let arrowBaseX = 0;
    let offset = 0;
    let frame = 0;
    let suppressClickUntil = 0;
    const settling = new Set<number>();

    const paint = () => {
      frame = 0;
      if (!content || !arrow) return;
      const progress = replyProgress(offset);
      content.style.transform = `translate3d(${offset}px, 0, 0)`;
      arrow.style.opacity = String(progress);
      // Centred in the strip the moving content uncovers, growing in.
      const x = arrowBaseX + Math.max(0, Math.min(offset, 60) - ARROW_SIZE_PX) / 2;
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
      const c = content;
      const a = arrow;
      content = null;
      arrow = null;
      bubble = null;
      offset = 0;
      if (!c || !a) return;
      const clear = () => {
        c.style.transform = "";
        c.style.transition = "";
        c.style.willChange = "";
        a.style.transform = "";
        a.style.transition = "";
        a.style.opacity = "";
      };
      if (prefersReducedMotion()) {
        clear();
        return;
      }
      c.style.transition = SPRING_BACK;
      a.style.transition = SPRING_BACK;
      c.style.transform = "translate3d(0, 0, 0)";
      a.style.opacity = "0";
      const t = window.setTimeout(() => {
        settling.delete(t);
        clear();
      }, 300);
      settling.add(t);
    };

    const begin = () => {
      const row = bubble?.closest<HTMLElement>("[data-reply-row]");
      content = row?.querySelector<HTMLElement>("[data-reply-content]") ?? null;
      arrow = row?.querySelector<HTMLElement>("[data-reply-arrow]") ?? null;
      if (!row || !content || !arrow) {
        phase = "idle";
        pointerId = null;
        content = null;
        arrow = null;
        return false;
      }
      // Where the moving content's leftmost child starts (the avatar for
      // their messages, the bubble for mine): the arrow appears there.
      const rowLeft = row.getBoundingClientRect().left;
      let left = Infinity;
      for (const child of Array.from(content.children)) {
        const r = child.getBoundingClientRect();
        if (r.width > 0 && getComputedStyle(child).position !== "absolute") left = Math.min(left, r.left);
      }
      arrowBaseX = Number.isFinite(left) ? Math.max(0, left - rowLeft) : 0;
      // A new drag during the previous one's spring back: that row is
      // already at rest values, so just drop its pending cleanup instead of
      // letting it wipe this drag's styles if it's the same row.
      for (const t of settling) window.clearTimeout(t);
      settling.clear();
      content.style.transition = "";
      content.style.willChange = "transform";
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
      const root = list.closest("[data-swipe-back-root]");
      const rootLeft = root ? root.getBoundingClientRect().left : 0;
      if (isEdgeStart(e.clientX - rootLeft)) return;
      const id = target.dataset.replyBubble;
      if (!id) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      messageId = id;
      bubble = target;
      phase = "pending";
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      if (phase === "pending") {
        const direction = lockDirection(dx, e.clientY - startY);
        if (direction === "pending") return;
        if (direction !== "right") {
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
      if (content) {
        content.style.transform = "";
        content.style.transition = "";
        content.style.willChange = "";
      }
      if (arrow) {
        arrow.style.transform = "";
        arrow.style.transition = "";
        arrow.style.opacity = "";
      }
    };
  }, [listRef, enabled]);
}

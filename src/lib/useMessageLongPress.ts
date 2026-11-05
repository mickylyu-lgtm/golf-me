import { useEffect, useRef, type RefObject } from "react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { LONG_PRESS_MS, longPressCancelledByMove, longPressSurvivesCancel } from "./messageLongPress";

// Opens a DM bubble's actions menu (reactions, Reply, Copy, Unsend) by:
//   - touch / pen: holding the bubble still for LONG_PRESS_MS (iPhone app
//     and iPhone Safari, Android);
//   - mouse: right-click (contextmenu), desktop;
//   - Android Chrome also fires contextmenu on a long-press: handled once.
// DOM contract: the bubble carries data-actions-bubble="<message id>"
// (DirectMessageThread sets it on every non-unsent bubble, and gives those
// bubbles -webkit-touch-callout:none + no text selection on touch screens
// so iOS doesn't open its own selection callout on the hold; Copy is in
// the menu instead).
//
// iOS hardening (WKWebView in the Capacitor app, and Safari):
//   - WebKit may answer a still hold with pointercancel/touchcancel when its
//     own long-press recogniser claims the touch. That is the user holding,
//     not a scroll, so a cancel without movement past the slop keeps the
//     press running (lib/messageLongPress.ts longPressSurvivesCancel). A
//     real scroll still cancels: it moves past the slop and fires `scroll`.
//     After such a cancel no pointerup will come, so touchend also ends the
//     press (a short tap still never opens the menu).
//   - Touch events start a press too when no pointerdown did (belt and
//     braces; pointerdown normally arrives first and wins).
//
// Coexists with useSwipeToReply / useSwipeToRevealTimes / native scroll
// the way they coexist with each other: passive listeners on the list, and
// any movement past the shared AXIS_SLOP_PX (the distance that starts a
// swipe or a scroll) cancels the press (lib/messageLongPress.ts). The click
// that ends a completed long-press is swallowed, so lifting the finger
// never also taps a quote or the avatar. Never touches scroll or sizes.
export function useMessageLongPress(
  listRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  onOpen: (messageId: string, bubble: HTMLElement) => void,
) {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const list = listRef.current;
    if (!enabled || !list) return;

    let timer = 0;
    let pointerId: number | null = null;
    let touchId: number | null = null;
    let startX = 0;
    let startY = 0;
    // Last position seen for the press: a cancel event's own coordinates
    // can be 0,0 in WebKit, so the "did it move" check uses these.
    let lastX = 0;
    let lastY = 0;
    let firedAt = 0;

    const bubbleOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>("[data-actions-bubble]") : null;

    const cancel = () => {
      window.clearTimeout(timer);
      timer = 0;
      pointerId = null;
      touchId = null;
    };

    const open = (bubble: HTMLElement) => {
      const id = bubble.dataset.actionsBubble;
      if (!id) return;
      firedAt = Date.now();
      try {
        if (Capacitor.isNativePlatform()) void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
        else navigator.vibrate?.(10);
      } catch {
        // Feedback never breaks the gesture.
      }
      onOpenRef.current(id, bubble);
    };

    const start = (bubble: HTMLElement, x: number, y: number) => {
      window.clearTimeout(timer);
      startX = lastX = x;
      startY = lastY = y;
      timer = window.setTimeout(() => {
        timer = 0;
        pointerId = null;
        touchId = null;
        if (bubble.isConnected) open(bubble);
      }, LONG_PRESS_MS);
    };
    const moved = (x: number, y: number) => {
      lastX = x;
      lastY = y;
      if (timer && longPressCancelledByMove(x - startX, y - startY)) cancel();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      const bubble = bubbleOf(e.target);
      if (!bubble) {
        cancel();
        return;
      }
      cancel();
      pointerId = e.pointerId;
      start(bubble, e.clientX, e.clientY);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId === pointerId) moved(e.clientX, e.clientY);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId === pointerId) cancel();
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!longPressSurvivesCancel(lastX - startX, lastY - startY)) cancel();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        cancel();
        return;
      }
      const touch = e.changedTouches[0];
      if (!touch) return;
      touchId = touch.identifier;
      // pointerdown (which comes first) already started this press.
      if (timer) return;
      const bubble = bubbleOf(e.target);
      if (bubble) start(bubble, touch.clientX, touch.clientY);
    };
    const touchOf = (e: TouchEvent) => [...e.changedTouches].find((t) => t.identifier === touchId);
    const onTouchMove = (e: TouchEvent) => {
      const touch = touchOf(e);
      if (touch) moved(touch.clientX, touch.clientY);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (touchOf(e)) cancel();
    };
    const onTouchCancel = (e: TouchEvent) => {
      if (touchOf(e) && !longPressSurvivesCancel(lastX - startX, lastY - startY)) cancel();
    };

    const onContextMenu = (e: MouseEvent) => {
      const bubble = bubbleOf(e.target);
      if (!bubble) return;
      e.preventDefault();
      // A touch long-press that already opened the menu (Android follows
      // it with contextmenu): don't open it twice. A mouse right-click
      // always opens it.
      const fromMouse = (e as Partial<PointerEvent>).pointerType === "mouse";
      if (!fromMouse && Date.now() - firedAt < 1000) return;
      cancel();
      open(bubble);
    };
    const onClickCapture = (e: MouseEvent) => {
      if (Date.now() - firedAt < 700) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    list.addEventListener("pointerdown", onPointerDown, { passive: true });
    list.addEventListener("pointermove", onPointerMove, { passive: true });
    list.addEventListener("pointerup", onPointerUp, { passive: true });
    list.addEventListener("pointercancel", onPointerCancel, { passive: true });
    list.addEventListener("touchstart", onTouchStart, { passive: true });
    list.addEventListener("touchmove", onTouchMove, { passive: true });
    list.addEventListener("touchend", onTouchEnd, { passive: true });
    list.addEventListener("touchcancel", onTouchCancel, { passive: true });
    list.addEventListener("scroll", cancel, { passive: true });
    list.addEventListener("contextmenu", onContextMenu);
    list.addEventListener("click", onClickCapture, true);
    return () => {
      cancel();
      list.removeEventListener("pointerdown", onPointerDown);
      list.removeEventListener("pointermove", onPointerMove);
      list.removeEventListener("pointerup", onPointerUp);
      list.removeEventListener("pointercancel", onPointerCancel);
      list.removeEventListener("touchstart", onTouchStart);
      list.removeEventListener("touchmove", onTouchMove);
      list.removeEventListener("touchend", onTouchEnd);
      list.removeEventListener("touchcancel", onTouchCancel);
      list.removeEventListener("scroll", cancel);
      list.removeEventListener("contextmenu", onContextMenu);
      list.removeEventListener("click", onClickCapture, true);
    };
  }, [listRef, enabled]);
}

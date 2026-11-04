import { useEffect, useRef, type RefObject } from "react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { LONG_PRESS_MS, longPressCancelledByMove } from "./messageLongPress";

// Opens a DM bubble's actions menu (Unsend) by:
//   - touch / pen: holding the bubble still for LONG_PRESS_MS (iPhone app
//     and iPhone Safari, Android);
//   - mouse: right-click (contextmenu), desktop;
//   - Android Chrome also fires contextmenu on a long-press: handled once.
// DOM contract: the bubble carries data-actions-bubble="<message id>"
// (DirectMessageThread sets it only on my own messages that can still be
// unsent, and gives those bubbles -webkit-touch-callout:none + no text
// selection so iOS doesn't open its own selection callout on the hold).
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
    let startX = 0;
    let startY = 0;
    let firedAt = 0;

    const bubbleOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>("[data-actions-bubble]") : null;

    const cancel = () => {
      window.clearTimeout(timer);
      timer = 0;
      pointerId = null;
    };

    const open = (bubble: HTMLElement) => {
      const id = bubble.dataset.actionsBubble;
      if (!id) return;
      firedAt = Date.now();
      try {
        if (Capacitor.isNativePlatform()) void Haptics.impact({ style: ImpactStyle.Medium });
        else navigator.vibrate?.(10);
      } catch {
        // Feedback never breaks the gesture.
      }
      onOpenRef.current(id, bubble);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      const bubble = bubbleOf(e.target);
      if (!bubble) return;
      cancel();
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      timer = window.setTimeout(() => {
        timer = 0;
        pointerId = null;
        open(bubble);
      }, LONG_PRESS_MS);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (longPressCancelledByMove(e.clientX - startX, e.clientY - startY)) cancel();
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerId === pointerId) cancel();
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
    list.addEventListener("pointerup", onPointerEnd, { passive: true });
    list.addEventListener("pointercancel", onPointerEnd, { passive: true });
    list.addEventListener("scroll", cancel, { passive: true });
    list.addEventListener("contextmenu", onContextMenu);
    list.addEventListener("click", onClickCapture, true);
    return () => {
      cancel();
      list.removeEventListener("pointerdown", onPointerDown);
      list.removeEventListener("pointermove", onPointerMove);
      list.removeEventListener("pointerup", onPointerEnd);
      list.removeEventListener("pointercancel", onPointerEnd);
      list.removeEventListener("scroll", cancel);
      list.removeEventListener("contextmenu", onContextMenu);
      list.removeEventListener("click", onClickCapture, true);
    };
  }, [listRef, enabled]);
}

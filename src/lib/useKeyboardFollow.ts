import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { Capacitor } from "@capacitor/core";
import { chatMotionActive } from "./chatMotion";
import { followHeight, insetAt, planFollow, slideDuration } from "./keyboard/follow";
import { getKeyboardSlideMs, getKeyboardWillAt } from "./useKeyboardHeight";

const IS_NATIVE = Capacitor.isNativePlatform();

// Makes a chat box (DirectMessageThread, useChatViewportBox) follow the iOS
// keyboard's slide instead of taking its new height in the frame the slide
// starts (the maths and the why: lib/keyboard/follow.ts).
//
// Who owns what:
// - React still owns the layout. The caller's boxHeight (its inline
//   style.height, from the keyboard store's WillShow/WillHide height) is
//   unchanged and is what the box ends at.
// - This hook only owns the frames in between, native app only: in the
//   layout effect of the commit that changed the keyboard height (before
//   that frame paints) it puts the box where the slide is now (timed from
//   the Will* event, so a frame or two of React work doesn't make it
//   trail the keyboard), then once per animation frame writes one
//   interpolated style.height and,
//   if the reader was at the newest message (nearBottomRef, the caller's
//   own rule), re-pins the list's scrollTop. When the slide ends, React's
//   own style.height string is put back (same px). No React state, no
//   re-render per frame, nothing else in the layout moves: the header and
//   the page above the box are never touched, and a reader scrolled up
//   keeps their scrollTop.
// - A new keyboard height mid-slide (reopened while closing, emoji /
//   QuickType height change) continues from the height on screen now. If
//   anything else writes the box's height meanwhile (a re-measure on
//   rotation), that write wins and the motion stops.
// - Web (Safari/PWA): off. There the height comes from visualViewport
//   events, which arrive when Safari has moved its keyboard; nothing to
//   interpolate, and no native curve to pretend to.
// - CHAT_MOTION off, the founder's About switch off, Reduce Motion or a
//   hidden page: off, i.e. exactly the old instant resize.
export function useKeyboardFollow({
  enabled,
  boxRef,
  listRef,
  nearBottomRef,
  keyboardInset,
  boxHeight,
}: {
  enabled: boolean;
  boxRef: RefObject<HTMLElement | null>;
  listRef: RefObject<HTMLElement | null>;
  nearBottomRef: RefObject<boolean>;
  keyboardInset: number;
  boxHeight: string | undefined;
}): void {
  const on = enabled && IS_NATIVE;
  // The keyboard inset the box is showing right now (mid-slide: the
  // interpolated one), so an interrupted slide continues from the screen.
  const shownInsetRef = useRef(keyboardInset);
  // The box's height with the keyboard closed (above the tab bar), measured
  // from the committed layout whenever the keyboard is closed.
  const closedHRef = useRef<number | null>(null);
  // Box height + keyboard inset of the last committed open layout (the
  // height the box would have with no keyboard and no tab bar).
  const fullHRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const from = shownInsetRef.current;
    const to = keyboardInset;
    shownInsetRef.current = to;
    if (!on || !box || boxHeight === undefined) return;
    // React's committed value: what the box ends at, put back afterwards.
    const target = box.style.height;
    const rect = box.getBoundingClientRect();
    // Both ends come from committed layouts, never re-derived from the
    // viewport: if the caller's own maths is off (a stale box top), the
    // motion still ends exactly on its value, with no jump at the end.
    if (to === 0) closedHRef.current = rect.height;
    else fullHRef.current = rect.height + to;
    if (from === to || !chatMotionActive() || typeof window.requestAnimationFrame !== "function") return;
    const fullH = fullHRef.current ?? window.innerHeight - rect.top;
    const plan = planFollow({ fullH, closedH: closedHRef.current, fromInset: from, toInset: to });
    if (!plan) return;
    const duration = slideDuration(getKeyboardSlideMs(to > from ? "show" : "hide"));
    // The slide started when its Will* event arrived, a frame or two before
    // this commit; timing from here would trail the keyboard. An event older
    // than the slide itself didn't cause this change.
    const now = performance.now();
    const willAt = getKeyboardWillAt();
    const start = willAt !== null && now - willAt >= 0 && now - willAt < duration ? willAt : now;
    const list = listRef.current;
    let written = "";
    let frame = 0;
    const pin = () => {
      if (list && nearBottomRef.current) list.scrollTop = list.scrollHeight;
    };
    const write = (inset: number) => {
      shownInsetRef.current = inset;
      box.style.height = `${followHeight(plan, inset)}px`;
      // As the style serialises it (rounded), for the "someone else wrote"
      // check.
      written = box.style.height;
      pin();
    };
    const step = () => {
      frame = 0;
      // Someone else set the height: theirs wins.
      if (box.style.height !== written) {
        shownInsetRef.current = to;
        return;
      }
      const elapsed = performance.now() - start;
      if (elapsed >= duration) {
        shownInsetRef.current = to;
        box.style.height = target;
        pin();
        return;
      }
      write(insetAt(plan, elapsed, duration));
      frame = requestAnimationFrame(step);
    };
    // The frame about to paint: where the slide is now (the old height if
    // it has only just started).
    write(insetAt(plan, now - start, duration));
    frame = requestAnimationFrame(step);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      // Interrupted (a new keyboard height, unmount): hand the box back to
      // React's value unless React has already written a new one. The next
      // run continues from shownInsetRef.
      if (box.style.height === written) box.style.height = target;
    };
  }, [on, keyboardInset, boxHeight, boxRef, listRef, nearBottomRef]);
}

import { useEffect, useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { Capacitor } from "@capacitor/core";
import { useKeyboardHeight } from "./useKeyboardHeight";
import { useWebKeyboardInset } from "./useWebKeyboardInset";
import { lockPageScroll } from "./scrollLock";
import { pinToBottom } from "./chatScroll";

const IS_NATIVE = Capacitor.isNativePlatform();

// A full-screen chat's box (header above it, message list + composer inside
// it), sized to end exactly at the keyboard's top, or above the bottom nav
// when the keyboard is closed. This is DirectMessageThread's layout --
// verified on a physical iPhone, and kept inline in that (frozen) file --
// as a hook, so round chat's full-screen thread (GroupChat layout "page")
// gets the same behaviour instead of docking its composer over the
// keyboard and scrolling the whole page (which slid the thread's header and
// Back button off the top while typing).
//
// - The keyboard's height: the Capacitor plugin's own keyboardWillShow
//   height in the app (100dvh doesn't follow Keyboard resize:"body"), the
//   visual viewport on the web (useWebKeyboardInset, which also undoes
//   Safari's focus pan). Exactly one source per platform.
// - Only the list scrolls; the page is scroll-locked from the first frame.
// - boxTop is measured before the first paint, and the list re-pinned in
//   the same frame, so the thread never paints unsized or at its oldest
//   message.
// - The list re-pins to the bottom on keyboard open/close (same frame, a
//   layout effect) and on any other size change (composer growth, rotation:
//   ResizeObserver), but only while the reader was near the bottom.
export function useChatViewportBox({
  enabled,
  boxRef,
  listRef,
  nearBottomRef,
}: {
  enabled: boolean;
  boxRef: RefObject<HTMLElement | null>;
  listRef: RefObject<HTMLElement | null>;
  nearBottomRef: RefObject<boolean>;
}): string | undefined {
  const [boxTop, setBoxTop] = useState<number | null>(null);
  const keyboardHeight = useKeyboardHeight();
  const webKeyboardInset = useWebKeyboardInset(enabled && !IS_NATIVE, boxRef);
  const keyboardInset = !enabled ? 0 : IS_NATIVE ? keyboardHeight : webKeyboardInset;

  useLayoutEffect(() => {
    if (!enabled) {
      setBoxTop(null);
      return;
    }
    // The box is sized for a page sitting at the top (and the page is then
    // locked there). Arriving at an offset -- a Back/forward scroll restore,
    // a fling still running from the previous page -- would otherwise
    // measure, and lock in, a box that runs off the screen.
    if (window.scrollY !== 0) window.scrollTo(0, 0);
    const measure = () => setBoxTop(boxRef.current?.getBoundingClientRect().top ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [enabled, boxRef]);

  useLayoutEffect(() => (enabled ? lockPageScroll() : undefined), [enabled]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (enabled && el && nearBottomRef.current) pinToBottom(el);
  }, [enabled, keyboardInset, boxTop, listRef, nearBottomRef]);

  useEffect(() => {
    const el = listRef.current;
    if (!enabled || !el) return;
    const ro = new ResizeObserver(() => {
      if (nearBottomRef.current) pinToBottom(el);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, listRef, nearBottomRef]);

  if (!enabled || boxTop === null) return undefined;
  return keyboardInset > 0
    ? `${window.innerHeight - boxTop - keyboardInset}px`
    : `calc(${window.innerHeight}px - ${boxTop}px - 4.25rem - env(safe-area-inset-bottom))`;
}

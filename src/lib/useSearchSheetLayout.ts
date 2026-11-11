import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { Capacitor } from "@capacitor/core";
import { getKeyboardSlideMs, useKeyboardHeight } from "./useKeyboardHeight";
import { keyboardMotionActive } from "./keyboard/smoothScroll";
import { textEntryElement } from "./keyboard/fields";
import { searchSheetLayout } from "./searchSheetLayout";
import { scrollerRevealDelta } from "./minimalReveal";

// Local to SearchModal. No window scrolling, native-plugin changes or shared
// chat viewport changes. The native signal and web viewport never stack.
export function useSearchSheetLayout(chromeRef: RefObject<HTMLDivElement | null>, searchHeaderRef: RefObject<HTMLDivElement | null>): {
  overlayStyle: CSSProperties; sheetStyle: CSSProperties; chromeStyle: CSSProperties; resultsStyle: CSSProperties; headingStyle: CSSProperties;
} {
  const keyboardHeight = useKeyboardHeight();
  const native = Capacitor.isNativePlatform();
  const baseline = useRef({ height: window.innerHeight, width: window.innerWidth });
  const focusSession = useRef(false);
  const [viewport, setViewport] = useState(() => ({ ...baseline.current, bottom: window.innerHeight }));
  const [chromeHeight, setChromeHeight] = useState(200);
  const [minimumChrome, setMinimumChrome] = useState(110);

  useLayoutEffect(() => {
    const chrome = chromeRef.current;
    const toolbar = searchHeaderRef.current;
    const vv = window.visualViewport;
    function update() {
      const field = textEntryElement(document.activeElement);
      const focused = Boolean(field && chrome?.contains(field));
      const width = window.innerWidth;
      const height = window.innerHeight;
      const bottom = !native && vv && Math.abs(vv.scale - 1) < 0.01
        ? Math.min(height, vv.height + vv.offsetTop)
        : height;
      // Android can resize innerHeight. Blur precedes keyboard dismissal:
      // retain the pre-focus baseline until the visible viewport recovers.
      if (focused) focusSession.current = true;
      const recovered = height >= baseline.current.height - 1 && bottom >= baseline.current.height - 1;
      if (width !== baseline.current.width || height > baseline.current.height ||
          (!focused && (!focusSession.current || recovered))) {
        baseline.current = { height, width };
        if (!focused) focusSession.current = false;
      }
      const next = { ...baseline.current, bottom };
      setViewport(previous => previous.height === next.height && previous.width === next.width && previous.bottom === next.bottom ? previous : next);
      if (chrome && toolbar) {
        const titleHeight = chrome.firstElementChild?.getBoundingClientRect().height ?? 0;
        setChromeHeight(titleHeight + toolbar.scrollHeight);
        setMinimumChrome(titleHeight + (toolbar.querySelector("input")?.getBoundingClientRect().height ?? 44) + 8);
        // Only cramped landscape / enlarged text needs this. The title/Close
        // remain fixed and results normally retain a touch-sized row. Follow the
        // toolbar's measured resize, never pan the page or reset list scroll.
        if (field && toolbar.contains(field)) {
          const rect = toolbar.getBoundingClientRect();
          const fieldRect = field.getBoundingClientRect();
          const gap = Math.min(4, Math.max(0, (rect.height - fieldRect.height) / 2));
          const delta = scrollerRevealDelta({ fieldTop: fieldRect.top, fieldBottom: fieldRect.bottom,
            scrollerTop: rect.top, scrollerBottom: rect.bottom, gap });
          if (Math.abs(delta) > 0.5) toolbar.scrollTop += delta;
        }
      }
    }
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (chrome) observer?.observe(chrome);
    if (toolbar) observer?.observe(toolbar);
    window.addEventListener("resize", update);
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, [chromeRef, searchHeaderRef, native]);

  const { top, bottom } = searchSheetLayout({ ...viewport, chromeHeight,
    visibleBottom: keyboardHeight > 0 ? viewport.height - keyboardHeight : viewport.bottom });
  // At large text sizes in landscape, prioritize Close and the full input.
  // Results get a usable row when it fits, otherwise return after dismissal.
  const safeTop = `max(${top}px, env(safe-area-inset-top, 0px))`;
  // Web viewport events already follow the keyboard. Native Will events are
  // targets, so transition the bottom edge, not the search field, alongside it.
  const duration = (native || keyboardHeight > 0) && keyboardMotionActive()
    ? `${getKeyboardSlideMs(keyboardHeight > 0 ? "show" : "hide") ?? 250}ms` : "0ms";
  return {
    headingStyle: bottom - top < 240 ? { paddingTop: 0, paddingBottom: 0 } : {},
    chromeStyle: { maxHeight: `min(100%, max(${minimumChrome}px, calc(100% - 64px)))` },
    // Resolve against the actual safe-area-adjusted sheet, not numeric top.
    resultsStyle: { paddingTop: 0, paddingBottom: 0 },
    overlayStyle: { alignItems: "flex-start", paddingTop: safeTop, paddingBottom: 0,
      transition: `padding-top ${duration} cubic-bezier(0.22, 1, 0.36, 1)` },
    sheetStyle: { height: `max(0px, calc(${bottom}px - ${safeTop}))`, maxHeight: "none",
      transition: `height ${duration} cubic-bezier(0.22, 1, 0.36, 1)` },
  };
}

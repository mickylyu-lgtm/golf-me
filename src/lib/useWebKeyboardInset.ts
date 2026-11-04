import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { textEntryElement } from "./keyboard/fields";
import { webKeyboardInset } from "./keyboard/webInset";

// Web-only keyboard height for a container that docks its own composer
// (DirectMessageThread). Returns 0 unless `enabled` (callers pass
// !Capacitor.isNativePlatform()), a text field inside `containerRef` has
// focus, and the visual viewport is shorter than the layout viewport by a
// keyboard's worth (lib/keyboard/webInset.ts).
//
// While it's non-zero, Safari's own focus pan is undone: iOS Safari scrolls
// the page (or offsets the visual viewport) to reveal the focused field,
// which slid the thread's header off the top and re-panned on every new
// line. The container is sized to end exactly at the visible bottom, so
// the field is already visible and the page goes back to the top. Only
// this page's own scroll, only on the web path; the native app's removed
// app-wide scrollTo(0,0) hack stays removed.
export function useWebKeyboardInset(enabled: boolean, containerRef: RefObject<HTMLElement | null>): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!enabled || !vv) {
      setInset(0);
      return;
    }
    const update = () => {
      const active = textEntryElement(document.activeElement);
      const fieldFocused = Boolean(active && containerRef.current?.contains(active));
      const next = webKeyboardInset({ innerHeight: window.innerHeight, viewportHeight: vv.height, scale: vv.scale, fieldFocused });
      setInset(next);
      if (next > 0 && (window.scrollY !== 0 || vv.offsetTop !== 0)) window.scrollTo(0, 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, [enabled, containerRef]);

  return inset;
}

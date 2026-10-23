import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// React Router doesn't reset scroll position on navigation by itself (that's
// a browser-native behavior SPAs lose) -- without this, navigating from
// partway down a long list (Community, Play, a Golf Call thread) straight
// into a new page could land the user mid-scroll on content that hasn't
// rendered there yet, looking blank until they scroll up manually. Resets
// on every new route, including switching between root tabs
// (Home/Play/Chat/Caddie/Me), which are each their own path.
//
// Back/forward (POP) instead returns to where that history entry was left,
// like a browser does: Back from a post lands on the same spot in the feed
// rather than the top of Home (2026-10-22). Positions are kept per history
// entry (location.key), in memory only.
//
// Layout effect, not a passive one: the new page must not paint a frame at
// the old page's offset before jumping.

const savedScrollByKey = new Map<string, number>();
// The page being returned to may still be growing for a few frames (root
// tabs remount and measure), so the restore retries briefly until it lands.
const MAX_RESTORE_FRAMES = 30;

export function ScrollToTop() {
  const { pathname, key } = useLocation();
  const navigationType = useNavigationType();
  const lastScrollYRef = useRef(0);
  const prevRef = useRef<{ key: string; pathname: string } | null>(null);

  useEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    lastScrollYRef.current = window.scrollY;
    const onScroll = () => {
      lastScrollYRef.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { key, pathname };
    if (prev) savedScrollByKey.set(prev.key, lastScrollYRef.current);
    // Same page, different query string: never moved the page before either.
    if (prev && prev.pathname === pathname) return;

    const saved = navigationType === "POP" ? savedScrollByKey.get(key) : undefined;
    if (saved === undefined || saved <= 0) {
      window.scrollTo(0, 0);
      return;
    }

    let frames = 0;
    let rafId = 0;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
    // The golfer touching the screen takes over; never fight their scroll.
    window.addEventListener("touchstart", cancel, { passive: true, once: true });
    window.addEventListener("wheel", cancel, { passive: true, once: true });
    const attempt = () => {
      if (cancelled) return;
      window.scrollTo(0, saved);
      if (Math.abs(window.scrollY - saved) <= 1 || ++frames >= MAX_RESTORE_FRAMES) return;
      rafId = requestAnimationFrame(attempt);
    };
    attempt();
    return () => {
      cancel();
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("wheel", cancel);
    };
  }, [key, pathname, navigationType]);

  return null;
}

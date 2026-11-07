import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { chatMotionActive } from "./chatMotion";
import { ROUTE_MOTION_EASE, ROUTE_MOTION_MS, chatRouteMotion, consumeChatRouteMotionSkip, routeMotionKeyframes } from "./chatRouteMotion";
import type { NavAction } from "./chatRouteMotion";

// AppShell: animates its content column (`contentRef`) on route changes
// into / out of a conversation (rules and why: lib/chatRouteMotion.ts).
// The column's parent clips horizontal overflow while it runs.
export function useChatRouteMotion(contentRef: RefObject<HTMLElement | null>): void {
  const location = useLocation();
  const action = useNavigationType() as NavAction;
  const prevPathRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const from = prevPathRef.current;
    const to = location.pathname;
    prevPathRef.current = to;
    if (consumeChatRouteMotionSkip(from) || from === null) return;
    const motion = chatRouteMotion(from, to, action);
    const el = contentRef.current;
    if (!motion || !el || typeof el.animate !== "function" || !chatMotionActive()) return;
    const clip = el.parentElement;
    if (clip) clip.style.overflowX = "clip";
    const animation = el.animate(routeMotionKeyframes(motion), { duration: ROUTE_MOTION_MS, easing: ROUTE_MOTION_EASE });
    const release = () => {
      if (clip) clip.style.overflowX = "";
    };
    animation.onfinish = release;
    return () => {
      // The next route change (or unmount) ends this one where it is.
      animation.onfinish = null;
      animation.cancel();
      release();
    };
    // location.key: every navigation, including a repeat of the same path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
}

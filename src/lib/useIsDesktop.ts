import { useSyncExternalStore } from "react";

// True at Tailwind's `lg` breakpoint and up (>= 1024px wide): the desktop
// layout. Used only where a desktop-only piece must not even mount on a
// phone (the chat list pane next to an open conversation), so phones keep
// exactly today's component tree. Pure styling differences use `lg:`
// classes instead.
const QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(QUERY).matches === true;
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

import { useCallback, useSyncExternalStore } from "react";

// True when the window is at least `minWidth` px wide. Default 1024 is
// Tailwind's `lg` (the desktop layout); 1280 is `xl`. Used only where a
// desktop-only piece must not even mount on a phone (the chat list pane
// next to an open conversation), so phones keep exactly today's component
// tree. Pure styling differences use `lg:` / `xl:` classes instead.
export function useIsDesktop(minWidth = 1024): boolean {
  const query = `(min-width: ${minWidth}px)`;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = () => typeof window !== "undefined" && window.matchMedia?.(query).matches === true;
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

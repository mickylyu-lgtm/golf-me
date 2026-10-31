import { useEffect, useState } from "react";

// useState that survives the page unmounting for the rest of the app
// session -- e.g. Find's search box and tab, which used to reset every time
// a round was opened and Back was tapped (the root-tab carousel unmounts on
// any pushed route). sessionStorage only, so a fresh launch starts clean;
// blocked storage just falls back to plain state.
export function useSessionState<T extends string>(key: string, initial: T, isValid: (v: string) => v is T = (_v): _v is T => true) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.sessionStorage.getItem(key);
      return stored !== null && isValid(stored) ? stored : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // Storage blocked: the value just isn't kept.
    }
  }, [key, value]);
  return [value, setValue] as const;
}

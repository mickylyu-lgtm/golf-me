import { useEffect, useState } from "react";

// How many fullScreen loaders are mounted right now. EntryOverlay reads this
// as "the app is still getting ready": AppGate's session restore and the
// router's lazy-route Suspense fallback both render a fullScreen loader, so
// zero mounted means the first real screen is on the page underneath.
let fullScreenLoaderCount = 0;
const fullScreenLoaderListeners = new Set<() => void>();

export function getFullScreenLoaderCount(): number {
  return fullScreenLoaderCount;
}

export function subscribeFullScreenLoaders(listener: () => void): () => void {
  fullScreenLoaderListeners.add(listener);
  return () => {
    fullScreenLoaderListeners.delete(listener);
  };
}

export function useRegisterFullScreenLoader(active: boolean) {
  useEffect(() => {
    if (!active) return;
    fullScreenLoaderCount += 1;
    fullScreenLoaderListeners.forEach((l) => l());
    return () => {
      fullScreenLoaderCount -= 1;
      fullScreenLoaderListeners.forEach((l) => l());
    };
  }, [active]);
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReduced(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}


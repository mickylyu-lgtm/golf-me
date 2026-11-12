// Imported only by the local QA transform. Not part of the app/build graph.
import { useSyncExternalStore } from "react";

type Mode = "rounds" | "roundsLoading" | "golfersLoading" | "error" | "empty" | "needsLocation" | "golfers" | "demo";
let mode: Mode = "rounds";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => mode;
export function setMode(next: Mode) { mode = next; listeners.forEach(listener => listener()); }
function useMode() { return useSyncExternalStore(subscribe, snapshot); }
export function useFixtureData<T extends { currentUser: { playingAreaCoords?: unknown }; golfCalls: unknown[]; visibleGolfers: () => unknown[] }>(data: T): T {
  const state = useMode();
  return {
    ...data,
    currentUser: state === "needsLocation" ? { ...data.currentUser, playingAreaCoords: undefined } : data.currentUser,
    golfCalls: ["roundsLoading", "golfersLoading", "error", "empty", "golfers"].includes(state) ? [] : data.golfCalls,
    visibleGolfers: state === "empty" ? () => [] : data.visibleGolfers,
  };
}
export function useFixtureAuth<T extends { isDemo: boolean }>(auth: T): T {
  const state = useMode();
  return { ...auth, isDemo: state === "demo" || state === "rounds" || state === "golfers" || state === "needsLocation" };
}
export function useFixtureRounds<T>(rounds: T) {
  const state = useMode();
  return { ...rounds, hasLoaded: state !== "roundsLoading", loadError: state === "error", isLoading: state === "roundsLoading",
    retry: () => setMode("roundsLoading") };
}
export function useFixtureSocial<T>(social: T) {
  const state = useMode();
  return { ...social, hasLoaded: state !== "golfersLoading" };
}

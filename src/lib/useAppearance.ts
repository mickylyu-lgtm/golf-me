import { useLayoutEffect, useSyncExternalStore } from "react";
import { effectiveScheme, readAppearance, THEME_COLOR, writeAppearance, APPEARANCE_STORAGE_KEY, type AppearanceSetting, type ColorScheme } from "./appearance";
import { nativeAppearanceFor, syncNativeAppearance } from "./nativeAppearance";

// Applies the Appearance setting to the page: the `dark` class and
// color-scheme on <html> (the colour tokens in index.css flip on that class),
// plus <meta name="theme-color">. index.html's inline script has already done
// the same before first paint; this keeps it live afterwards (setting changes,
// the system switching in "Match iPhone" mode, another tab changing it).

const listeners = new Set<() => void>();
let setting: AppearanceSetting = "system";
let forcedLight = 0;
let installed = false;

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function systemQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
}

// gm-static-landing (index.html): the prerendered landing page is showing
// and the app hasn't mounted Welcome yet; it stays light like Welcome.
function landingShowing(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("gm-static-landing");
}

export function currentScheme(): ColorScheme {
  return effectiveScheme(setting, systemQuery()?.matches ?? false, forcedLight > 0 || landingShowing());
}

function apply() {
  if (typeof document === "undefined") return;
  const scheme = currentScheme();
  const root = document.documentElement;
  root.classList.toggle("dark", scheme === "dark");
  root.style.colorScheme = scheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[scheme]);
  syncNativeAppearance(nativeAppearanceFor(setting, forcedLight > 0 || landingShowing()));
}

function emit() {
  apply();
  for (const l of listeners) l();
}

export function installAppearance() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  setting = readAppearance(safeStorage());
  systemQuery()?.addEventListener("change", emit);
  window.addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== APPEARANCE_STORAGE_KEY) return;
    setting = readAppearance(safeStorage());
    emit();
  });
  apply();
}

export function setAppearance(next: AppearanceSetting) {
  setting = next;
  writeAppearance(safeStorage(), next);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useAppearanceSetting(): AppearanceSetting {
  return useSyncExternalStore(subscribe, () => setting, () => setting);
}

// Keeps the page light while the calling screen is mounted (the public
// landing page stays in its light design whatever the setting). A layout
// effect, so the screen's first paint is already light.
export function useForceLightAppearance() {
  useLayoutEffect(() => {
    forcedLight += 1;
    emit();
    return () => {
      forcedLight -= 1;
      emit();
    };
  }, []);
}

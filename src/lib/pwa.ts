import { Capacitor } from "@capacitor/core";

// Shared between AddToHomeScreenPrompt (don't nudge someone who's already
// installed) and App.tsx's logged-out redirect (skip the marketing landing
// page for someone who already installed the app -- they know what GolfMe
// is, they just want to log in).
export function isStandalone(): boolean {
  // The TestFlight/App Store build is a real Capacitor native shell, not a
  // browser tab -- neither navigator.standalone nor the display-mode media
  // query fire for it (those are PWA-only signals), so without this check
  // it fell through to the marketing landing page on every native launch
  // instead of skipping straight to Login like an installed PWA does.
  if (Capacitor.isNativePlatform()) return true;
  if (typeof window === "undefined") return false;
  // iOS Safari exposes navigator.standalone; every other install-capable
  // browser follows the display-mode media query instead.
  return (
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

// Shared between AddToHomeScreenPrompt (don't nudge someone who's already
// installed) and App.tsx's logged-out redirect (skip the marketing landing
// page for someone who already installed the app -- they know what GolfMe
// is, they just want to log in).
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari exposes navigator.standalone; every other install-capable
  // browser follows the display-mode media query instead.
  return (
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

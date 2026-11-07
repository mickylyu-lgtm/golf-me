import { keyboardMotionEnabled } from "./keyboard/smoothScroll";

// Chat motion (Micky's 2026-11-07 brief, WeChat as the reference):
// - the chat box follows the iOS keyboard's slide instead of jumping to its
//   final height when the slide starts (lib/useKeyboardFollow.ts, native
//   app only: DirectMessageThread and the full-screen round chat);
// - a short sideways transition entering a conversation and back to the
//   list (lib/chatRouteMotion.ts, AppShell).
//
// Kill switch: CHAT_MOTION = false turns both off, which is exactly the old
// behaviour (instant box resize, instant route swap). Per device, the
// founder's About switch (tap the description 7 times) flips the keyboard
// motion override in lib/keyboard/smoothScroll.ts, and that one switch
// turns this off too, so one toggle compares all old vs new keyboard and
// chat motion on the phone without a redeploy. Reduce Motion: off (the
// layout itself is unchanged, only the in-between frames go).
export const CHAT_MOTION = true;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// Chat motion should play right now.
export function chatMotionActive(): boolean {
  if (!CHAT_MOTION || typeof window === "undefined") return false;
  if (typeof document !== "undefined" && document.hidden) return false;
  return keyboardMotionEnabled() && !prefersReducedMotion();
}

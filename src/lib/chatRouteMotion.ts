// A short sideways transition between the Chat list and a conversation
// (Micky's 2026-11-07 brief: the screens used to swap abruptly; WeChat
// slides). Conversations: /messages/:id (DM) and /messages/round/:id.
//
// - Entering a conversation (any push, e.g. from the list, a profile, a
//   notification): the new screen comes in from slightly right.
// - Back to the list, or back (history POP) into a conversation: it comes
//   in from slightly left, the direction the list sits in.
// - Nothing else in the app changes: other routes swap as before.
//
// How: BrowserRouter has no transitions of its own (only data routers
// do), so there's nothing to layer over. The router renders only the new
// screen, so only it moves: AppShell's content column runs one Web
// Animations API animation (transform + opacity, compositor-only, no
// layout) started in the layout effect of the commit that shows the new
// route, so its first painted frame is already the first keyframe. The
// TopBar and the tab bar are outside that column and stay still.
// - 240 ms, ease-out, 24 px of travel, no overshoot. Taps work throughout
//   (a transform doesn't block input) and nothing waits for it.
// - The old screen is already gone (the router unmounted it), so there's
//   never a second, stale or focusable copy on screen, and a new
//   navigation cancels the running one: rapid open/back can't stack.
// - translateX only, never Y: the chat boxes measure their top with
//   getBoundingClientRect().top during this same commit.
// - The column's parent clips horizontal overflow while it runs, so the
//   shifted column can't widen the page.
// - The iOS-style edge swipe back (SwipeBackToInbox) has already slid the
//   thread away under the finger, so the navigation it makes isn't
//   animated again (skipNextChatRouteMotion).
// - Off with Reduce Motion, CHAT_MOTION / the founder's About switch off,
//   or a hidden page (lib/chatMotion.ts).
//
// This file is the rules only (no React / DOM imports, so
// tests/chatRouteMotion.test.ts runs under plain node); the hook is
// lib/useChatRouteMotion.ts.

export const ROUTE_MOTION_MS = 240;
export const ROUTE_MOTION_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
export const ROUTE_MOTION_TRAVEL_PX = 24;
export const ROUTE_MOTION_START_OPACITY = 0.4;

export type ChatRouteMotion = "forward" | "back" | null;
export type NavAction = "POP" | "PUSH" | "REPLACE";

const CHAT_LIST = "/messages";
const CHAT_THREAD = /^\/messages\/(?:round\/)?[^/]+$/;

function normalize(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function isChatThreadPath(path: string): boolean {
  return CHAT_THREAD.test(normalize(path));
}

export function chatRouteMotion(fromPath: string, toPath: string, action: NavAction): ChatRouteMotion {
  const from = normalize(fromPath);
  const to = normalize(toPath);
  if (from === to) return null;
  if (isChatThreadPath(to)) return action === "POP" ? "back" : "forward";
  if (isChatThreadPath(from) && to === CHAT_LIST) return "back";
  return null;
}

export function routeMotionKeyframes(motion: "forward" | "back"): Keyframe[] {
  const x = motion === "forward" ? ROUTE_MOTION_TRAVEL_PX : -ROUTE_MOTION_TRAVEL_PX;
  return [
    { transform: `translate3d(${x}px, 0, 0)`, opacity: ROUTE_MOTION_START_OPACITY },
    { transform: "translate3d(0, 0, 0)", opacity: 1 },
  ];
}

// Set by the edge swipe back right before it navigates away from `path`;
// read (and cleared) by the next route change, whatever it is.
let skipFromPath: string | null = null;
export function skipNextChatRouteMotion(path: string): void {
  skipFromPath = normalize(path);
}

// True (once) when the route change leaving `fromPath` is the one the edge
// swipe asked to skip. Clears the request whatever the answer.
export function consumeChatRouteMotionSkip(fromPath: string | null): boolean {
  const skip = skipFromPath !== null && fromPath !== null && skipFromPath === normalize(fromPath);
  skipFromPath = null;
  return skip;
}

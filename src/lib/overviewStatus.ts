// Small pure rules for the course overview's status (node-tested in
// tests/overviewDetail.test.ts).
import type { LayoutResult } from "./courseDetailImagery.ts";

export type LayoutUiStatus = "hidden" | "off" | "loading" | "ready" | "unmapped" | "unavailable";

/** What the Layout status line says. "loading" only while an answer is
 * actually being waited for (Layout on, map shown). */
export function layoutUiStatus(s: { loaded: boolean; canLayout: boolean; layoutOn: boolean; result: LayoutResult | null }): LayoutUiStatus {
  if (!s.loaded || !s.canLayout) return "hidden";
  if (!s.layoutOn) return "off";
  if (!s.result) return "loading";
  return s.result.status;
}

// The Layout switch, per device (a convenience: losing it just means "on").
export const LAYOUT_PREF_KEY = "golfme:overviewLayout";

export function readLayoutPreference(): boolean {
  try {
    return typeof localStorage === "undefined" || localStorage.getItem(LAYOUT_PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeLayoutPreference(on: boolean) {
  try {
    if (on) localStorage.removeItem(LAYOUT_PREF_KEY);
    else localStorage.setItem(LAYOUT_PREF_KEY, "off");
  } catch {
    // Blocked storage: the switch just isn't remembered.
  }
}

/** Every tile failed: how long the overview waits for the sharp picture to
 * carry the view before falling back to the still/placeholder one. */
export const PICTURE_RESCUE_MS = 20_000;
export function pictureRescueWait(): number {
  return PICTURE_RESCUE_MS;
}

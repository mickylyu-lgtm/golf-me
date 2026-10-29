import type { NavigateFunction } from "react-router-dom";

// In-app Back. navigate(-1) does nothing when the page is the first entry
// in this tab's history (a shared link opened in Safari, a push, a fresh
// tab), which left the golfer stuck on the page (Micky, 2026-10-29). React
// Router stores its own history index in history.state.idx; 0 means there's
// nothing in the app to go back to, so go to a sensible page instead.
export function goBack(navigate: NavigateFunction, fallback = "/"): void {
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  if (typeof idx === "number" && idx > 0) navigate(-1);
  else navigate(fallback, { replace: true });
}

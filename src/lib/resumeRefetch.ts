// Calls `refetch` when the app comes back to the foreground (tab visible
// again, window focused, native app resumed into the web view). Realtime
// alone isn't enough: iOS suspends the websocket while the app is in the
// background, so a join, a round message or a new post sent meanwhile never
// arrives as an event (2026-11-04 bug scan: round chat and rosters stayed
// stale after opening a push). RealSocialContext has its own richer version
// of this (with polling); Rounds and Community use this one.
//
// visibilitychange and focus usually fire together on resume, so calls
// closer together than `minGapMs` collapse into one.
export function refetchOnResume(refetch: () => void, minGapMs = 5000): () => void {
  let last = Date.now(); // the caller has just done its initial fetch
  const onResume = () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - last < minGapMs) return;
    last = Date.now();
    refetch();
  };
  document.addEventListener("visibilitychange", onResume);
  window.addEventListener("focus", onResume);
  return () => {
    document.removeEventListener("visibilitychange", onResume);
    window.removeEventListener("focus", onResume);
  };
}

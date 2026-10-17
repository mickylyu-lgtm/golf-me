import { useEffect } from "react";
import { hideNativeSplash } from "../../lib/nativeSplash";
import { SHOW_ENTRY } from "./entryFlag";
import { useAppReady } from "./loaderState";

// Lifts the native iOS launch screen once the web app has painted something
// worth showing (no-op on web/PWA, see hideNativeSplash):
// - entry playing: as soon as EntryOverlay (mounted in the same commit,
//   rendered just before this) has painted, so green hands off to green;
// - otherwise: once no fullScreen loader is up, i.e. the first real screen
//   (/splash, /login or the app), so the cream loader never flashes.
// Waits two frames after the condition so the screen is actually painted.
export function NativeSplashHide() {
  const ready = useAppReady(!SHOW_ENTRY);
  const go = SHOW_ENTRY || ready;
  useEffect(() => {
    if (!go) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(hideNativeSplash);
    });
    return () => cancelAnimationFrame(frame);
  }, [go]);
  return null;
}

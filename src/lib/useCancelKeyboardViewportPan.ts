import { useEffect } from "react";

// iOS/WKWebView pans the VISUAL viewport to keep a focused input clear of
// the on-screen keyboard, independent of any CSS overflow/scroll setting.
// Any `position: sticky`/`fixed` element (e.g. TopBar) is positioned
// against the unpanned LAYOUT viewport, so that pan pushes it out of the
// visible area -- what was on screen disappears (revealing blank/black
// space) and whatever was below slides up to take its place. Reported live
// as "black screen, the whole screen drags down" when focusing any textbox.
// Forcing scroll position back to (0, 0) on every visualViewport pan/resize
// cancels the native pan back out immediately. Mounted once at the app root
// (see App.tsx's AppGate) so every screen is covered, not just the one this
// was first caught on.
export function useCancelKeyboardViewportPan() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    // Gated on the keyboard actually being open (the same layoutHeight vs.
    // visualViewport-height check DirectMessageThread already used for its
    // own boxHeight calc) -- firing this unconditionally on every
    // visualViewport 'scroll'/'resize' event, including the ones WebKit
    // fires during completely ordinary momentum/rubber-band scrolling with
    // the keyboard closed, was a real regression caught live: any normal
    // scrollable page (e.g. the Find/rounds feed) kept getting yanked back
    // to scrollY 0 and could never reach its own bottom.
    const resetScroll = () => {
      const layoutHeight = document.documentElement.clientHeight;
      const keyboardOpen = layoutHeight - vv.height > 100;
      if (keyboardOpen) window.scrollTo(0, 0);
    };
    vv.addEventListener("scroll", resetScroll);
    vv.addEventListener("resize", resetScroll);
    return () => {
      vv.removeEventListener("scroll", resetScroll);
      vv.removeEventListener("resize", resetScroll);
    };
  }, []);
}

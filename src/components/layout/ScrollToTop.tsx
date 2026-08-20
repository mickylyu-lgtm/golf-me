import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// React Router doesn't reset scroll position on navigation by itself (that's
// a browser-native behavior SPAs lose) -- without this, navigating from
// partway down a long list (Community, Play, a Golf Call thread) straight
// into a new page could land the user mid-scroll on content that hasn't
// rendered there yet, looking blank until they scroll up manually. Resets
// on every actual route change, including switching between root tabs
// (Home/Play/Chat/Caddie/Me), which are each their own path.
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

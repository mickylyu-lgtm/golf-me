import { useEffect, useState } from "react";

// window.visualViewport.height, not window.innerHeight/100dvh -- the two
// only diverge when the on-screen keyboard is showing: the keyboard
// overlays content rather than resizing the page, so the layout viewport
// (and 100dvh, which tracks browser-chrome changes only, not the keyboard)
// stays the same size, while visualViewport.height shrinks by the
// keyboard's real height. Falls back to innerHeight where visualViewport
// isn't supported.
export function useVisualViewportHeight(): number {
  const [height, setHeight] = useState(() =>
    typeof window !== "undefined" ? (window.visualViewport?.height ?? window.innerHeight) : 0,
  );

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setHeight(vv.height);
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);

  return height;
}

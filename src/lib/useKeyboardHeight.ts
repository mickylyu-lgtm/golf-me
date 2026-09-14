import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import type { KeyboardInfo } from "@capacitor/keyboard";

// Returns the on-screen keyboard's real height in px (0 when closed).
// Replaces useKeyboardOpen/useVisualViewportHeight for anything that needs
// to know how much space the keyboard actually takes -- with
// resize:"body" configured (capacitor.config.ts), the plugin's own docs
// say "the viewport does not change," which means window.innerHeight and
// window.visualViewport.height likely never update for the keyboard under
// this mode either (confirmed live: a fix built on visualViewport.height
// still produced broken/blank layout on a real device). keyboardHeight
// from the plugin's keyboardWillShow/keyboardDidShow event payload is
// real native data reported directly by iOS, not something inferred from
// a viewport value this resize mode explicitly doesn't touch.
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const showListener = Keyboard.addListener("keyboardWillShow", (info: KeyboardInfo) => setHeight(info.keyboardHeight));
    const hideListener = Keyboard.addListener("keyboardWillHide", () => setHeight(0));
    return () => {
      void showListener.then((l) => l.remove());
      void hideListener.then((l) => l.remove());
    };
  }, []);

  return height;
}

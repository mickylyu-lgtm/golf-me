import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

// Single source of truth for "is the on-screen keyboard open," replacing the
// old layoutHeight-vs-visualViewport-height > 100px guess that used to live
// in DirectMessageThread. @capacitor/keyboard's iOS/Android implementations
// fire these events natively -- but unlike several other Capacitor plugins,
// this one ships NO web implementation at all (confirmed: no web.ts in the
// package), so calling Keyboard.addListener on a plain browser/PWA throws
// "Keyboard plugin is not implemented on web" (caught live via the
// GolfMe:run skill before this ever reached a device). isNativePlatform()
// gates it to the real native app only; web/PWA falls back to always
// "closed" here, which is fine -- BottomNav.tsx (the only other consumer)
// is already sm:hidden/mobile-only, and DirectMessageThread's boxHeight
// calc has its own non-keyboard-aware branch for exactly this case.
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const showListener = Keyboard.addListener("keyboardWillShow", () => setOpen(true));
    const hideListener = Keyboard.addListener("keyboardWillHide", () => setOpen(false));
    return () => {
      void showListener.then((l) => l.remove());
      void hideListener.then((l) => l.remove());
    };
  }, []);

  return open;
}

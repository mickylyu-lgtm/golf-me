import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { isTextEntryElement, nextComposerOwnsFocus } from "./composerFocus";
import { KEEPS_COMPOSER_FOCUS_SELECTOR } from "./keyboard/fields";

// Whether the composer inside `ref` owns the focus (lib/composerFocus.ts
// has the rule). A capture listener on document, so it runs before the
// focus reaches React's own handlers. `onFocusInside` runs on every focus
// inside the composer, before ownership changes -- the place to read the
// page's scroll position while the composer is still in its in-flow spot
// (a React onFocus would run after the composer had already docked when
// focus moves to it with the keyboard already up).
export function useComposerFocus(ref: RefObject<HTMLElement | null>, onFocusInside?: () => void): boolean {
  const [owns, setOwns] = useState(false);
  const callbackRef = useRef(onFocusInside);
  useLayoutEffect(() => {
    callbackRef.current = onFocusInside;
  });

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      const insideComposer = ref.current?.contains(target) ?? false;
      if (insideComposer) callbackRef.current?.();
      // A borrowing field (KEEPS_COMPOSER_FOCUS_SELECTOR) counts as "not a
      // text field": ownership stays as it was.
      const isTextField = isTextEntryElement(target as HTMLElement) && !target.closest(KEEPS_COMPOSER_FOCUS_SELECTOR);
      setOwns((current) => nextComposerOwnsFocus(current, { insideComposer, isTextField }));
    };
    document.addEventListener("focusin", onFocusIn, true);
    return () => document.removeEventListener("focusin", onFocusIn, true);
  }, [ref]);

  return owns;
}

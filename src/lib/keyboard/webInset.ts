// The on-screen keyboard's height on the WEB path (iPhone Safari, the
// installed PWA, Android Chrome), where there is no Capacitor Keyboard
// plugin and so no keyboardWillShow height. There the browser shrinks the
// visual viewport for the keyboard while window.innerHeight (the layout
// viewport) stays put, so the keyboard covers innerHeight - vv.height.
//
// Never used in the native app: there the plugin's height is the one
// source (lib/keyboard/store.ts), and under resize:"body" visualViewport
// doesn't track the keyboard anyway. Callers pick one or the other, never
// both, so the two can't stack into a double offset.
//
// No React or DOM imports, so tests/webKeyboardInset.test.ts runs under
// plain node.

// Smaller differences are browser chrome (Safari's toolbar collapsing),
// not a keyboard.
export const WEB_KEYBOARD_MIN_PX = 120;

export interface WebViewportSample {
  innerHeight: number;
  viewportHeight: number;
  // visualViewport.scale: a pinch zoom also shrinks vv.height.
  scale: number;
  // A text field inside the caller's own container has focus.
  fieldFocused: boolean;
}

export function webKeyboardInset(s: WebViewportSample): number {
  if (!s.fieldFocused) return 0;
  if (!Number.isFinite(s.scale) || Math.abs(s.scale - 1) > 0.01) return 0;
  if (!Number.isFinite(s.innerHeight) || !Number.isFinite(s.viewportHeight)) return 0;
  const inset = Math.round(s.innerHeight - s.viewportHeight);
  return inset >= WEB_KEYBOARD_MIN_PX ? inset : 0;
}

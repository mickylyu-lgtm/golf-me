// True while an IME (Japanese/Chinese/Korean input) is composing: the
// Enter that confirms a candidate must pick the candidate, not send a
// half-composed message. isComposing covers most browsers; Safari/WebKit
// fires the confirming keydown after compositionend with isComposing false
// but keyCode 229, so that is checked too. Takes a React or a native
// keyboard event. No React imports, so tests/isImeComposing.test.ts runs
// under plain node.

interface KeyEventLike {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}

export function isImeComposing(e: KeyEventLike): boolean {
  if (e.isComposing || e.nativeEvent?.isComposing) return true;
  return e.keyCode === 229 || e.nativeEvent?.keyCode === 229;
}

// Enter pressed to send/submit (not Shift+Enter, not an IME confirm).
export function isSendEnter(e: KeyEventLike & { key: string; shiftKey?: boolean }): boolean {
  return e.key === "Enter" && !e.shiftKey && !isImeComposing(e);
}

// One send per draft. ChatComposer has two send triggers (Enter, and the
// send button's click) and each calls the page's onSend with whatever
// draft that render closed over. Until the page re-renders with the
// cleared draft, a second trigger (Enter right after a tap, a repeated
// key, a WebView firing a synthetic click) would send the same text again.
// The guard remembers the draft it already sent and refuses it until the
// draft changes (the page clearing it, the golfer typing, or a failed send
// putting the text back -- each a new value, so a retry is never blocked).
// No React imports, so tests/sendGuard.test.ts runs under plain node.

export interface SendGuard {
  // True when `draft` may be sent now (and marks it sent).
  claim(draft: string): boolean;
  // The draft changed: anything may be sent again.
  release(): void;
}

export function createSendGuard(): SendGuard {
  let sent: string | null = null;
  return {
    claim(draft) {
      if (!draft.trim() || draft === sent) return false;
      sent = draft;
      return true;
    },
    release() {
      sent = null;
    },
  };
}

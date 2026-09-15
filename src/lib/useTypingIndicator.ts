import { useCallback, useEffect, useRef } from "react";

// How often notifyTyping() is allowed to actually re-broadcast typing:start
// while the user keeps typing continuously -- keystrokes in between just
// reset the idle timer below, never fire a network event on their own.
const REFRESH_INTERVAL_MS = 2000;
// No new keystroke for this long -> broadcast typing:stop. Well under the
// receiver's own 4s safety-net timeout (see RealSocialContext), so under
// normal conditions the sender's own stop arrives first.
const IDLE_STOP_MS = 2500;

// Sender-side typing-signal debouncer, shared shape for any composer that
// wants to emit typing:start/stop without flooding realtime on every
// keystroke. Caller supplies the actual (conversation-aware) send function;
// this hook only owns the timing. Calling stop() is safe even if typing was
// never started (a no-op) -- callers can wire it unconditionally to send,
// blur, and unmount.
//
// sendTypingSignal is read through a ref, not depended on directly: in
// GolfMe's real-account contexts (RealSocialContext), a function like this
// is rebuilt with a new identity on every realtime refetch -- i.e. on every
// incoming message, not just when the caller actually wants to change which
// conversation this hook is bound to (same pattern already documented and
// worked around elsewhere in DirectMessageThread for markConversationRead).
// Depending on it directly would make notifyTyping/stop change identity
// mid-conversation, re-running the unmount effect below and firing a
// spurious typing:stop every time a message arrives while someone is
// actively typing. The ref keeps notifyTyping/stop themselves stable across
// ordinary re-renders while still always calling the latest send function.
export function useTypingIndicator(sendTypingSignal: (active: boolean) => void) {
  const sendRef = useRef(sendTypingSignal);
  sendRef.current = sendTypingSignal;
  const activeRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const idleTimeoutRef = useRef<number | null>(null);

  const clearIdleTimeout = useCallback(() => {
    if (idleTimeoutRef.current !== null) {
      window.clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearIdleTimeout();
    if (activeRef.current) {
      activeRef.current = false;
      sendRef.current(false);
    }
  }, [clearIdleTimeout]);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (!activeRef.current || now - lastSentAtRef.current >= REFRESH_INTERVAL_MS) {
      activeRef.current = true;
      lastSentAtRef.current = now;
      sendRef.current(true);
    }
    clearIdleTimeout();
    idleTimeoutRef.current = window.setTimeout(stop, IDLE_STOP_MS);
  }, [clearIdleTimeout, stop]);

  // Unmount only (stop/notifyTyping are now stable across ordinary
  // re-renders, per the ref note above) -- covers navigating away from chat
  // entirely. Switching between two conversations while staying mounted
  // (DirectMessageThread reuses one component instance for that) is handled
  // separately by the caller, which knows the actual previous/next
  // conversation id; see DirectMessageThread's own effect for that.
  useEffect(() => {
    return stop;
  }, [stop]);

  return { notifyTyping, stop };
}

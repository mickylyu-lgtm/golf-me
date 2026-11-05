import { useEffect, useState } from "react";
import { presenceExited, presenceFor, type Presence } from "./messageFocus";

// Keeps the last non-null `value` around for `exitMs` after it turns null,
// flagged `exiting`, so an overlay can animate out (lib/messageFocus.ts
// presenceFor). Render with key={presence.key}.
export function useExitPresence<T>(value: T | null, exitMs: number): Presence<T> {
  const [state, setState] = useState<Presence<T>>(() => ({ value, exiting: false, key: 0 }));
  const next = presenceFor(state, value);
  // Adjusting state from a changed input during render (React's documented
  // pattern); presenceFor is stable once caught up, so this settles at once.
  if (next !== state) setState(next);
  const { exiting, key } = next;
  useEffect(() => {
    if (!exiting) return;
    const t = window.setTimeout(() => setState((s) => presenceExited(s)), exitMs);
    return () => window.clearTimeout(t);
  }, [exiting, key, exitMs]);
  return next;
}

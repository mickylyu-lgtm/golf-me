import { useCallback, useEffect, useRef, useState } from "react";

/** Render-time identity includes the read closure: private data disappears
 * before effects run after an account or relationship scope change. */
export function useSocialRead<T>(read: () => Promise<T>, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const scopeRef = useRef({ read, enabled, attempt });
  if (scopeRef.current.read !== read || scopeRef.current.enabled !== enabled || scopeRef.current.attempt !== attempt) scopeRef.current = { read, enabled, attempt };
  const scope = scopeRef.current;
  const [result, setResult] = useState<{ scope: typeof scope; value?: T; failed?: boolean } | null>(null);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    if (!scope.enabled) return;
    let active = true;
    scope.read().then((value) => { if (active) setResult({ scope, value }); })
      .catch(() => { if (active) setResult({ scope, failed: true }); });
    return () => { active = false; };
  }, [scope]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") retry(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [retry]);
  const current = enabled && result?.scope === scope ? result : null;
  return { value: current?.value, failed: current?.failed ?? false, retry };
}

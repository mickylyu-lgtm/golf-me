import { useCallback, useEffect, useRef, useState } from "react";

/** Render-time identity includes the read closure: private data disappears
 * before effects run after an account or relationship scope change. */
export function useSocialRead<T>(read: () => Promise<T>, enabled = true, retainOnRefresh = false) {
  const [attempt, setAttempt] = useState(0);
  // Refresh attempts may keep a settled count, but never across identity/access
  // changes (including revoke then re-grant before the next response).
  const identityRef = useRef({ read, enabled });
  if (identityRef.current.read !== read || identityRef.current.enabled !== enabled) identityRef.current = { read, enabled };
  const identity = identityRef.current;
  const scopeRef = useRef({ read, enabled, attempt, identity });
  if (scopeRef.current.read !== read || scopeRef.current.enabled !== enabled || scopeRef.current.attempt !== attempt) scopeRef.current = { read, enabled, attempt, identity };
  const scope = scopeRef.current;
  const [result, setResult] = useState<{ scope: typeof scope; value?: T; failed?: boolean } | null>(null);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    if (!scope.enabled) return;
    let active = true;
    scope.read().then((value) => { if (active && scopeRef.current === scope) setResult({ scope, value }); })
      .catch(() => { if (active && scopeRef.current === scope) setResult({ scope, failed: true }); });
    return () => { active = false; };
  }, [scope]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") retry(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [retry]);
  const current = enabled && (result?.scope === scope || (retainOnRefresh && result?.scope.identity === identity)) ? result : null;
  return { value: current?.value, failed: current?.failed ?? false, retry };
}

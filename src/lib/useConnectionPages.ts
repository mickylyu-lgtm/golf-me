import { useCallback, useEffect, useRef, useState } from "react";
import { appendConnectionPage } from "./socialPrivacy";
import type { ConnectionCursor, ConnectionPage } from "./socialPrivacy";

/** Each read is scoped to viewer, owner, tab, search and mutation generation. */
export function useConnectionPages(read: (cursor: ConnectionCursor | null) => Promise<ConnectionPage>, enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const scopeRef = useRef({ read, enabled, attempt });
  if (scopeRef.current.read !== read || scopeRef.current.enabled !== enabled || scopeRef.current.attempt !== attempt) scopeRef.current = { read, enabled, attempt };
  const scope = scopeRef.current;
  const [state, setState] = useState<{ scope: typeof scope; page?: ConnectionPage; failed?: boolean; busy?: boolean }>();
  const lock = useRef<object | null>(null);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  useEffect(() => {
    if (!scope.enabled) return;
    let active = true;
    const timer = setTimeout(() => {
      scope.read(null).then(page => { if (active && scopeRef.current === scope) setState({ scope, page }); })
        .catch(() => { if (active && scopeRef.current === scope) setState({ scope, failed: true }); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [scope]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") retry(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [retry]);
  const current = enabled && state?.scope === scope ? state : undefined;
  const loadMore = async () => {
    if (!current?.page?.nextCursor || current.busy || lock.current === scope) return;
    lock.current = scope;
    setState({ ...current, busy: true });
    try {
      const next = await scope.read(current.page.nextCursor);
      if (scopeRef.current === scope) setState({ scope, page: appendConnectionPage(current.page, next) });
    } catch {
      if (scopeRef.current === scope) setState({ scope, failed: true });
    } finally { if (lock.current === scope) lock.current = null; }
  };
  return { value: current?.page, failed: current?.failed ?? false, busy: current?.busy ?? false, retry, loadMore };
}

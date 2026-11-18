import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { createSharePreview } from "./sharePreview";

// Prepare while the share control is mounted, never inside the native-share
// click path. Token is kept in memory and never sent to a recipient until Share.
export function usePreparedShare(kind: "post" | "round", id?: string) {
  const { authUser, isDemo } = useAuth();
  const key = !isDemo && authUser && id ? authUser.id + ":" + kind + ":" + id : "";
  const current = useRef(key); current.current = key;
  const pending = useRef("");
  const [failedKey, setFailedKey] = useState("");
  const [prepared, setPrepared] = useState<{ key: string; url: string; at: number } | null>(null);
  const prepare = useCallback(() => {
    if (!key || !id || pending.current === key) return;
    pending.current = key;
    void createSharePreview(kind, id).then(url => {
      if (current.current === key) { setPrepared({ key, url, at: Date.now() }); setFailedKey(""); }
    }).catch(() => {
      if (current.current === key) { setPrepared(null); setFailedKey(key); }
    }).finally(() => { if (pending.current === key) pending.current = ""; });
  }, [key, kind, id]);
  useEffect(() => {
    prepare();
    const refresh = () => { if (document.visibilityState === "visible") prepare(); };
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(prepare, 20 * 60_000);
    return () => { document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); };
  }, [prepare]);
  // Short in-memory lease prevents an ancient tab from sharing expired tokens.
  const url = prepared?.key === key && Date.now() - prepared.at < 25 * 60_000 ? prepared.url : null;
  return { url, prepare, isDemo, failed: !!key && failedKey === key };
}

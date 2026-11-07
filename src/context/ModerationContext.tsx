import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import { refetchOnResume } from "../lib/resumeRefetch";
import { MODERATION_UNAVAILABLE, parseModerationStatus, type ModerationStatus } from "../lib/moderation";

// The signed-in user's moderation state, asked once per account (and again
// when the app returns to the foreground) instead of per PostCard. Drives:
// the admin-only Remove / Suspend menu items, and the suspension banner.
// my_moderation_status() missing (migration 20261107270000 not applied) or
// demo mode = everything off. UI only: the server enforces suspensions and
// re-checks the admin role in every admin RPC.
interface ModerationContextValue extends ModerationStatus {
  refresh: () => Promise<void>;
}

const ModerationContext = createContext<ModerationContextValue | null>(null);

export function ModerationProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser } = useAuth();
  const selfId = authUser?.id;
  const [status, setStatus] = useState<{ forId: string | null; value: ModerationStatus }>({ forId: null, value: MODERATION_UNAVAILABLE });
  const currentIdRef = useRef<string | null>(null);
  // Declared before the fetching effect, so it runs first on a change.
  useEffect(() => {
    currentIdRef.current = isDemo ? null : (selfId ?? null);
  }, [isDemo, selfId]);

  const refresh = useCallback(async () => {
    if (isDemo || !selfId) {
      setStatus({ forId: null, value: MODERATION_UNAVAILABLE });
      return;
    }
    const { data, error } = await supabase.rpc("my_moderation_status");
    // A late answer for a previous account is dropped.
    if (currentIdRef.current !== selfId) return;
    setStatus({ forId: selfId, value: parseModerationStatus(data, error) });
  }, [isDemo, selfId]);

  useEffect(() => {
    setStatus({ forId: null, value: MODERATION_UNAVAILABLE });
    if (isDemo || !selfId) return;
    void refresh();
    return refetchOnResume(() => void refresh());
  }, [isDemo, selfId, refresh]);

  const value = useMemo<ModerationContextValue>(
    () => ({ ...(status.forId === selfId ? status.value : MODERATION_UNAVAILABLE), refresh }),
    [status, selfId, refresh],
  );
  return <ModerationContext.Provider value={value}>{children}</ModerationContext.Provider>;
}

export function useModeration(): ModerationContextValue {
  const ctx = useContext(ModerationContext);
  if (!ctx) throw new Error("useModeration must be used inside ModerationProvider");
  return ctx;
}

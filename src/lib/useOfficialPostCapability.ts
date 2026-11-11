import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "./supabase";
import { refetchOnResume } from "./resumeRefetch";
import { fetchOfficialPostCapability, OFFICIAL_POST_UNAVAILABLE, type OfficialPostCapability } from "./officialPost";

export function useOfficialPostCapability() {
  const { isDemo, authUser } = useAuth();
  const selfId = isDemo ? undefined : authUser?.id;
  const generation = useRef(0);
  const [state, setState] = useState<{ forId?: string; loading: boolean; value: OfficialPostCapability }>({
    loading: false, value: OFFICIAL_POST_UNAVAILABLE,
  });
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!selfId) {
      setState({ loading: false, value: OFFICIAL_POST_UNAVAILABLE });
      return;
    }
    setState({ forId: selfId, loading: true, value: OFFICIAL_POST_UNAVAILABLE });
    const value = await fetchOfficialPostCapability(() => supabase.rpc("community_post_capabilities"));
    if (generation.current === request) setState({ forId: selfId, loading: false, value });
  }, [selfId]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    void refresh();
    const dispose = selfId ? refetchOnResume(() => void refresh()) : undefined;
    return () => { invalidate(); dispose?.(); };
  }, [refresh, selfId, invalidate]);
  // Never render the previous account's permission during an account switch.
  return state.forId === selfId && selfId
    ? { ...state.value, loading: state.loading, refresh }
    : { ...OFFICIAL_POST_UNAVAILABLE, loading: Boolean(selfId), refresh };
}

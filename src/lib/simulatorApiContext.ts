import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "./supabase";
import { createSimulatorSessions, simulatorClientEnabled, simulatorRpcAllowed, type SimulatorRpcScope } from "./simulatorSessions";

export type SimulatorApi = ReturnType<typeof createSimulatorSessions>;
export const SimulatorApiContext = createContext<SimulatorApi | null>(null);

export function useSimulatorApi(scope: SimulatorRpcScope = "discovery") {
  const injected = useContext(SimulatorApiContext);
  const { authUser, isDemo } = useAuth();
  const userId = authUser?.id;
  const flag = scope === "recovery" ? import.meta.env.VITE_SIMULATOR_RECOVERY_ENABLED : import.meta.env.VITE_SIMULATOR_SESSIONS_ENABLED;
  const enabled = simulatorClientEnabled(flag, userId, isDemo);
  return useMemo(() => {
    if (import.meta.env.DEV && injected) return injected;
    if (!enabled || !userId) return null;
    return createSimulatorSessions(async (name, args) => {
      if (!simulatorRpcAllowed(scope, name)) return { data: null, error: { message: "simulator_unavailable" } };
      // Never issue a recovery/mutation for a sign-in different from the mounted UI.
      const { data, error } = await supabase.auth.getSession();
      if (error || data.session?.user.id !== userId) return { data: null, error: { message: "simulator_unavailable" } };
      return await supabase.rpc(name, args).setHeader("Authorization", "Bearer " + data.session.access_token);
    });
  }, [enabled, injected, scope, userId]);
}

// Build flags alone do not authorize an account. API identity changes with
// sign-in and scope, so a stale positive response can never unlock another user.
export function useSimulatorDiscoveryVisible() {
  const api = useSimulatorApi();
  const [allowedApi, setAllowedApi] = useState<SimulatorApi | null>(null);
  useEffect(() => {
    if (!api || import.meta.env.DEV) return;
    let request = 0;
    const verify = () => {
      const attempt = ++request;
      const settle = (allowed: boolean) => {
        if (attempt === request) setAllowedApi(allowed ? api : null);
      };
      void api.canDiscover().then(settle, () => settle(false));
    };
    verify();
    window.addEventListener("focus", verify);
    return () => {
      ++request;
      window.removeEventListener("focus", verify);
    };
  }, [api]);
  return import.meta.env.DEV || (api !== null && allowedApi === api);
}

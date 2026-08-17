import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import { swingAnalysisProvider } from "../lib/swingAnalysis";
import type { CaddieAnalysis, CaddieAnalysisStatus, CaddieSourceType } from "../types";

interface CaddieAnalysisRow {
  id: string;
  owner_id: string;
  source_type: CaddieSourceType;
  source_post_id: string | null;
  source_media_url: string;
  swing_type: string | null;
  status: CaddieAnalysisStatus;
  analysis_summary: string | null;
  strengths: string[];
  issues: string[];
  recommendations: string[];
  drills: string[];
  shared_to_community: boolean;
  created_at: string;
  updated_at: string;
}

function rowToAnalysis(row: CaddieAnalysisRow): CaddieAnalysis {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sourceType: row.source_type,
    sourcePostId: row.source_post_id ?? undefined,
    sourceMediaUrl: row.source_media_url,
    swingType: row.swing_type ?? undefined,
    status: row.status,
    analysisSummary: row.analysis_summary ?? undefined,
    strengths: row.strengths,
    issues: row.issues,
    recommendations: row.recommendations,
    drills: row.drills,
    sharedToCommunity: row.shared_to_community,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateAnalysisInput {
  sourceType: CaddieSourceType;
  sourcePostId?: string;
  sourceMediaUrl: string;
  swingType?: string;
}

interface RealCaddieContextValue {
  analyses: CaddieAnalysis[];
  isLoading: boolean;
  getAnalysis: (id: string) => CaddieAnalysis | undefined;
  createAnalysis: (input: CreateAnalysisInput) => Promise<CaddieAnalysis>;
}

const RealCaddieContext = createContext<RealCaddieContextValue | null>(null);

export function RealCaddieProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser } = useAuth();
  const [rows, setRows] = useState<CaddieAnalysisRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fetchingRef = useRef(false);
  const selfId = authUser?.id;

  const refetch = useCallback(async () => {
    if (!selfId || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const { data, error } = await supabase
        .from("caddie_analyses")
        .select("*")
        .eq("owner_id", selfId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as CaddieAnalysisRow[]);
    } catch (err) {
      console.error("Golf Me: failed to load Caddie history.", err);
    } finally {
      fetchingRef.current = false;
    }
  }, [selfId]);

  useEffect(() => {
    if (isDemo || !selfId) {
      setRows([]);
      return;
    }
    setIsLoading(true);
    refetch().finally(() => setIsLoading(false));

    // Own-row-only data (RLS already guarantees no other user's changes can
    // ever reach this filter), so a single owner-scoped subscription is
    // enough — no cross-account traffic to worry about, unlike Community.
    const channel = supabase
      .channel("caddie-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "caddie_analyses", filter: `owner_id=eq.${selfId}` }, () => refetch())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isDemo, selfId, refetch]);

  const analyses = useMemo(() => rows.map(rowToAnalysis), [rows]);

  const getAnalysis = useCallback((id: string) => analyses.find((a) => a.id === id), [analyses]);

  const createAnalysis = useCallback(
    async (input: CreateAnalysisInput): Promise<CaddieAnalysis> => {
      if (!selfId) throw new Error("Not signed in.");
      const { data, error } = await supabase
        .from("caddie_analyses")
        .insert({
          owner_id: selfId,
          source_type: input.sourceType,
          source_post_id: input.sourcePostId ?? null,
          source_media_url: input.sourceMediaUrl,
          swing_type: input.swingType ?? null,
          status: "pending",
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const created = rowToAnalysis(data as CaddieAnalysisRow);
      setRows((prev) => [data as CaddieAnalysisRow, ...prev]);

      // Real integration point: attempt the real analysis provider. Today
      // this always throws (see src/lib/swingAnalysis.ts — no real
      // CV/AI provider is connected), so the row is deliberately left at
      // 'pending' rather than writing a fabricated result. The day a real
      // provider exists, only this block changes — everything else
      // (schema, UI, history) is already correct for a genuine 'complete'
      // result to show up here.
      swingAnalysisProvider.analyze(input.sourceMediaUrl).catch(() => {
        // Expected today. Silently leaves status at 'pending' — this is
        // not an error state for the user, it's the honest current state
        // of the product (no real provider connected yet).
      });

      return created;
    },
    [selfId],
  );

  const value: RealCaddieContextValue = { analyses, isLoading, getAnalysis, createAnalysis };

  return <RealCaddieContext.Provider value={value}>{children}</RealCaddieContext.Provider>;
}

export function useRealCaddie(): RealCaddieContextValue {
  const ctx = useContext(RealCaddieContext);
  if (!ctx) throw new Error("useRealCaddie must be used within a RealCaddieProvider");
  return ctx;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import { useLocale } from "../i18n/LocaleContext";
import type { CaddieAnalysis, CaddieAnalysisDetails, CaddieAnalysisStatus, CaddieSourceType } from "../types";

interface CaddieAnalysisRow {
  id: string;
  owner_id: string;
  source_type: CaddieSourceType;
  source_post_id: string | null;
  source_media_url: string;
  thumbnail_url: string | null;
  swing_type: string | null;
  status: CaddieAnalysisStatus;
  analysis_summary: string | null;
  strengths: string[];
  issues: string[];
  recommendations: string[];
  drills: string[];
  analysis_json: Record<string, unknown> | null;
  camera_angle: string | null;
  model: string | null;
  error_message: string | null;
  shared_to_community: boolean;
  created_at: string;
  updated_at: string;
}

// analysis_json is stored exactly as Gemini returned it (snake_case field
// names) — this maps it into the camelCase shape the rest of the app uses.
// Real rows only; demo mode's fixture data never sets analysis_json.
function jsonToDetails(json: Record<string, unknown> | null): CaddieAnalysisDetails | undefined {
  if (!json) return undefined;
  const workOn = Array.isArray(json.work_on) ? (json.work_on as Record<string, unknown>[]) : [];
  const focus = (json.focus as Record<string, unknown>) ?? {};
  const drill = (json.drill as Record<string, unknown>) ?? {};
  return {
    summary: String(json.summary ?? ""),
    cameraAngle: (json.camera_angle as CaddieAnalysisDetails["cameraAngle"]) ?? "uncertain",
    strengths: Array.isArray(json.strengths) ? (json.strengths as string[]) : [],
    workOn: workOn.map((w) => ({
      issue: String(w.issue ?? ""),
      whyItMatters: String(w.why_it_matters ?? ""),
      confidence: (w.confidence as CaddieAnalysisDetails["workOn"][number]["confidence"]) ?? "medium",
    })),
    focus: { title: String(focus.title ?? ""), instruction: String(focus.instruction ?? "") },
    drill: { name: String(drill.name ?? ""), steps: Array.isArray(drill.steps) ? (drill.steps as string[]) : [] },
    limitations: Array.isArray(json.limitations) ? (json.limitations as string[]) : [],
  };
}

function rowToAnalysis(row: CaddieAnalysisRow): CaddieAnalysis {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sourceType: row.source_type,
    sourcePostId: row.source_post_id ?? undefined,
    sourceMediaUrl: row.source_media_url,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    swingType: row.swing_type ?? undefined,
    status: row.status,
    analysisSummary: row.analysis_summary ?? undefined,
    strengths: row.strengths,
    issues: row.issues,
    recommendations: row.recommendations,
    drills: row.drills,
    details: jsonToDetails(row.analysis_json),
    model: row.model ?? undefined,
    errorMessage: row.error_message ?? undefined,
    sharedToCommunity: row.shared_to_community,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateAnalysisInput {
  sourceType: CaddieSourceType;
  sourcePostId?: string;
  sourceMediaUrl: string;
  thumbnailUrl?: string;
  swingType?: string;
}

interface RealCaddieContextValue {
  analyses: CaddieAnalysis[];
  isLoading: boolean;
  getAnalysis: (id: string) => CaddieAnalysis | undefined;
  createAnalysis: (input: CreateAnalysisInput) => Promise<CaddieAnalysis>;
  markShared: (id: string) => Promise<void>;
}

const RealCaddieContext = createContext<RealCaddieContextValue | null>(null);

export function RealCaddieProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser } = useAuth();
  const { locale } = useLocale();
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
      // The Edge Function owns the whole row lifecycle (insert at
      // 'processing', then update to 'complete'/'failed') — see
      // supabase/functions/analyze-swing. It reads GEMINI_API_KEY
      // server-side only and validates ownership via existing RLS/triggers
      // using this same caller's JWT (supabase.functions.invoke forwards
      // the current session's Authorization header automatically).
      const { data, error } = await supabase.functions.invoke("analyze-swing", {
        body: {
          sourceType: input.sourceType,
          sourcePostId: input.sourcePostId,
          sourceMediaUrl: input.sourceMediaUrl,
          thumbnailUrl: input.thumbnailUrl,
          swingType: input.swingType,
          locale,
        },
      });
      if (error) {
        // supabase-js's FunctionsHttpError carries the JSON error body on
        // `context` for non-2xx responses — surface that message (it's
        // always one of this function's own safe, user-facing strings,
        // never a raw provider error) instead of a generic "Edge Function
        // returned a non-2xx status code."
        let message = error.message;
        try {
          const body = await error.context?.json();
          if (body?.error) message = body.error;
        } catch {
          // Falls back to error.message below.
        }
        throw new Error(message);
      }
      const row = (data as { analysis: CaddieAnalysisRow }).analysis;
      const created = rowToAnalysis(row);
      setRows((prev) => {
        const withoutDuplicate = prev.filter((r) => r.id !== row.id);
        return [row, ...withoutDuplicate];
      });
      return created;
    },
    [selfId, locale],
  );

  const markShared = useCallback(async (id: string) => {
    const { error } = await supabase.from("caddie_analyses").update({ shared_to_community: true }).eq("id", id);
    if (error) throw new Error(error.message);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, shared_to_community: true } : r)));
  }, []);

  const value: RealCaddieContextValue = { analyses, isLoading, getAnalysis, createAnalysis, markShared };

  return <RealCaddieContext.Provider value={value}>{children}</RealCaddieContext.Provider>;
}

export function useRealCaddie(): RealCaddieContextValue {
  const ctx = useContext(RealCaddieContext);
  if (!ctx) throw new Error("useRealCaddie must be used within a RealCaddieProvider");
  return ctx;
}

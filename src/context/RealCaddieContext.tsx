import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { supabase } from "../lib/supabase";
import { SIGNED_URL_CHECK_INTERVAL_MS, SIGNED_URL_REFRESH_MARGIN_MS, signCaddieMediaPaths } from "../lib/caddieMedia";
import type { SignedUrlEntry } from "../lib/caddieMedia";
import { CaddieRequestError } from "../lib/caddieAnalysis";
import { useAuth } from "./AuthContext";
import { useLocale } from "../i18n/LocaleContext";
import type {
  CaddieAnalysis,
  CaddieAnalysisDetails,
  CaddieAnalysisStatus,
  CaddiePhaseMoment,
  CaddiePoseData,
  CaddieScore,
  CaddieScoreCriterionKey,
  CaddieSourceType,
  CaddieSwingPhases,
} from "../types";

interface CaddieAnalysisRow {
  id: string;
  owner_id: string;
  source_type: CaddieSourceType;
  source_post_id: string | null;
  // Public URL (Ask Caddie on a Community post / legacy direct upload), or
  // null when the media lives in the private caddie-media bucket at
  // source_media_path (migration 20260925090000). Optional so a row from a
  // not-yet-migrated database still maps cleanly.
  source_media_url: string | null;
  thumbnail_url: string | null;
  source_media_path?: string | null;
  thumbnail_path?: string | null;
  swing_type: string | null;
  status: CaddieAnalysisStatus;
  analysis_summary: string | null;
  strengths: string[];
  issues: string[];
  recommendations: string[];
  drills: string[];
  analysis_json: Record<string, unknown> | null;
  // Heavy (~50 KB avg, up to ~120 KB per row: every sampled frame's
  // keypoints). Deliberately NOT part of the list select below -- only the
  // detail screen's replay overlay needs it, so it's lazy-loaded per
  // analysis via loadPoseData(). Present only on rows returned whole by an
  // Edge Function (createAnalysis / translateAnalysis).
  roboflow_analysis_json?: Record<string, unknown> | null;
  camera_angle: string | null;
  score: number | null;
  model: string | null;
  error_message: string | null;
  shared_to_community: boolean;
  created_at: string;
  updated_at: string;
}

// analysis_json is stored exactly as Gemini returned it (snake_case field
// names) — this maps it into the camelCase shape the rest of the app uses.
// Real rows only; demo mode's fixture data never sets analysis_json.
function jsonToPhaseMoment(raw: Record<string, unknown> | undefined): CaddiePhaseMoment {
  return {
    timestampSeconds: typeof raw?.timestamp_seconds === "number" ? raw.timestamp_seconds : null,
    confidence: (raw?.confidence as CaddiePhaseMoment["confidence"]) ?? null,
  };
}

function jsonToPhases(raw: unknown): CaddieSwingPhases | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const phases = raw as Record<string, Record<string, unknown>>;
  const impact = phases.impact ?? {};
  return {
    address: jsonToPhaseMoment(phases.address),
    backswing: jsonToPhaseMoment(phases.backswing),
    top: jsonToPhaseMoment(phases.top),
    downswing: jsonToPhaseMoment(phases.downswing),
    impact: {
      windowStartSeconds: typeof impact.window_start_seconds === "number" ? impact.window_start_seconds : null,
      windowEndSeconds: typeof impact.window_end_seconds === "number" ? impact.window_end_seconds : null,
      confidence: (impact.confidence as CaddiePhaseMoment["confidence"]) ?? null,
    },
    followThrough: jsonToPhaseMoment(phases.follow_through),
  };
}

const SCORE_CRITERION_KEYS: [string, CaddieScoreCriterionKey][] = [
  ["setup_and_posture", "setupAndPosture"],
  ["backswing", "backswing"],
  ["downswing_sequencing", "downswingSequencing"],
  ["balance_and_weight_transfer", "balanceAndWeightTransfer"],
  ["finish", "finish"],
];

function jsonToScore(raw: unknown, total: number | null): CaddieScore | undefined {
  if (!raw || typeof raw !== "object" || total === null) return undefined;
  const json = raw as Record<string, Record<string, unknown>>;
  const criteria = {} as Record<CaddieScoreCriterionKey, { points: number; reason: string }>;
  for (const [jsonKey, key] of SCORE_CRITERION_KEYS) {
    const c = json[jsonKey] ?? {};
    criteria[key] = { points: typeof c.points === "number" ? c.points : 0, reason: String(c.reason ?? "") };
  }
  return { total, criteria };
}

function jsonToDetails(json: Record<string, unknown> | null, scoreTotal: number | null): CaddieAnalysisDetails | undefined {
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
    phases: jsonToPhases(json.phases),
    score: jsonToScore(json.score, scoreTotal),
  };
}

function jsonToPoseData(raw: Record<string, unknown> | null): CaddiePoseData | undefined {
  if (!raw || !Array.isArray(raw.frames)) return undefined;
  const video = (raw.video as Record<string, unknown>) ?? {};
  return {
    analysisFps: typeof video.analysis_fps === "number" ? video.analysis_fps : 8,
    frames: (raw.frames as Record<string, unknown>[]).map((f) => {
      const rawKeypoints = (f.keypoints as Record<string, Record<string, unknown>>) ?? {};
      const keypoints: CaddiePoseData["frames"][number]["keypoints"] = {};
      for (const [name, kp] of Object.entries(rawKeypoints)) {
        if (typeof kp.x === "number" && typeof kp.y === "number") {
          keypoints[name] = { x: kp.x, y: kp.y, confidence: typeof kp.confidence === "number" ? kp.confidence : 0 };
        }
      }
      return {
        frameIndex: typeof f.frame_index === "number" ? f.frame_index : 0,
        timestampSeconds: typeof f.timestamp_seconds === "number" ? f.timestamp_seconds : 0,
        personConfidence: typeof f.person_confidence === "number" ? f.person_confidence : null,
        keypoints,
      };
    }),
  };
}

// A private path resolves through the signed-URL cache ("" / undefined until
// signed — every renderer already guards on a falsy URL); otherwise the
// row's public URL is used as-is.
function rowToAnalysis(row: CaddieAnalysisRow, poseData: CaddiePoseData | undefined, signed: Map<string, SignedUrlEntry>): CaddieAnalysis {
  const sourceMediaPath = row.source_media_path ?? undefined;
  const thumbnailPath = row.thumbnail_path ?? undefined;
  return {
    id: row.id,
    ownerId: row.owner_id,
    sourceType: row.source_type,
    sourcePostId: row.source_post_id ?? undefined,
    sourceMediaUrl: sourceMediaPath ? (signed.get(sourceMediaPath)?.url ?? "") : (row.source_media_url ?? ""),
    thumbnailUrl: thumbnailPath ? signed.get(thumbnailPath)?.url : (row.thumbnail_url ?? undefined),
    sourceMediaPath,
    thumbnailPath,
    swingType: row.swing_type ?? undefined,
    status: row.status,
    analysisSummary: row.analysis_summary ?? undefined,
    strengths: row.strengths,
    issues: row.issues,
    recommendations: row.recommendations,
    drills: row.drills,
    details: jsonToDetails(row.analysis_json, row.score),
    poseData,
    score: row.score ?? undefined,
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
  // A private direct upload sends its caddie-media object paths (the
  // server re-checks they're in the caller's own folder and signs them
  // itself). sourceMediaUrl is only for a Community post's public video
  // (the server ignores it for community_post and reads the post's own
  // media) or a legacy row that still lives in community-media.
  sourceMediaPath?: string;
  thumbnailPath?: string;
  sourceMediaUrl?: string;
  thumbnailUrl?: string;
  swingType?: string;
  // A golfer-picked window within a longer source video (see
  // VideoTrimSelector) — undefined means "analyze the whole clip."
  startSeconds?: number;
  endSeconds?: number;
}

interface RealCaddieContextValue {
  analyses: CaddieAnalysis[];
  isLoading: boolean;
  /** True once the first fetch for the current account has finished (or always, in demo). */
  hasLoaded: boolean;
  getAnalysis: (id: string) => CaddieAnalysis | undefined;
  createAnalysis: (input: CreateAnalysisInput) => Promise<CaddieAnalysis>;
  markShared: (id: string) => Promise<void>;
  translateAnalysis: (id: string, locale: string) => Promise<void>;
  /**
   * Fetches this analysis's pose frames (roboflow_analysis_json) if they
   * aren't cached yet; the result shows up as `poseData` on that analysis.
   * The list fetch deliberately omits them -- call this from any screen that
   * renders the replay overlay, passing the row's current updatedAt. Only
   * call it for complete rows. No-op in demo.
   */
  loadPoseData: (id: string, rowUpdatedAt: string) => Promise<void>;
  /** Re-signs these private caddie-media paths now (e.g. after a video/image load error). No-op in demo. */
  refreshMediaUrls: (paths: Array<string | undefined>) => void;
}

// Everything the list, nav ring, PostCard and detail text need -- every
// column except the heavy roboflow_analysis_json (see CaddieAnalysisRow).
const LIST_COLUMNS =
  "id, owner_id, source_type, source_post_id, source_media_url, thumbnail_url, source_media_path, thumbnail_path, swing_type, status, analysis_summary, strengths, issues, recommendations, drills, analysis_json, camera_angle, score, model, error_message, shared_to_community, created_at, updated_at";

// Pose data per analysis id. `updatedAt` is the row version it was fetched
// at: a fetched-but-empty result (row still processing, or a pre-Roboflow
// analysis) is retried once the row changes; real pose frames never change
// after completion (translate only rewrites text), so those stay cached.
// This is a read-through cache of server data, not durable state -- the
// caddie_analyses row stays the source of truth.
interface PoseCacheEntry {
  updatedAt: string;
  pose: CaddiePoseData | undefined;
}

const RealCaddieContext = createContext<RealCaddieContextValue | null>(null);

export function RealCaddieProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser } = useAuth();
  const { locale } = useLocale();
  const [rows, setRows] = useState<CaddieAnalysisRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Which account the first fetch has completed for — lets a deep-linked
  // detail screen (push tap from a killed app, web refresh) wait for data
  // instead of treating "not loaded yet" as "doesn't exist".
  const [loadedForId, setLoadedForId] = useState<string | undefined>(undefined);
  const [poseCache, setPoseCache] = useState<Map<string, PoseCacheEntry>>(new Map());
  // Signed playback/thumbnail URLs for private caddie-media paths, keyed by
  // path. A derived read-through cache like poseCache -- the row's path is
  // the durable reference; these links are re-made whenever they're missing
  // or close to expiry and are never written anywhere.
  const [signedUrls, setSignedUrls] = useState<Map<string, SignedUrlEntry>>(new Map());
  const signedUrlsRef = useRef(signedUrls);
  const signingRef = useRef<Set<string>>(new Set());
  // Last forced re-sign per path (refreshMediaUrls), so a genuinely missing
  // object can't trigger a sign/error loop.
  const forcedAtRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    signedUrlsRef.current = signedUrls;
  }, [signedUrls]);
  // The in-flight list fetch, if any. A realtime event (or app resume) that
  // arrived while one was running used to be dropped outright -- if that
  // event was the processing -> complete flip and the in-flight query had
  // already read the row as processing, the list stayed stale until some
  // unrelated refetch. Now it sets pendingRefetchRef and exactly one more
  // fetch runs as soon as the current one finishes; callers awaiting
  // refetch() (the initial load that drives hasLoaded) get the in-flight
  // promise instead of an immediately-resolved no-op.
  const inFlightRef = useRef<{ selfId: string; promise: Promise<void> } | null>(null);
  const pendingRefetchRef = useRef(false);
  const selfId = authUser?.id;
  // Guards against an account switch mid-fetch writing the previous
  // account's rows into state.
  const selfIdRef = useRef(selfId);
  const poseCacheRef = useRef(poseCache);
  const poseInFlightRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    selfIdRef.current = selfId;
  }, [selfId]);
  useEffect(() => {
    poseCacheRef.current = poseCache;
  }, [poseCache]);

  const refetch = useCallback((): Promise<void> => {
    if (!selfId) return Promise.resolve();
    const inFlight = inFlightRef.current;
    if (inFlight && inFlight.selfId === selfId) {
      pendingRefetchRef.current = true;
      return inFlight.promise;
    }
    const run: Promise<void> = (async () => {
      try {
        const { data, error } = await supabase
          .from("caddie_analyses")
          .select(LIST_COLUMNS)
          .eq("owner_id", selfId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (selfIdRef.current !== selfId) return;
        setRows((data ?? []) as CaddieAnalysisRow[]);
      } catch (err) {
        console.error("GolfMe: failed to load Caddie history.", err);
      }
    })().finally(() => {
      // Only clear/follow up if this is still the tracked fetch (an account
      // switch may have started a newer one for a different selfId).
      if (inFlightRef.current?.promise !== run) return;
      inFlightRef.current = null;
      if (pendingRefetchRef.current) {
        pendingRefetchRef.current = false;
        void refetch();
      }
    });
    inFlightRef.current = { selfId, promise: run };
    return run;
  }, [selfId]);

  // Seeds the pose cache from a whole row an Edge Function handed back
  // (it includes roboflow_analysis_json), so opening that analysis right
  // after creating/translating it doesn't need a second round trip.
  const cachePoseFromFullRow = useCallback((row: CaddieAnalysisRow) => {
    if (row.roboflow_analysis_json === undefined) return;
    const pose = jsonToPoseData(row.roboflow_analysis_json);
    setPoseCache((prev) => {
      const existing = prev.get(row.id);
      if (existing?.pose && !pose) return prev;
      return new Map(prev).set(row.id, { updatedAt: row.updated_at, pose });
    });
  }, []);

  const loadPoseData = useCallback(
    async (id: string, rowUpdatedAt: string) => {
      if (isDemo || !selfId) return;
      const cached = poseCacheRef.current.get(id);
      if (cached && (cached.pose || cached.updatedAt === rowUpdatedAt)) return;
      if (poseInFlightRef.current.has(id)) return;
      poseInFlightRef.current.add(id);
      try {
        const { data, error } = await supabase.from("caddie_analyses").select("id, updated_at, roboflow_analysis_json").eq("id", id).maybeSingle();
        if (error) throw error;
        if (!data || selfIdRef.current !== selfId) return;
        const fetched = data as { id: string; updated_at: string; roboflow_analysis_json: Record<string, unknown> | null };
        setPoseCache((prev) => new Map(prev).set(id, { updatedAt: fetched.updated_at, pose: jsonToPoseData(fetched.roboflow_analysis_json) }));
      } catch (err) {
        console.error("GolfMe: failed to load Caddie pose data.", err);
      } finally {
        poseInFlightRef.current.delete(id);
      }
    },
    [isDemo, selfId],
  );

  useEffect(() => {
    if (isDemo || !selfId) {
      setRows([]);
      setPoseCache(new Map());
      setSignedUrls(new Map());
      return;
    }
    setIsLoading(true);
    refetch().finally(() => {
      setIsLoading(false);
      setLoadedForId(selfId);
    });

    // Own-row-only data (RLS already guarantees no other user's changes can
    // ever reach this filter), so a single owner-scoped subscription is
    // enough — no cross-account traffic to worry about, unlike Community.
    const channel = supabase
      .channel("caddie-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "caddie_analyses", filter: `owner_id=eq.${selfId}` }, () => refetch())
      .subscribe();

    // Realtime alone isn't enough: its WebSocket commonly drops while the
    // app is backgrounded/suspended (iOS WKWebView), and a missed "flipped
    // to complete" event during that window meant the in-memory list just
    // stayed stale forever -- Caddie history, the analysis detail screen,
    // and the bottom-nav indicator all read from this one context, so they
    // all showed it too. Reconciling against the real DB state every time
    // the app becomes active again (in addition to the initial fetch above,
    // which already covers cold launch) closes that gap without any new
    // schema, backend change, or ongoing poll loop -- just re-running the
    // fetch that already exists and is already correct whenever it fires.
    // Capacitor's web implementation of this event bridges to the Page
    // Visibility API, so this behaves the same on both native and web.
    const appStateListener = CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) refetch();
    });

    return () => {
      supabase.removeChannel(channel);
      appStateListener.then((l) => l.remove());
    };
  }, [isDemo, selfId, refetch]);

  // Signs any private path that has no URL yet or whose URL is within
  // SIGNED_URL_REFRESH_MARGIN_MS of expiring. Runs whenever the row list
  // changes (initial load, realtime, app resume -- all go through refetch)
  // and on a slow timer, so a screen left open for hours still re-signs
  // before its link lapses.
  useEffect(() => {
    if (isDemo || !selfId) return;
    const signMissing = () => {
      const now = Date.now();
      const needed = [
        ...new Set(rows.flatMap((r) => [r.source_media_path, r.thumbnail_path]).filter((p): p is string => typeof p === "string" && p.length > 0)),
      ].filter((p) => {
        if (signingRef.current.has(p)) return false;
        const entry = signedUrlsRef.current.get(p);
        return !entry || entry.expiresAt - now < SIGNED_URL_REFRESH_MARGIN_MS;
      });
      if (needed.length === 0) return;
      needed.forEach((p) => signingRef.current.add(p));
      void signCaddieMediaPaths(needed)
        .then((fresh) => {
          if (selfIdRef.current !== selfId || fresh.size === 0) return;
          setSignedUrls((prev) => {
            const next = new Map(prev);
            fresh.forEach((entry, path) => next.set(path, entry));
            return next;
          });
        })
        .finally(() => needed.forEach((p) => signingRef.current.delete(p)));
    };
    signMissing();
    const timer = window.setInterval(signMissing, SIGNED_URL_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [rows, isDemo, selfId]);

  const analyses = useMemo(
    () => rows.map((row) => rowToAnalysis(row, poseCache.get(row.id)?.pose, signedUrls)),
    [rows, poseCache, signedUrls],
  );

  const getAnalysis = useCallback((id: string) => analyses.find((a) => a.id === id), [analyses]);

  // Forced re-sign, for a player/poster that failed to load (most likely an
  // expired link after a long pause or backgrounding). At most once per 30 s
  // per path.
  const refreshMediaUrls = useCallback(
    (paths: Array<string | undefined>) => {
      if (isDemo || !selfId) return;
      const now = Date.now();
      const due = [...new Set(paths.filter((p): p is string => !!p))].filter((p) => {
        const last = forcedAtRef.current.get(p) ?? 0;
        return now - last > 30_000 && !signingRef.current.has(p);
      });
      if (due.length === 0) return;
      due.forEach((p) => {
        forcedAtRef.current.set(p, now);
        signingRef.current.add(p);
      });
      void signCaddieMediaPaths(due)
        .then((fresh) => {
          if (selfIdRef.current !== selfId || fresh.size === 0) return;
          setSignedUrls((prev) => {
            const next = new Map(prev);
            fresh.forEach((entry, path) => next.set(path, entry));
            return next;
          });
        })
        .finally(() => due.forEach((p) => signingRef.current.delete(p)));
    },
    [isDemo, selfId],
  );

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
          sourceMediaPath: input.sourceMediaPath,
          thumbnailPath: input.thumbnailPath,
          sourceMediaUrl: input.sourceMediaUrl,
          thumbnailUrl: input.thumbnailUrl,
          swingType: input.swingType,
          startSeconds: input.startSeconds,
          endSeconds: input.endSeconds,
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
        const status = typeof error.context?.status === "number" ? (error.context.status as number) : undefined;
        try {
          const body = await error.context?.json();
          if (body?.error) message = body.error;
        } catch {
          // Falls back to error.message below.
        }
        throw new CaddieRequestError(message, status);
      }
      const row = (data as { analysis: CaddieAnalysisRow }).analysis;
      cachePoseFromFullRow(row);
      const created = rowToAnalysis(row, row.roboflow_analysis_json ? jsonToPoseData(row.roboflow_analysis_json) : undefined, signedUrlsRef.current);
      setRows((prev) => {
        const withoutDuplicate = prev.filter((r) => r.id !== row.id);
        return [row, ...withoutDuplicate];
      });
      return created;
    },
    [selfId, locale, cachePoseFromFullRow],
  );

  const markShared = useCallback(async (id: string) => {
    const { error } = await supabase.from("caddie_analyses").update({ shared_to_community: true }).eq("id", id);
    if (error) throw new Error(error.message);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, shared_to_community: true } : r)));
  }, []);

  const translateAnalysis = useCallback(async (id: string, locale: string) => {
    // Text-only Gemini call on the SAVED analysis — no video, no Roboflow —
    // see supabase/functions/translate-caddie-analysis. Updates the row's
    // free-text fields in place; realtime (or the local merge below) picks
    // up the change without a page reload.
    const { data, error } = await supabase.functions.invoke("translate-caddie-analysis", { body: { analysisId: id, locale } });
    if (error) {
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
    cachePoseFromFullRow(row);
    setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
  }, [cachePoseFromFullRow]);

  const hasLoaded = isDemo || (!!selfId && loadedForId === selfId);

  const value = useMemo<RealCaddieContextValue>(
    () => ({ analyses, isLoading, hasLoaded, getAnalysis, createAnalysis, markShared, translateAnalysis, loadPoseData, refreshMediaUrls }),
    [analyses, isLoading, hasLoaded, getAnalysis, createAnalysis, markShared, translateAnalysis, loadPoseData, refreshMediaUrls],
  );

  return <RealCaddieContext.Provider value={value}>{children}</RealCaddieContext.Provider>;
}

export function useRealCaddie(): RealCaddieContextValue {
  const ctx = useContext(RealCaddieContext);
  if (!ctx) throw new Error("useRealCaddie must be used within a RealCaddieProvider");
  return ctx;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { supabase } from "../lib/supabase";
import { CADDIE_MEDIA_BUCKET, SIGNED_URL_CHECK_INTERVAL_MS, SIGNED_URL_REFRESH_MARGIN_MS, signCaddieMediaPaths } from "../lib/caddieMedia";
import type { SignedUrlEntry } from "../lib/caddieMedia";
import { CaddieRequestError, isStaleProcessing } from "../lib/caddieAnalysis";
import { parseCaddieFailure } from "../lib/caddieFailure";
import { isMissingSavedColumn } from "../lib/caddieSaved";
import { checkpointCuesFromJson } from "../lib/coachReplay";
import { analysisLanguageFromJson } from "../lib/caddieLanguage";
import { sanitizeWorkOnCheckpoint } from "../../supabase/functions/_shared/caddieCues.ts";
import { phasesFromJson, poseDataFromJson } from "../../supabase/functions/_shared/caddieVerdicts.ts";
import { useAuth } from "./AuthContext";
import { useLocale } from "../i18n/LocaleContext";
import { caddieFeedbackLanguage } from "../lib/caddieFeedbackLanguage";
import type { CaddieAnalysis, CaddieAnalysisDetails, CaddieAnalysisStatus, CaddiePoseData, CaddieScore, CaddieScoreCriterionKey, CaddieSourceType } from "../types";

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
  // Job bookkeeping (migration 20261107140000). Optional so a row returned
  // by an older Edge Function build still maps cleanly.
  attempt?: number | null;
  attempt_started_at?: string | null;
  stage?: string | null;
  stage_updated_at?: string | null;
  failure_stage?: string | null;
  failure_category?: string | null;
  finished_at?: string | null;
  // Saved swings (migration 20261107210000). Absent when the column isn't
  // there yet or the row came from an Edge Function that doesn't select it.
  saved_at?: string | null;
}

// analysis_json is stored exactly as Gemini returned it (snake_case field
// names) — this maps it into the camelCase shape the rest of the app uses.
// Real rows only; demo mode's fixture data never sets analysis_json.
// Phases and pose frames go through the same parsers analyze-swing uses
// for its measured-verdict check (_shared/caddieVerdicts.ts), so both
// sides measure the same swing.

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
    workOn: workOn.map((w) => {
      const checkpoint = sanitizeWorkOnCheckpoint(w.checkpoint);
      return {
        issue: String(w.issue ?? ""),
        whyItMatters: String(w.why_it_matters ?? ""),
        confidence: (w.confidence as CaddieAnalysisDetails["workOn"][number]["confidence"]) ?? "medium",
        ...(checkpoint ? { checkpoint } : {}),
      };
    }),
    focus: { title: String(focus.title ?? ""), instruction: String(focus.instruction ?? "") },
    drill: { name: String(drill.name ?? ""), steps: Array.isArray(drill.steps) ? (drill.steps as string[]) : [] },
    limitations: Array.isArray(json.limitations) ? (json.limitations as string[]) : [],
    phases: phasesFromJson(json.phases),
    checkpointCues: checkpointCuesFromJson(json.checkpoint_cues),
    language: analysisLanguageFromJson(json.language),
    score: jsonToScore(json.score, scoreTotal),
  };
}

const jsonToPoseData = (raw: Record<string, unknown> | null): CaddiePoseData | undefined => poseDataFromJson(raw);

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
    attempt: row.attempt ?? undefined,
    attemptStartedAt: row.attempt_started_at ?? undefined,
    stage: row.stage ?? undefined,
    stageUpdatedAt: row.stage_updated_at ?? undefined,
    failureStage: row.failure_stage ?? undefined,
    failureCategory: row.failure_category ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    savedAt: row.saved_at ?? undefined,
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
  /**
   * Try again on a failed (or abandoned) analysis: the SAME row is re-run
   * server-side (attempt + 1, no allowance charge). Idempotent — a double
   * tap gets the already-running row back.
   */
  retryAnalysis: (analysis: CaddieAnalysis) => Promise<CaddieAnalysis>;
  /**
   * Deletes one of the caller's analyses (failed, complete or dead; a live
   * one is refused with code "delete_running") via delete_caddie_analysis(),
   * then removes the private video/thumbnail/trimmed copies it returns.
   * Never refunds the daily allowance. Throws CaddieRequestError.
   */
  deleteAnalysis: (id: string) => Promise<void>;
  markShared: (id: string) => Promise<void>;
  /**
   * Saves (or un-saves) a complete analysis to Saved swings through
   * set_caddie_analysis_saved(). Optimistic: the list changes at once and
   * goes back if the call fails (then it throws). Real accounts only.
   */
  setSaved: (id: string, saved: boolean) => Promise<void>;
  /** True once the list was read with saved_at, i.e. migration 20261107210000 is applied. */
  savedSupported: boolean;
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
  /**
   * "Check again": asks the database to settle this account's abandoned
   * attempts (sweep_stale_caddie_jobs) and re-reads the list. Never marks
   * anything failed by itself: only the server decides. No-op in demo.
   */
  checkStatus: () => Promise<void>;
  /** The most recent history read failed or timed out; what's shown may be out of date. */
  historyLoadFailed: boolean;
}

// How often an in-flight analysis is re-read from the DB while the app is
// visible (see the processing poll in RealCaddieProvider).
const PROCESSING_POLL_MS = 5000;

// Everything the list, nav ring, PostCard and detail text need -- every
// column except the heavy roboflow_analysis_json (see CaddieAnalysisRow).
// The job columns need migration 20261107140000 (apply it before shipping
// this build). Keep in sync with translate-caddie-analysis's LIST_COLUMNS.
const LIST_COLUMNS =
  "id, owner_id, source_type, source_post_id, source_media_url, thumbnail_url, source_media_path, thumbnail_path, swing_type, status, analysis_summary, strengths, issues, recommendations, drills, analysis_json, camera_angle, score, model, error_message, shared_to_community, created_at, updated_at, attempt, attempt_started_at, stage, stage_updated_at, failure_stage, failure_category, finished_at";
// A history read that hasn't answered by then is aborted, so a hung request
// can't hold the one-at-a-time lock (inFlightRef) and block every later
// refresh (realtime, resume, the processing poll). The next trigger retries.
const HISTORY_FETCH_TIMEOUT_MS = 15_000;
// analyze-swing's own deadline is 330 s and sweep_stale_caddie_jobs()
// (migration 20261107140000) marks a 'processing' attempt older than 390 s
// failed/worker_lost. Past this, the app asks the database to run that
// sweep itself (owner-scoped RPC), so an attempt whose worker died reaches
// its real, retryable failure without the golfer having to start another
// analysis first.
const SWEEP_AFTER_MS = 400_000;
// Saved swings (migration 20261107210000). Asked for on top of
// LIST_COLUMNS; a database without the column answers 42703 and the list
// is read again without it (Save stays hidden for this session).
const LIST_COLUMNS_WITH_SAVED = `${LIST_COLUMNS}, saved_at`;

// An Edge Function's row (translate / analyze-swing) may not select
// saved_at: keep the value the list already had for that row.
function keepSavedAt(row: CaddieAnalysisRow, previous: CaddieAnalysisRow | undefined): CaddieAnalysisRow {
  return row.saved_at === undefined && previous && previous.saved_at !== undefined ? { ...row, saved_at: previous.saved_at } : row;
}

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

const SESSION_REFRESH_MARGIN_MS = 10 * 60 * 1000;

// Best-effort: if the refresh fails the invoke still goes out with the
// current token, exactly as before.
async function ensureFreshSession(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const expiresAt = data.session?.expires_at;
    if (data.session && typeof expiresAt === "number" && expiresAt * 1000 - Date.now() < SESSION_REFRESH_MARGIN_MS) {
      await supabase.auth.refreshSession();
    }
  } catch (err) {
    console.error("GolfMe: couldn't refresh the session before Caddie analysis.", err);
  }
}

export function RealCaddieProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser } = useAuth();
  const { locale } = useLocale();
  const [rows, setRows] = useState<CaddieAnalysisRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // The last history read failed or timed out (rows shown may be out of date).
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  // Which account the first fetch has completed for — lets a deep-linked
  // detail screen (push tap from a killed app, web refresh) wait for data
  // instead of treating "not loaded yet" as "doesn't exist".
  const [loadedForId, setLoadedForId] = useState<string | undefined>(undefined);
  const [poseCache, setPoseCache] = useState<Map<string, PoseCacheEntry>>(new Map());
  // Whether caddie_analyses has saved_at (migration 20261107210000), found
  // out by the list fetch itself. Database-wide, so it isn't reset on an
  // account switch.
  const savedColumnRef = useRef<"unknown" | "present" | "missing">("unknown");
  const [savedSupported, setSavedSupported] = useState(false);
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
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), HISTORY_FETCH_TIMEOUT_MS);
    const run: Promise<void> = (async () => {
      try {
        const listQuery = (columns: string) =>
          supabase.from("caddie_analyses").select(columns).eq("owner_id", selfId).order("created_at", { ascending: false }).abortSignal(controller.signal);
        const wantSaved = savedColumnRef.current !== "missing";
        let { data, error } = await listQuery(wantSaved ? LIST_COLUMNS_WITH_SAVED : LIST_COLUMNS);
        if (error && wantSaved && isMissingSavedColumn(error)) {
          // Migration 20261107210000 not applied yet: read the list as
          // before and keep Save hidden until the app is reopened.
          savedColumnRef.current = "missing";
          ({ data, error } = await listQuery(LIST_COLUMNS));
        } else if (!error && wantSaved) {
          savedColumnRef.current = "present";
        }
        if (error) throw error;
        if (selfIdRef.current !== selfId) return;
        setSavedSupported(savedColumnRef.current === "present");
        setRows((data ?? []) as unknown as CaddieAnalysisRow[]);
        setHistoryLoadFailed(false);
      } catch (err) {
        console.error(controller.signal.aborted ? "GolfMe: Caddie history request timed out." : "GolfMe: failed to load Caddie history.", err);
        // The rows already shown stay; screens can offer a retry.
        if (selfIdRef.current === selfId) setHistoryLoadFailed(true);
      }
    })().finally(() => {
      window.clearTimeout(timer);
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
    //
    // Every time the channel (re)enters SUBSCRIBED, refetch once: realtime-js
    // rejoins after a socket drop but never replays events from the gap, and
    // on iOS the socket was seen reconnecting ~6 times during one 3.5-min
    // analysis -- a processing -> complete flip landing in any of those gaps
    // used to leave the loading screen spinning while the app stayed open.
    // Same catch-up pattern RealSocialContext already uses.
    let disposed = false;
    let realtimeHealthy = false;
    const channel = supabase
      .channel("caddie-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "caddie_analyses", filter: `owner_id=eq.${selfId}` }, () => refetch())
      .subscribe((status) => {
        if (disposed) return;
        const wasHealthy = realtimeHealthy;
        realtimeHealthy = status === "SUBSCRIBED";
        if (!wasHealthy && realtimeHealthy) void refetch();
      });

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
      disposed = true;
      supabase.removeChannel(channel);
      appStateListener.then((l) => l.remove());
    };
  }, [isDemo, selfId, refetch]);

  // Foreground guarantee for an in-flight analysis: while any row is still
  // 'processing' (and not stale), re-read the real rows every few seconds
  // while the page is visible, so the loading screen flips to the result
  // even if the realtime event never arrives at all. This only ever re-runs
  // the existing DB fetch -- the caddie_analyses row stays the source of
  // truth; nothing about the job is tracked client-side. The timer exists
  // only while some row's status is 'processing', so it's gone the moment
  // the last job completes/fails (and in demo / signed out).
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const anyProcessing = rows.some((r) => r.status === "processing");
  // Asks the database to settle this caller's abandoned attempts (see
  // SWEEP_AFTER_MS), then re-reads the list. From the poll at most once a
  // minute per row attempt (the server decides with its own clock, so a
  // phone whose clock runs fast just gets a no-op and asks again later);
  // checkStatus() (the screen's "Check again") always runs it.
  const sweptAtRef = useRef<Map<string, number>>(new Map());
  const sweepAndRefetch = useCallback(async (): Promise<void> => {
    if (isDemo || !selfId) return;
    const { error } = await supabase.rpc("sweep_stale_caddie_jobs");
    if (error) console.error("GolfMe: couldn't check abandoned Caddie analyses.", error);
    await refetch();
  }, [isDemo, selfId, refetch]);
  useEffect(() => {
    if (isDemo || !selfId || !anyProcessing) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const processing = rowsRef.current.filter((r) => r.status === "processing");
      const overdue = processing.filter((r) => {
        const startedAt = new Date(r.attempt_started_at ?? r.created_at).getTime();
        const lastSweep = sweptAtRef.current.get(`${r.id}:${r.attempt ?? 1}`) ?? 0;
        return Date.now() - startedAt > SWEEP_AFTER_MS && Date.now() - lastSweep > 60_000;
      });
      if (overdue.length > 0) {
        overdue.forEach((r) => sweptAtRef.current.set(`${r.id}:${r.attempt ?? 1}`, Date.now()));
        void sweepAndRefetch();
        return;
      }
      const active = processing.some(
        (r) => !isStaleProcessing({ status: r.status, createdAt: r.created_at, attemptStartedAt: r.attempt_started_at ?? undefined }),
      );
      if (active) void refetch();
    }, PROCESSING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [isDemo, selfId, anyProcessing, refetch, sweepAndRefetch]);

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

  // One analyze-swing call, new analysis or Try again. The Edge Function
  // owns the whole row lifecycle (insert or re-run at 'processing', then
  // 'complete'/'failed') — see supabase/functions/analyze-swing. It reads
  // GEMINI_API_KEY server-side only and validates ownership via existing
  // RLS/triggers using this same caller's JWT (supabase.functions.invoke
  // forwards the current session's Authorization header automatically).
  const invokeAnalyzeSwing = useCallback(
    async (requestBody: Record<string, unknown>): Promise<CaddieAnalysis> => {
      if (!selfId) throw new Error("Not signed in.");
      // That same JWT is used for the pipeline's writes after the response
      // (up to the function's 330 s deadline), so a token about to expire
      // would make the final save fail. Refresh first when < 10 min remain.
      await ensureFreshSession();
      const { data, error } = await supabase.functions.invoke("analyze-swing", {
        // Caddie's feedback language (the Caddie screen's picker, else the app's).
        body: { ...requestBody, locale: caddieFeedbackLanguage(locale) },
      });
      if (error) {
        // supabase-js's FunctionsHttpError carries the JSON error body on
        // `context` for non-2xx responses. Every refusal carries a stable
        // `code`; the screen turns it into copy in the CADDIE language with
        // caddieErrorText() (this context only knows the app language, so
        // it never translates here). The server's English sentence rides
        // along only as that function's fallback input, never shown raw.
        let message = error.message;
        let code: string | undefined = error.name === "FunctionsFetchError" || error.name === "FunctionsRelayError" ? "network" : undefined;
        const status = typeof error.context?.status === "number" ? (error.context.status as number) : undefined;
        try {
          const body = await error.context?.json();
          if (body?.error) message = body.error;
          if (typeof body?.code === "string") code = body.code;
        } catch {
          // Falls back to error.message below.
        }
        throw new CaddieRequestError(message, status, code);
      }
      const row = (data as { analysis: CaddieAnalysisRow }).analysis;
      cachePoseFromFullRow(row);
      const result = rowToAnalysis(row, row.roboflow_analysis_json ? jsonToPoseData(row.roboflow_analysis_json) : undefined, signedUrlsRef.current);
      setRows((prev) => {
        const withoutDuplicate = prev.filter((r) => r.id !== row.id);
        // A Try again keeps the row where it was in the (created_at-ordered) list.
        const existingIndex = prev.findIndex((r) => r.id === row.id);
        if (existingIndex === -1) return [row, ...withoutDuplicate];
        const next = [...prev];
        next[existingIndex] = keepSavedAt(row, prev[existingIndex]);
        return next;
      });
      return result;
    },
    [selfId, locale, cachePoseFromFullRow],
  );

  const createAnalysis = useCallback(
    (input: CreateAnalysisInput): Promise<CaddieAnalysis> =>
      invokeAnalyzeSwing({
        sourceType: input.sourceType,
        sourcePostId: input.sourcePostId,
        sourceMediaPath: input.sourceMediaPath,
        thumbnailPath: input.thumbnailPath,
        sourceMediaUrl: input.sourceMediaUrl,
        thumbnailUrl: input.thumbnailUrl,
        swingType: input.swingType,
        startSeconds: input.startSeconds,
        endSeconds: input.endSeconds,
      }),
    [invokeAnalyzeSwing],
  );

  const retryAnalysis = useCallback(
    (analysis: CaddieAnalysis): Promise<CaddieAnalysis> => {
      // The legacy fields ride along so an analyze-swing build from before
      // retryAnalysisId still works (it creates a new row from them, the old
      // behavior). A current build ignores them and re-runs this row.
      const legacyWindow = parseCaddieFailure(analysis.errorMessage).window;
      return invokeAnalyzeSwing({
        retryAnalysisId: analysis.id,
        sourceType: analysis.sourceType,
        sourcePostId: analysis.sourcePostId,
        // Never re-send a signed URL: a private upload retries by path.
        ...(analysis.sourceMediaPath
          ? { sourceMediaPath: analysis.sourceMediaPath, thumbnailPath: analysis.thumbnailPath }
          : { sourceMediaUrl: analysis.sourceMediaUrl, thumbnailUrl: analysis.thumbnailUrl }),
        swingType: analysis.swingType,
        startSeconds: legacyWindow?.startSeconds,
        endSeconds: legacyWindow?.endSeconds,
      });
    },
    [invokeAnalyzeSwing],
  );

  const deleteAnalysis = useCallback(async (id: string) => {
    if (!selfId) throw new CaddieRequestError("Not signed in.", 401, "not_authenticated");
    const { data, error } = await supabase.rpc("delete_caddie_analysis", { p_analysis_id: id });
    if (error) {
      const code = error.hint === "caddie_delete_running" ? "delete_running" : error.code === "42501" ? "forbidden_delete" : undefined;
      throw new CaddieRequestError(error.message, undefined, code);
    }
    // The row is gone; its private files are removed through the Storage
    // API (owner-only policy). Best-effort: a leftover object is
    // unreferenced and private, never visible to anyone else.
    const paths = Array.isArray(data) ? (data as string[]).filter((p) => typeof p === "string" && p.startsWith(`${selfId}/`)) : [];
    if (paths.length > 0) {
      const { error: removeError } = await supabase.storage.from(CADDIE_MEDIA_BUCKET).remove(paths);
      if (removeError) console.error("GolfMe: couldn't remove a deleted analysis's files.", removeError);
    }
    // Realtime DELETE events don't carry owner_id, so the owner-filtered
    // subscription may not see this one: drop it locally.
    setRows((prev) => prev.filter((r) => r.id !== id));
    setPoseCache((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, [selfId]);

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
      const status = typeof error.context?.status === "number" ? (error.context.status as number) : undefined;
      try {
        const body = await error.context?.json();
        if (body?.error) message = body.error;
      } catch {
        // Falls back to error.message below.
      }
      // The HTTP status rides along so automatic translation can tell
      // "too soon, retry" (429) from a real failure.
      throw Object.assign(new Error(message), { status });
    }
    const row = (data as { analysis: CaddieAnalysisRow }).analysis;
    cachePoseFromFullRow(row);
    // The function now returns the light row (no pose frames). A
    // translation never changes the pose, so the frames already cached for
    // this analysis stay valid for its new updated_at instead of being
    // downloaded again.
    if (row.roboflow_analysis_json === undefined) {
      setPoseCache((prev) => {
        const cached = prev.get(row.id);
        return cached ? new Map(prev).set(row.id, { ...cached, updatedAt: row.updated_at }) : prev;
      });
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? keepSavedAt(row, r) : r)));
  }, [cachePoseFromFullRow]);

  const setSaved = useCallback(
    async (id: string, saved: boolean) => {
      if (!selfId) throw new CaddieRequestError("Not signed in.", 401, "not_authenticated");
      const before = rowsRef.current.find((r) => r.id === id);
      if (!before) throw new CaddieRequestError("Analysis not found.", 404, "save_not_found");
      const previous = before.saved_at ?? null;
      const optimistic = saved ? (previous ?? new Date().toISOString()) : null;
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, saved_at: optimistic } : r)));
      const { data, error } = await supabase.rpc("set_caddie_analysis_saved", { p_analysis_id: id, p_saved: saved });
      if (error) {
        // Put it back, unless something newer (a realtime refetch, another
        // tap) already replaced the optimistic value.
        setRows((prev) => prev.map((r) => (r.id === id && (r.saved_at ?? null) === optimistic ? { ...r, saved_at: previous } : r)));
        const code =
          error.hint === "caddie_save_not_complete" ? "save_not_complete" : error.hint === "caddie_save_not_found" ? "save_not_found" : undefined;
        throw new CaddieRequestError(error.message, undefined, code);
      }
      // The server's time (first save kept) replaces the optimistic one.
      const serverValue = typeof data === "string" ? data : null;
      setRows((prev) => prev.map((r) => (r.id === id && (r.saved_at ?? null) === optimistic ? { ...r, saved_at: serverValue } : r)));
    },
    [selfId],
  );

  const hasLoaded = isDemo || (!!selfId && loadedForId === selfId);

  const value = useMemo<RealCaddieContextValue>(
    () => ({
      analyses,
      isLoading,
      hasLoaded,
      getAnalysis,
      createAnalysis,
      retryAnalysis,
      deleteAnalysis,
      markShared,
      setSaved,
      savedSupported,
      translateAnalysis,
      loadPoseData,
      refreshMediaUrls,
      checkStatus: sweepAndRefetch,
      historyLoadFailed: !isDemo && historyLoadFailed,
    }),
    [analyses, isLoading, hasLoaded, getAnalysis, createAnalysis, retryAnalysis, deleteAnalysis, markShared, setSaved, savedSupported, translateAnalysis, loadPoseData, refreshMediaUrls, sweepAndRefetch, isDemo, historyLoadFailed],
  );

  return <RealCaddieContext.Provider value={value}>{children}</RealCaddieContext.Provider>;
}

export function useRealCaddie(): RealCaddieContextValue {
  const ctx = useContext(RealCaddieContext);
  if (!ctx) throw new Error("useRealCaddie must be used within a RealCaddieProvider");
  return ctx;
}

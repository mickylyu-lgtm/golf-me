import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, ArrowUpRight, Bookmark, BookmarkCheck, Check, Languages, Loader2, Share2, Trash2, Video } from "lucide-react";
import { canSaveAnalysis } from "../lib/caddieSaved";
import { TipList } from "../components/caddie/FilmingTips";
import { DeleteAnalysisDialog } from "../components/caddie/DeleteAnalysisDialog";
import { CaddieNavIcon } from "../components/icons/CaddieNavIcon";
import { CaddieThinking } from "../components/caddie/CaddieThinking";
import { CaddieSwingReplay } from "../components/caddie/CaddieSwingReplay";
import { CoachReplayDemo } from "../components/caddie/CoachReplayDemo";
import { DEMO_COACH_ANALYSIS_ID } from "../data/caddieCoachDemo";
import { useAuth } from "../context/AuthContext";
import { useCoachReplayEnabled } from "../lib/useCoachReplayEnabled";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useRealCaddie } from "../context/RealCaddieContext";
import { useLocale, LOCALES } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { formatShortDate } from "../lib/format";
import { postFeedbackThenMark } from "../lib/caddieShare";
import { isStaleProcessing, usePeriodicRerender } from "../lib/caddieAnalysis";
import { claimAutoTranslateAttempt, feedbackSampleText, needsAutoTranslate, releaseAutoTranslateAttempt, translateOffer } from "../lib/caddieLanguage";
import { translationRetryDelay } from "../lib/caddieTranslationRetry";
import { caddieErrorText } from "../lib/caddieErrorText";
import { demoLegacyFeedback } from "../data/caddie";
import { isExplicitCaddieLocale, isTranslationRunning, queueAutoTranslation, queueTranslation, whenTranslationSettled } from "../lib/caddieAutoTranslate";
import { useCaddieFeedbackLanguage } from "../lib/useCaddieFeedbackLanguage";
import { FAILURE_KIND_KEYS, analysisFailure } from "../lib/caddieFailure";
import type { CaddieConfidence, CaddieCameraAngle, CaddieScoreCriterionKey } from "../types";
import type { CreatePostSwingPrefill } from "./CreatePost";
import type { TranslationKey } from "../i18n/locales/en";
import { clubLabel } from "../lib/clubLabel";

const SCORE_CRITERIA_ORDER: [CaddieScoreCriterionKey, TranslationKey][] = [
  ["setupAndPosture", "caddie.scoreSetupAndPosture"],
  ["backswing", "caddie.scoreBackswing"],
  ["downswingSequencing", "caddie.scoreDownswingSequencing"],
  ["balanceAndWeightTransfer", "caddie.scoreBalanceAndWeightTransfer"],
  ["finish", "caddie.scoreFinish"],
];

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-1.5 text-sm text-slate-700">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-fairway-500" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CONFIDENCE_TONE: Record<CaddieConfidence, "fairway" | "outline" | "rose"> = { high: "fairway", medium: "outline", low: "rose" };

// Caddie's own result view. Prefers `analysis.details` (the real Gemini
// structured response — confidence per issue, one prioritized focus, one
// drill, honest limitations, camera angle) when present; falls back to the
// older flat strengths/issues/recommendations render for demo fixtures and
// any pre-Gemini row that predates `details` existing at all. Reused for
// both direct-upload and Community-sourced analyses — the only difference
// is the "From Community Post" breadcrumb.
export function CaddieAnalysisDetail() {
  const { analysisId } = useParams<{ analysisId: string }>();
  const {
    getCaddieAnalysis,
    getPost,
    retryCaddieAnalysis,
    markCaddieAnalysisShared,
    setCaddieAnalysisSaved,
    caddieSavedSupported,
    translateCaddieAnalysis,
    createPost,
    notifications,
    markNotificationRead,
  } = useData();
  const savingRef = useRef(false);
  const { hasLoaded: caddieHasLoaded, loadPoseData, refreshMediaUrls, checkStatus } = useRealCaddie();
  const { isDemo, authUser } = useAuth();
  const coachEnabled = useCoachReplayEnabled();
  // Inside CaddieLocaleScope: `t` and `dateLocale` are the Caddie feedback
  // language, like `locale` below (translation, the notice and Translate).
  const { t, locale: dateLocale } = useLocale();
  const locale = useCaddieFeedbackLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sharingFeedback, setSharingFeedback] = useState(false);
  // Analysis ids whose feedback post already went out on this screen, even
  // if marking shared_to_community then failed: never post them twice.
  const [feedbackPostedIds, setFeedbackPostedIds] = useState<Set<string>>(() => new Set());
  const sharingFeedbackRef = useRef(false);
  const [translating, setTranslating] = useState(false);

  const analysis = analysisId ? getCaddieAnalysis(analysisId) : undefined;

  // analyze-swing now marks a failed analysis status='failed' (kept, shown
  // with Try again) instead of deleting it (d1fb696). This still covers the
  // row disappearing out from under someone on the "Caddie is analyzing
  // your swing" screen (e.g. deleted elsewhere) — explain it with a toast
  // rather than silently bouncing back to /caddie.
  const wasProcessingRef = useRef(false);
  if (analysis?.status === "processing") wasProcessingRef.current = true;
  useEffect(() => {
    if (analysis || !analysisId || !wasProcessingRef.current) return;
    showToast(t("caddie.askCaddieError"), "warning");
  }, [analysis, analysisId, showToast, t]);

  usePeriodicRerender(analysis?.status === "processing");

  // The Caddie list fetch omits the heavy pose frames; the replay overlay
  // needs them, so pull them for just this analysis (cached in
  // RealCaddieContext, re-checked when the row flips to complete).
  const analysisStatus = analysis?.status;
  const analysisUpdatedAt = analysis?.updatedAt;
  useEffect(() => {
    if (!analysisId || analysisStatus !== "complete" || !analysisUpdatedAt) return;
    void loadPoseData(analysisId, analysisUpdatedAt);
  }, [analysisId, analysisStatus, analysisUpdatedAt, loadPoseData]);

  // Clears the bottom-nav "result ready" dot regardless of HOW someone got
  // here (the nav tap shortcut already marks it read too, but this covers
  // every other path — the Caddie hub list, Home's "Continue in Caddie"
  // card, a direct link) — viewing the result is what the spec says should
  // clear it, not just tapping one specific entry point.
  useEffect(() => {
    if (!analysisId) return;
    const match = notifications.find((n) => n.type === "caddie_analysis_complete" && n.linkTo === `/caddie/${analysisId}` && !n.read);
    if (match) markNotificationRead(match.id);
  }, [analysisId, notifications, markNotificationRead]);

  // Translates the feedback by itself when it is clearly not in the app's
  // language (needsAutoTranslate in lib/caddieLanguage.ts): once per
  // analysis and language per session, quietly (a failure just leaves the
  // Translate button). Everything less certain keeps the button.
  //
  // One translation at a time per analysis, shared with the Caddie
  // screen's picker (lib/caddieAutoTranslate; Micky, 2026-11-04: switching
  // the language quickly made it miss): while one runs, this only waits for
  // it; when it settles, `autoTick` re-runs the check against the language
  // the app is in NOW. A "too soon" answer (429) gives the attempt back and
  // retries once the server's cooldown has passed. A language picked in
  // Caddie's own picker is explicit, so it also covers older rows whose
  // language can't be told apart by script.
  const autoDetails = analysis?.status === "complete" ? analysis.details : undefined;
  const autoSample = feedbackSampleText(autoDetails);
  const autoLanguage = autoDetails?.language;
  const autoId = analysis?.id;
  // Scope both queued work and late responses to this account/page/language.
  const autoScopeKey = `${isDemo ? "demo" : authUser?.id ?? ""}:${autoId ?? ""}:${locale}`;
  const autoScopeRef = useRef({ key: autoScopeKey });
  if (autoScopeRef.current.key !== autoScopeKey) autoScopeRef.current = { key: autoScopeKey };
  const autoScope = autoScopeRef.current;
  const autoRetryRef = useRef({ scope: autoScope, until: 0, failures: 0 });
  const autoRequestRef = useRef<{ id: string; promise: Promise<void> } | null>(null);
  const [autoTick, setAutoTick] = useState(0);
  useEffect(() => {
    if (autoRetryRef.current.scope !== autoScope) autoRetryRef.current = { scope: autoScope, until: 0, failures: 0 };
    const retry = autoRetryRef.current;
    let disposed = false;
    let timer: ReturnType<typeof window.setTimeout> | undefined;
    const current = () => !disposed && autoScopeRef.current === autoScope;
    const cleanup = () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    const wakeAfter = (delay: number) => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (current()) setAutoTick((n) => n + 1);
      }, delay);
    };
    setTranslating(false);
    if (isDemo || !authUser?.id || !autoId || !autoSample) return cleanup;
    if (!needsAutoTranslate({ language: autoLanguage, sampleText: autoSample }, locale, isExplicitCaddieLocale(locale))) return cleanup;
    // A rerender cannot bypass an already scheduled server cooldown.
    if (retry.until > Date.now()) {
      wakeAfter(retry.until - Date.now());
      return cleanup;
    }
    if (autoRequestRef.current?.id === autoId || isTranslationRunning(autoId)) {
      setTranslating(true);
      const pending = autoRequestRef.current?.id === autoId ? autoRequestRef.current.promise : whenTranslationSettled(autoId);
      void pending.then(() => {
        if (!current()) return;
        setTranslating(false);
        setAutoTick((n) => n + 1);
      });
      return cleanup;
    }
    if (!claimAutoTranslateAttempt(autoId, locale)) return cleanup;
    setTranslating(true);
    const target = locale;
    const request = queueAutoTranslation(autoId, target, () => autoScopeRef.current === autoScope && !disposed ? target : "", translateCaddieAnalysis)
      .then(() => {
        releaseAutoTranslateAttempt(autoId, target);
        if (autoScopeRef.current === autoScope) { retry.until = 0; retry.failures = 0; }
      })
      .catch((err) => {
        const delay = translationRetryDelay(err, retry.failures + 1);
        if (delay !== null || autoScopeRef.current !== autoScope) releaseAutoTranslateAttempt(autoId, target);
        if (autoScopeRef.current !== autoScope) return;
        if (delay !== null) {
          retry.failures++;
          retry.until = Date.now() + delay;
          if (current()) wakeAfter(delay);
        } else {
          console.error("GolfMe: automatic feedback translation failed.", err);
        }
      })
      .finally(() => {
        if (current()) setTranslating(false);
        // Success updates the row/language. A refusal wakes ONLY at its
        // deadline; an unconditional autoTick here would bypass that wait.
      });
    autoRequestRef.current = { id: autoId, promise: request };
    void request.then(() => {
      if (autoRequestRef.current?.promise === request) autoRequestRef.current = null;
    });
    return cleanup;
  }, [isDemo, authUser?.id, autoScope, autoId, autoSample, autoLanguage, locale, translateCaddieAnalysis, autoTick]);

  // Opened cold (push tap from a killed app, web refresh) the list hasn't
  // loaded yet — wait for the first fetch before deciding the row is gone.
  if (!analysis && !caddieHasLoaded) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 size={24} className="animate-spin text-fairway-600" />
      </div>
    );
  }
  if (!analysis) return <Navigate to="/caddie" replace />;

  const sourcePost = analysis.sourcePostId ? getPost(analysis.sourcePostId) : undefined;
  const details = analysis.details;
  // Flat legacy feedback; the demo's fixture rows read in the screen's language.
  const legacy = demoLegacyFeedback(analysis, t);
  const failure = analysisFailure(analysis.errorMessage, isStaleProcessing(analysis), analysis.failureCategory, analysis.attempt);
  const failureKeys = FAILURE_KIND_KEYS[failure.kind];

  function shareToCommunity() {
    if (!analysis) return;
    // A private direct upload hands over its caddie-media PATHS (plus the
    // current signed URL, for the composer's preview only). CreatePost
    // copies the files into public community-media when — and only if —
    // the post is actually published, so the public post never points at
    // the private original. A Community-sourced analysis already has a
    // public URL and is reused as before.
    // The composer's starting caption, in Caddie's language like the rest of this screen.
    const caption = analysis.swingType ? t("caddie.shareCaption", { club: clubLabel(analysis.swingType, t) }) : "";
    const prefill: CreatePostSwingPrefill = analysis.sourceMediaPath
      ? {
          swingVideoUrl: analysis.sourceMediaUrl,
          privateVideoPath: analysis.sourceMediaPath,
          privateThumbnailPath: analysis.thumbnailPath,
          caption,
        }
      : {
          swingVideoUrl: analysis.sourceMediaUrl,
          videoThumbnailUrl: analysis.thumbnailUrl,
          caption,
        };
    navigate("/community/new", { state: prefill });
  }

  const isSaved = !!analysis.savedAt;
  // Optimistic in the data layer (the bookmark flips at once and goes back
  // on failure); this only guards a double tap and says why it went back.
  async function toggleSaved() {
    if (!analysis || savingRef.current) return;
    savingRef.current = true;
    const next = !analysis.savedAt;
    try {
      await setCaddieAnalysisSaved(analysis.id, next);
    } catch (err) {
      console.error("GolfMe: couldn't update Saved swings.", err);
      showToast(next ? t("caddie.saved.saveFailed") : t("caddie.saved.unsaveFailed"), "warning");
    } finally {
      savingRef.current = false;
    }
  }

  async function retry() {
    if (!analysis || retrying) return;
    setRetrying(true);
    try {
      // Re-runs THIS row server-side (same id, attempt + 1, same trim
      // window, no allowance charge). Only an analyze-swing build from
      // before Try-again-in-place hands back a different (new) row.
      const retried = await retryCaddieAnalysis(analysis);
      if (retried.id !== analysis.id) navigate(`/caddie/${retried.id}`, { replace: true });
    } catch (err) {
      showToast(caddieErrorText(err, t), "warning");
    } finally {
      setRetrying(false);
    }
  }

  // Re-translates this ONE saved analysis's feedback text into whatever
  // language is currently selected — feedback text is written once, at
  // analysis time, in whatever language was active then, and never
  // retroactively changes just because the app's UI language is switched
  // afterward (see analyze-swing/translate-caddie-analysis comments). This
  // is the explicit, on-demand fix for that on an existing analysis.
  async function translateFeedback() {
    if (!analysis || translating) return;
    setTranslating(true);
    const id = analysis.id;
    try {
      // Same queue as the automatic translation, so they never overlap.
      await queueTranslation(id, () => translateCaddieAnalysis(id, locale));
    } catch (err) {
      showToast(caddieErrorText(err, t, "caddie.error.translateFailed"), "warning");
    } finally {
      setTranslating(false);
    }
  }

  // Private by default (per product brief) — this is the only path that
  // ever puts Caddie content into Community, and only a concise summary,
  // never the full structured breakdown. shared_to_community only flips via
  // this explicit tap, never automatically.
  async function shareFeedback() {
    if (!analysis || !details || sharingFeedbackRef.current || analysis.sharedToCommunity || feedbackPostedIds.has(analysis.id)) return;
    // A ref, not just state: a fast double tap lands before the re-render.
    sharingFeedbackRef.current = true;
    setSharingFeedback(true);
    const analysisId = analysis.id;
    try {
      const lines = [
        t("caddie.feedbackPostTitle"),
        "",
        ...details.strengths.slice(0, 1).map((s) => `✓ ${s}`),
        "",
        `${t("caddie.shareFeedbackWorkOnLabel")} ${details.workOn[0]?.issue ?? ""}`,
        "",
        `${t("caddie.shareFeedbackFocusLabel")} ${details.focus.title}`,
      ];
      // Rejects only if createPost failed (nothing posted, safe to retry).
      // Once the post is out it counts as shared here even if the mark
      // fails; postFeedbackThenMark retries the mark once, then logs.
      await postFeedbackThenMark({
        createPost: async () => {
          await createPost({ type: "text", text: lines.join("\n"), category: "General" });
          setFeedbackPostedIds((prev) => new Set(prev).add(analysisId));
        },
        markShared: () => markCaddieAnalysisShared(analysisId),
      });
      showToast(t("caddie.feedbackShared"), "success");
    } catch (err) {
      showToast(caddieErrorText(err, t, "caddie.error.shareFailed"), "warning");
    } finally {
      sharingFeedbackRef.current = false;
      setSharingFeedback(false);
    }
  }
  const feedbackShared = Boolean(analysis?.sharedToCommunity) || (analysis ? feedbackPostedIds.has(analysis.id) : false);

  const cameraAngleLabel: Record<CaddieCameraAngle, string> = {
    face_on: t("caddie.cameraAngleFaceOn"),
    down_the_line: t("caddie.cameraAngleDownTheLine"),
    other: t("caddie.cameraAngleOther"),
    uncertain: t("caddie.cameraAngleUncertain"),
  };
  const confidenceLabel: Record<CaddieConfidence, string> = {
    high: t("caddie.confidenceHigh"),
    medium: t("caddie.confidenceMedium"),
    low: t("caddie.confidenceLow"),
  };
  const languageName = (value: string) => LOCALES.find((l) => l.value === value)?.nativeName ?? value;
  const offer = translateOffer(details?.language, locale);
  const languageNotice = offer === "notice";
  const translateButton = offer !== "none" && (
    <button
      onClick={translateFeedback}
      disabled={translating}
      className="flex min-h-8 items-center gap-1 text-xs font-semibold text-fairway-700 hover:underline disabled:opacity-60"
    >
      {translating ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
      {translating ? t("caddie.translating") : t("caddie.translateTo", { language: languageName(locale) })}
    </button>
  );

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => navigate("/caddie")}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("caddie.back")}
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900">{clubLabel(analysis.swingType, t) || t("caddie.title")}</h1>
          <p className="text-sm text-slate-500">{formatShortDate(analysis.createdAt, dateLocale)}</p>
          {sourcePost && (
            <button
              onClick={() => navigate(`/community/${sourcePost.id}`)}
              className="mt-1 flex items-center gap-1 text-xs font-semibold text-fairway-700 hover:underline"
            >
              {t("caddie.fromCommunityPost")} <ArrowUpRight size={12} />
            </button>
          )}
        </div>
        {/* Saved swings: complete analyses only (the database enforces it
            too), and only once saved_at exists (or in demo). */}
        {caddieSavedSupported && canSaveAnalysis(analysis) && (
          <button
            type="button"
            onClick={toggleSaved}
            aria-pressed={isSaved}
            aria-label={t("caddie.saved.saveLabel")}
            data-haptic="tap"
            data-testid="caddie-save-toggle"
            className={`mt-0.5 flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-[color,background-color,border-color,transform] duration-200 ease-out active:scale-[0.97] motion-reduce:transition-none ${
              isSaved
                ? "border-fairway-200 bg-fairway-50 text-fairway-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-fairway-300 hover:text-fairway-700"
            }`}
          >
            {isSaved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
            {isSaved ? t("caddie.saved.saved") : t("caddie.saved.save")}
          </button>
        )}
      </div>

      {analysis.sourceMediaUrl && (
        <CaddieSwingReplay
          sourceMediaUrl={analysis.sourceMediaUrl}
          thumbnailUrl={analysis.thumbnailUrl}
          onMediaError={analysis.sourceMediaPath ? () => refreshMediaUrls([analysis.sourceMediaPath, analysis.thumbnailPath]) : undefined}
          poseData={analysis.poseData}
          phases={details?.phases}
          cameraAngle={details?.cameraAngle}
          coachEnabled={coachEnabled && analysis.status === "complete"}
          score={details?.score}
          checkpointCues={details?.checkpointCues}
          coaching={details}
        />
      )}
      {/* Demo accounts have no swing video: Coach Replay plays over the
          animated demo golfer instead, with demo-only cards. */}
      {isDemo && coachEnabled && !analysis.sourceMediaUrl && analysis.id === DEMO_COACH_ANALYSIS_ID && <CoachReplayDemo />}

      {analysis.status === "complete" && details ? (
        <div className="flex flex-col gap-3.5 rounded-2xl border border-fairway-100 bg-fairway-50/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-fairway-700">
              <CaddieNavIcon size={14} /> {t("caddie.title")}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {!languageNotice && translateButton}
              <Badge tone="outline">{cameraAngleLabel[details.cameraAngle]}</Badge>
            </div>
          </div>
          {/* The feedback text keeps the language it was written in while
              the labels follow the app; say so and offer the translation
              (only when the row recorded its language, see caddieLanguage). */}
          {languageNotice && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-fairway-100 bg-white px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs text-slate-600">
                <Languages size={12} className="shrink-0 text-fairway-700" />
                {t("caddie.feedbackLanguageNotice", { language: languageName(details.language!) })}
              </p>
              {translateButton}
            </div>
          )}
          {/* What to practise first: the analysis's own focus and drill,
              exactly as Caddie wrote them (nothing added, no rep counts:
              the pipeline has none). The score and the explanation follow. */}
          {(details.focus.title || details.drill.name) && (
            <div className="rounded-xl border border-fairway-200 bg-white p-3" data-testid="caddie-work-on-next">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-forest">{t("caddie.workOnNext")}</p>
              {details.focus.title && <p className="mt-1 text-base font-bold text-slate-900">{details.focus.title}</p>}
              {details.focus.instruction && <p className="mt-0.5 text-sm text-slate-600">{details.focus.instruction}</p>}
              {details.drill.name && (
                <div className="mt-3 border-t border-slate-100 pt-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t("caddie.drill")}</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-800">{details.drill.name}</p>
                  {details.drill.steps.length > 0 && (
                    <ol className="mt-1.5 flex list-decimal flex-col gap-1 pl-4 text-sm text-slate-600">
                      {details.drill.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          )}
          {details.score && (
            <div>
              <p className="text-3xl font-bold text-brand-forest">{t("caddie.scoreOutOf100", { score: details.score.total })}</p>
              <p className="mb-1.5 mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t("caddie.scoreBreakdown")}</p>
              <div className="flex flex-col gap-2">
                {SCORE_CRITERIA_ORDER.map(([key, labelKey]) => {
                  const c = details.score!.criteria[key];
                  return (
                    <div key={key} className="rounded-xl border border-slate-100 bg-white p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-700">{t(labelKey)}</p>
                        <p className="text-xs font-bold text-brand-forest">{c.points}/20</p>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{c.reason}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <p className="text-sm text-slate-700">{details.summary}</p>
          <Section title={t("caddie.whatLooksGood")} items={details.strengths} />
          {details.workOn.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t("caddie.workOn")}</p>
              <div className="flex flex-col gap-2.5">
                {details.workOn.map((item, i) => (
                  <div key={i} className="rounded-xl border border-slate-100 bg-white p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">{item.issue}</p>
                      <Badge tone={CONFIDENCE_TONE[item.confidence]}>{confidenceLabel[item.confidence]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{item.whyItMatters}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {details.limitations.length > 0 && (
            <div className="flex items-start gap-1.5 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-2.5 text-xs text-slate-500">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <ul className="flex flex-col gap-1">
                {details.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : analysis.status === "complete" ? (
        // Legacy/demo row: no `details` (analysis_json), only the older flat columns.
        <div className="flex flex-col gap-3.5 rounded-2xl border border-fairway-100 bg-fairway-50/40 p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-fairway-700">
            <CaddieNavIcon size={14} /> {t("caddie.title")}
          </p>
          {legacy.analysisSummary && <p className="text-sm text-slate-700">{legacy.analysisSummary}</p>}
          <Section title={t("caddie.whatLooksGood")} items={legacy.strengths} />
          <Section title={t("caddie.workOn")} items={legacy.issues} />
          <Section title={t("caddie.caddiesFix")} items={legacy.recommendations} />
        </div>
      ) : analysis.status === "failed" || isStaleProcessing(analysis) ? (
        <div className="flex flex-col items-start gap-2.5 rounded-2xl border border-red-100 bg-red-50/60 px-4 py-3.5">
          <p className="text-sm font-semibold text-red-700">{t(failureKeys.title)}</p>
          {failure.canRetry ? (
            failureKeys.body && <p className="text-sm text-red-700/90">{t(failureKeys.body)}</p>
          ) : (
            <p className="text-sm text-red-700/90">{t("caddie.error.retryCap")}</p>
          )}
          {/* No whole body seen: the same filming tips as the upload screen. */}
          {failure.kind === "poseNotFound" && (
            <div className="w-full rounded-xl bg-white/70 px-3 py-2.5 text-slate-700">
              <p className="mb-1.5 text-xs font-semibold text-slate-800">{t("caddie.tips.title")}</p>
              <TipList />
            </div>
          )}
          {/* Only a delivered analysis uses an allowance slot (20261107140000). */}
          {!isDemo && <p className="text-xs text-red-700/70">{t("caddie.failure.noCharge")}</p>}
          <div className="flex flex-wrap gap-2">
            {failure.canRetry && (
              <Button variant="outline" size="sm" onClick={retry} disabled={retrying} icon={retrying ? <Loader2 size={14} className="animate-spin" /> : undefined}>
                {t("caddie.tryAgain")}
              </Button>
            )}
            {failure.kind === "poseNotFound" && (
              <Button variant="outline" size="sm" onClick={() => navigate("/caddie/analyze")} icon={<Video size={14} />}>
                {t("caddie.failure.pickAnother")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3.5">
          {/* Real rows: the persisted stage + elapsed, honest long-wait copy and Check again. Demo rows have no job columns. */}
          <CaddieThinking job={isDemo ? undefined : analysis} onCheckAgain={isDemo ? undefined : checkStatus} />
          <p className="pl-16 text-xs text-slate-500">{t("swingAnalysis.processingDescription")}</p>
        </div>
      )}

      {analysis.status === "complete" && details && (
        <Button
          variant="outline"
          icon={feedbackShared ? <Check size={15} /> : sharingFeedback ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />}
          onClick={shareFeedback}
          disabled={sharingFeedback || feedbackShared}
        >
          {feedbackShared ? t("caddie.feedbackShared") : t("caddie.shareFeedback")}
        </Button>
      )}

      {analysis.sourceType === "direct_upload" && (
        <Button variant="outline" icon={<Share2 size={15} />} onClick={shareToCommunity}>
          {t("caddie.shareToCommunity")}
        </Button>
      )}

      {/* Failed, complete or dead analyses only: a live job is still running server-side. */}
      {(analysis.status !== "processing" || isStaleProcessing(analysis)) && (
        <button
          onClick={() => setDeleteOpen(true)}
          className="flex min-h-11 items-center justify-center gap-1.5 self-center px-3 text-sm font-semibold text-red-600 transition-colors duration-150 hover:text-red-700"
        >
          <Trash2 size={15} /> {t("caddie.delete.action")}
        </button>
      )}
      {deleteOpen && (
        <DeleteAnalysisDialog analysis={analysis} onClose={() => setDeleteOpen(false)} onDeleted={() => navigate("/caddie", { replace: true })} />
      )}
    </div>
  );
}

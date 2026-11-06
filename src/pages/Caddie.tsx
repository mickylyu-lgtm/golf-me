import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Globe, Sparkles, Trash2, Video } from "lucide-react";
import { DeleteAnalysisDialog } from "../components/caddie/DeleteAnalysisDialog";
import type { CaddieAnalysis } from "../types";
import { useData } from "../context/DataContext";
import { useRealCaddie } from "../context/RealCaddieContext";
import { useLocale, LOCALES } from "../i18n/LocaleContext";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { CLICKABLE_CARD_CLASS } from "../components/ui/cardStyles";
import { formatShortDate } from "../lib/format";
import { isStaleProcessing, usePeriodicRerender } from "../lib/caddieAnalysis";
import { FAILURE_KIND_KEYS, analysisFailure } from "../lib/caddieFailure";
import { clubLabel } from "../lib/clubLabel";
import { useAuth } from "../context/AuthContext";
import { claimAutoTranslateAttempt, feedbackSampleText, isTooSoonError, needsAutoTranslate, releaseAutoTranslateAttempt } from "../lib/caddieLanguage";
import { PICKER_TRANSLATE_COUNT, PICKER_TRANSLATE_DELAY_MS, markExplicitCaddieLocale, queueAutoTranslation } from "../lib/caddieAutoTranslate";
import { setCaddieFeedbackLanguage } from "../lib/caddieFeedbackLanguage";
import { useCaddieFeedbackLanguage } from "../lib/useCaddieFeedbackLanguage";

// Caddie's own destination — kept deliberately uncrowded (per brief: the
// most obvious action is always "Analyze a Swing"). Reuses the same
// CaddieAnalysis data DataContext already branches demo/real on; this page
// never talks to Supabase or the mock data directly.
//
// History used to hard-cap at the 5 newest analyses with no way to see
// anything older — not deleted, just permanently unreachable once you had
// a 6th. The underlying data was always fetched in full (no query-level
// limit); only this page's own render was capped. Fixed 2026-09-19: shows
// everything, newest first, with lazy "show more" paging instead of a
// second full page/route — the data's already all in memory, so this is
// a pure render change.
const PAGE_SIZE = 10;

// How far the history list is expanded survives opening an analysis and
// coming back (this page unmounts in between). Cleared by
// CaddieHistoryReset in App.tsx as soon as the user leaves /caddie*, so a
// fresh visit to Caddie starts collapsed again.
const HISTORY_COUNT_KEY = "golfme:caddieHistoryCount";

function loadHistoryCount(): number {
  try {
    const n = Number(window.sessionStorage.getItem(HISTORY_COUNT_KEY));
    return Number.isFinite(n) && n > PAGE_SIZE ? n : PAGE_SIZE;
  } catch {
    return PAGE_SIZE;
  }
}

function saveHistoryCount(n: number): void {
  try {
    window.sessionStorage.setItem(HISTORY_COUNT_KEY, String(n));
  } catch {
    // Storage unavailable: the list just starts collapsed next time.
  }
}

export function Caddie() {
  const { caddieAnalyses, translateCaddieAnalysis } = useData();
  const { isDemo } = useAuth();
  const { refreshMediaUrls } = useRealCaddie();
  const { t, locale } = useLocale();
  // Caddie's own feedback language, not the app's (lib/caddieFeedbackLanguage).
  const feedbackLanguage = useCaddieFeedbackLanguage();
  const navigate = useNavigate();
  const [visibleCount, setVisibleCount] = useState(loadHistoryCount);
  // The analysis whose delete confirm sheet is open.
  const [deleting, setDeleting] = useState<CaddieAnalysis | null>(null);

  const sorted = useMemo(() => [...caddieAnalyses].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [caddieAnalyses]);
  const visible = sorted.slice(0, visibleCount);
  const hasMore = sorted.length > visible.length;
  usePeriodicRerender(visible.some((a) => a.status === "processing"));

  // Picking a language here translates the newest analyses' feedback into
  // it in the background (Micky, 2026-11-04: the picker should "send a
  // stronger signal"), so it's usually ready before an analysis is opened.
  // Waits until the picker has rested for a moment, so flicking through
  // languages translates into the last one only; each analysis goes through
  // the shared one-at-a-time queue. Real accounts only (demo has no
  // translation backend); a failure just leaves the analysis page to try.
  const [pickedLocale, setPickedLocale] = useState<string | null>(null);
  const analysesRef = useRef(sorted);
  // The feedback language right now, for queued jobs deciding whether they're stale.
  const localeRef = useRef(feedbackLanguage);
  localeRef.current = feedbackLanguage;
  analysesRef.current = sorted;
  useEffect(() => {
    if (isDemo || pickedLocale === null) return;
    const target = pickedLocale;
    const timer = window.setTimeout(() => {
      const candidates = analysesRef.current
        .filter((a) => a.status === "complete" && a.details)
        .slice(0, PICKER_TRANSLATE_COUNT)
        .filter((a) => needsAutoTranslate({ language: a.details!.language, sampleText: feedbackSampleText(a.details) }, target, true));
      for (const a of candidates) {
        if (!claimAutoTranslateAttempt(a.id, target)) continue;
        // Skipped if another language was picked before its turn; the
        // attempt is always given back, so switching back to a language
        // translates again and opening the analysis can still try.
        queueAutoTranslation(a.id, target, () => localeRef.current, translateCaddieAnalysis)
          .catch((err) => {
            if (!isTooSoonError(err)) console.error("GolfMe: background feedback translation failed.", err);
          })
          .finally(() => releaseAutoTranslateAttempt(a.id, target));
      }
    }, PICKER_TRANSLATE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isDemo, pickedLocale, translateCaddieAnalysis]);

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("caddie.title")}</h1>
          <p className="text-sm text-slate-500">{t("caddie.tagline")}</p>
        </div>
        {/* Caddie feedback language, right here — new analyses use whatever
            this is set to at the moment "Ask Caddie" is tapped. Only Caddie's
            feedback: the app's language stays in Settings > Language. A plain native
            <select> rather than a custom dropdown: full accessibility/mobile
            picker behavior for free, no positioning logic to get wrong. */}
        {/* Focus indicator is a real border-color change, not a box-shadow
            ring -- a ring (even ring-only, no offset) visibly failed to
            trace this element's own tight rounded-full radius correctly
            on a real device (reported live, screenshot showed the ring
            broken/cut off around the curved ends rather than a full
            unbroken loop), a known class of WebKit box-shadow/border-
            radius compositing issue on small stadium shapes. A border
            always follows the element's own border-radius exactly, with
            no separate compositing layer to go wrong. border-2 (not the
            default 1px) is used in BOTH states so the color-only change
            on focus never shifts layout by growing the box. */}
        <label className="flex shrink-0 items-center gap-1 rounded-full border-2 border-slate-200 py-1.5 pl-2.5 pr-1.5 text-xs font-semibold text-slate-600 focus-within:border-fairway-400">
          <Globe size={13} className="text-slate-400" />
          <span aria-hidden className="text-slate-400">
            {t("caddie.feedbackLanguageShort")}
          </span>
          <select
            value={feedbackLanguage}
            onChange={(e) => {
              const next = e.target.value as (typeof LOCALES)[number]["value"];
              // An explicit "my Caddie feedback in this language": see the
              // pre-translation effect above and lib/caddieAutoTranslate.
              markExplicitCaddieLocale(next);
              setPickedLocale(next);
              setCaddieFeedbackLanguage(next);
            }}
            aria-label={t("caddie.feedbackLanguageLabel")}
            title={t("caddie.feedbackLanguageLabel")}
            className="appearance-none bg-transparent pr-1 text-xs font-semibold text-slate-700 !outline-none"
          >
            {LOCALES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.nativeName}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Button size="lg" fullWidth icon={<Sparkles size={16} />} onClick={() => navigate("/caddie/analyze")}>
        {t("caddie.analyzeSwing")}
      </Button>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">{t("caddie.recent")}</h2>
        {visible.length === 0 ? (
          <EmptyState icon={<Video size={20} />} title={t("caddie.emptyTitle")} description={t("caddie.emptyDescription")} />
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((a) => {
              const issueCount = a.details?.workOn.length ?? a.issues.length;
              // A live job can't be deleted (its worker is still running);
              // failed, complete and dead ones can.
              const deletable = a.status !== "processing" || isStaleProcessing(a);
              return (
                <div key={a.id} className={`flex w-full items-center ${CLICKABLE_CARD_CLASS}`}>
                <button
                  onClick={() => navigate(`/caddie/${a.id}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left"
                >
                  {/* Only when a real captured frame already exists (see
                      CaddieAnalysis.thumbnailUrl) — never generated here,
                      per explicit instruction not to add processing just
                      for this. Older/incomplete analyses simply fall back
                      to the text-only layout below. */}
                  {a.thumbnailUrl && (
                    <img
                      src={a.thumbnailUrl}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-xl object-cover"
                      // A private thumbnail whose 1-hour signed link lapsed: re-sign it.
                      onError={a.thumbnailPath ? () => refreshMediaUrls([a.thumbnailPath]) : undefined}
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-900">{clubLabel(a.swingType, t) || t("caddie.title")}</span>
                    <span className="block text-xs text-slate-500">{formatShortDate(a.createdAt, locale)}</span>
                  </span>
                  {a.status === "complete" ? (
                    a.score !== undefined ? (
                      <span className="shrink-0 text-sm font-bold text-brand-forest">{t("caddie.scoreOutOf100", { score: a.score })}</span>
                    ) : (
                      <span className="shrink-0 text-xs font-semibold text-slate-500">{issueCount === 1 ? t("caddie.thingsToWorkOnSingular") : t("caddie.thingsToWorkOn", { count: issueCount })}</span>
                    )
                  ) : a.status === "failed" || isStaleProcessing(a) ? (
                    <span className="shrink-0 text-xs font-semibold text-red-500">
                      {t(FAILURE_KIND_KEYS[analysisFailure(a.errorMessage, isStaleProcessing(a), a.failureCategory, a.attempt).kind].short)}
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-400">
                      <Clock size={12} /> {t("caddie.analyzing")}
                    </span>
                  )}
                </button>
                {deletable && (
                  <button
                    onClick={() => setDeleting(a)}
                    aria-label={t("caddie.delete.action")}
                    className="-ml-2 mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors duration-150 hover:text-red-600"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                </div>
              );
            })}
            {hasMore && (
              <button
                onClick={() =>
                  setVisibleCount((c) => {
                    const next = c + PAGE_SIZE;
                    saveHistoryCount(next);
                    return next;
                  })
                }
                className="rounded-2xl border border-dashed border-slate-200 py-2.5 text-sm font-semibold text-slate-500 transition-colors duration-150 hover:border-fairway-300 hover:text-fairway-700"
              >
                {t("common.viewMore")}
              </button>
            )}
          </div>
        )}
      </section>
      {deleting && <DeleteAnalysisDialog analysis={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

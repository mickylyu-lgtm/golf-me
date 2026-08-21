import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, ArrowUpRight, Check, Loader2, Share2 } from "lucide-react";
import { CaddieNavIcon } from "../components/icons/CaddieNavIcon";
import { CaddieThinking } from "../components/caddie/CaddieThinking";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { formatShortDate } from "../lib/format";
import type { CaddieConfidence, CaddieCameraAngle } from "../types";
import type { CreatePostSwingPrefill } from "./CreatePost";

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
  const { getCaddieAnalysis, getPost, createCaddieAnalysis, markCaddieAnalysisShared, createPost } = useData();
  const { t, locale } = useLocale();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);
  const [sharingFeedback, setSharingFeedback] = useState(false);

  const analysis = analysisId ? getCaddieAnalysis(analysisId) : undefined;
  if (!analysis) return <Navigate to="/caddie" replace />;

  const sourcePost = analysis.sourcePostId ? getPost(analysis.sourcePostId) : undefined;
  const details = analysis.details;

  function shareToCommunity() {
    if (!analysis) return;
    const prefill: CreatePostSwingPrefill = {
      swingVideoUrl: analysis.sourceMediaUrl,
      videoThumbnailUrl: analysis.thumbnailUrl,
      caption: analysis.swingType ? `${analysis.swingType} swing` : "",
    };
    navigate("/community/new", { state: prefill });
  }

  async function retry() {
    if (!analysis || retrying) return;
    setRetrying(true);
    try {
      const created = await createCaddieAnalysis({
        sourceType: analysis.sourceType,
        sourcePostId: analysis.sourcePostId,
        sourceMediaUrl: analysis.sourceMediaUrl,
        thumbnailUrl: analysis.thumbnailUrl,
        swingType: analysis.swingType,
      });
      navigate(`/caddie/${created.id}`, { replace: true });
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("caddie.askCaddieError"), "warning");
    } finally {
      setRetrying(false);
    }
  }

  // Private by default (per product brief) — this is the only path that
  // ever puts Caddie content into Community, and only a concise summary,
  // never the full structured breakdown. shared_to_community only flips via
  // this explicit tap, never automatically.
  async function shareFeedback() {
    if (!analysis || !details || sharingFeedback) return;
    setSharingFeedback(true);
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
      await createPost({ type: "text", text: lines.join("\n"), category: "General" });
      await markCaddieAnalysisShared(analysis.id);
      showToast(t("caddie.feedbackShared"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("caddie.couldNotSave"), "warning");
    } finally {
      setSharingFeedback(false);
    }
  }

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

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => navigate("/caddie")}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("caddie.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{analysis.swingType || t("caddie.title")}</h1>
        <p className="text-sm text-slate-500">{formatShortDate(analysis.createdAt, locale)}</p>
        {sourcePost && (
          <button
            onClick={() => navigate(`/community/${sourcePost.id}`)}
            className="mt-1 flex items-center gap-1 text-xs font-semibold text-fairway-700 hover:underline"
          >
            {t("caddie.fromCommunityPost")} <ArrowUpRight size={12} />
          </button>
        )}
      </div>

      {analysis.sourceMediaUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={analysis.sourceMediaUrl} poster={analysis.thumbnailUrl} preload="metadata" controls className="max-h-80 w-full rounded-2xl bg-black" />
      )}

      {analysis.status === "complete" && details ? (
        <div className="flex flex-col gap-3.5 rounded-2xl border border-fairway-100 bg-fairway-50/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-fairway-700">
              <CaddieNavIcon size={14} /> {t("caddie.title")}
            </p>
            <Badge tone="outline">{cameraAngleLabel[details.cameraAngle]}</Badge>
          </div>
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
          <div className="rounded-xl border border-fairway-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fairway-700">{t("caddie.focus")}</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{details.focus.title}</p>
            <p className="mt-0.5 text-sm text-slate-600">{details.focus.instruction}</p>
          </div>
          {details.drill.name && (
            <div className="rounded-xl border border-slate-100 bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t("caddie.drill")}</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{details.drill.name}</p>
              {details.drill.steps.length > 0 && (
                <ol className="mt-1.5 flex list-decimal flex-col gap-1 pl-4 text-sm text-slate-600">
                  {details.drill.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}
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
          {analysis.analysisSummary && <p className="text-sm text-slate-700">{analysis.analysisSummary}</p>}
          <Section title={t("caddie.whatLooksGood")} items={analysis.strengths} />
          <Section title={t("caddie.workOn")} items={analysis.issues} />
          <Section title={t("caddie.caddiesFix")} items={analysis.recommendations} />
        </div>
      ) : analysis.status === "failed" ? (
        <div className="flex flex-col items-start gap-2.5 rounded-2xl border border-red-100 bg-red-50/60 px-4 py-3.5">
          <p className="text-sm font-semibold text-red-700">{t("caddie.askCaddieError")}</p>
          <Button variant="outline" size="sm" onClick={retry} disabled={retrying} icon={retrying ? <Loader2 size={14} className="animate-spin" /> : undefined}>
            {t("caddie.tryAgain")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3.5">
          <CaddieThinking />
          <p className="pl-12 text-xs text-slate-500">{t("swingAnalysis.processingDescription")}</p>
        </div>
      )}

      {analysis.status === "complete" && details && (
        <Button
          variant="outline"
          icon={
            analysis.sharedToCommunity ? <Check size={15} /> : sharingFeedback ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />
          }
          onClick={shareFeedback}
          disabled={sharingFeedback || analysis.sharedToCommunity}
        >
          {analysis.sharedToCommunity ? t("caddie.feedbackShared") : t("caddie.shareFeedback")}
        </Button>
      )}

      {analysis.sourceType === "direct_upload" && (
        <Button variant="outline" icon={<Share2 size={15} />} onClick={shareToCommunity}>
          {t("caddie.shareToCommunity")}
        </Button>
      )}
    </div>
  );
}

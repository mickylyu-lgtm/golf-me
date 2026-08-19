import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Loader2, Share2, Sparkles } from "lucide-react";
import { useData } from "../context/DataContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { formatShortDate } from "../lib/format";
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

// Caddie's own result view — deliberately a different (simpler) shape than
// SwingAnalysisPanel's Community-post version: no position-by-position
// breakdown, just strengths/issues/recommendations/drills, matching the
// brief's own worked example. Reused for both direct-upload and
// Community-sourced analyses; the only difference is the "From Community
// Post" breadcrumb.
export function CaddieAnalysisDetail() {
  const { analysisId } = useParams<{ analysisId: string }>();
  const { getCaddieAnalysis, getPost } = useData();
  const { t, locale } = useLocale();
  const navigate = useNavigate();

  const analysis = analysisId ? getCaddieAnalysis(analysisId) : undefined;
  if (!analysis) return <Navigate to="/caddie" replace />;

  const sourcePost = analysis.sourcePostId ? getPost(analysis.sourcePostId) : undefined;

  function shareToCommunity() {
    if (!analysis) return;
    const prefill: CreatePostSwingPrefill = {
      swingVideoUrl: analysis.sourceMediaUrl,
      videoThumbnailUrl: analysis.thumbnailUrl,
      caption: analysis.swingType ? `${analysis.swingType} swing` : "",
    };
    navigate("/community/new", { state: prefill });
  }

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

      {analysis.status === "complete" ? (
        <div className="flex flex-col gap-3.5 rounded-2xl border border-fairway-100 bg-fairway-50/40 p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-fairway-700">
            <Sparkles size={13} /> {t("caddie.title")}
          </p>
          {analysis.analysisSummary && <p className="text-sm text-slate-700">{analysis.analysisSummary}</p>}
          <Section title={t("caddie.whatLooksGood")} items={analysis.strengths} />
          <Section title={t("caddie.workOn")} items={analysis.issues} />
          <Section title={t("caddie.caddiesFix")} items={analysis.recommendations} />
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3.5">
          <Loader2 size={16} className="shrink-0 animate-spin text-fairway-600" />
          <div>
            <p className="text-sm font-semibold text-slate-700">{t("swingAnalysis.processingTitle")}</p>
            <p className="text-xs text-slate-500">{t("swingAnalysis.processingDescription")}</p>
          </div>
        </div>
      )}

      {analysis.sourceType === "direct_upload" && (
        <Button variant="outline" icon={<Share2 size={15} />} onClick={shareToCommunity}>
          {t("caddie.shareToCommunity")}
        </Button>
      )}
    </div>
  );
}

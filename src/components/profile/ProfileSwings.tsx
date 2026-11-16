import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Clock, ScanLine, Video } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useRealCaddie } from "../../context/RealCaddieContext";
import { useLocale } from "../../i18n/LocaleContext";
import { EmptyState } from "../ui/EmptyState";
import { Button } from "../ui/Button";
import { CLICKABLE_CARD_CLASS } from "../ui/cardStyles";
import { formatShortDate } from "../../lib/format";
import { clubLabel } from "../../lib/clubLabel";
import { isStaleProcessing } from "../../lib/caddieAnalysis";

// The newest few here; Caddie has the full history and its actions.
const SWINGS_SHOWN = 10;

// Me > Swings: your own Caddie analyses (private to you, as in Caddie).
// Read-only: opening one goes to its Caddie page; uploading, deleting and
// the analysis jobs themselves stay entirely in Caddie.
export function ProfileSwings() {
  const { caddieAnalyses } = useData();
  const { refreshMediaUrls } = useRealCaddie();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  // Failed attempts stay in Caddie (with their retry help), not on the profile.
  const sorted = useMemo(
    () => caddieAnalyses.filter((a) => a.status !== "failed" && !isStaleProcessing(a)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [caddieAnalyses],
  );
  const shown = sorted.slice(0, SWINGS_SHOWN);

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={<Video size={20} />}
        title={t("caddie.emptyTitle")}
        description={t("caddie.emptyDescription")}
        action={
          <Button size="sm" icon={<ScanLine size={14} />} onClick={() => navigate("/caddie/analyze")}>
            {t("caddie.analyzeSwing")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
        {shown.map((a) => {
          const issueCount = a.details?.workOn.length ?? a.issues.length;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => navigate(`/caddie/${a.id}`)}
              className={`flex w-full items-center gap-3 p-4 text-left ${CLICKABLE_CARD_CLASS}`}
            >
              {a.thumbnailUrl ? (
                <img
                  src={a.thumbnailUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-xl object-cover"
                  // A private thumbnail whose signed link lapsed: re-sign it.
                  onError={a.thumbnailPath ? () => refreshMediaUrls([a.thumbnailPath]) : undefined}
                />
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-fairway-50 text-fairway-700">
                  <Video size={18} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-slate-900">{clubLabel(a.swingType, t) || t("caddie.title")}</span>
                <span className="block text-xs text-slate-500">{formatShortDate(a.createdAt, locale)}</span>
              </span>
              {a.status === "complete" ? (
                a.score !== undefined ? (
                  <span className="shrink-0 text-sm font-bold text-brand-forest">{t("caddie.scoreOutOf100", { score: a.score })}</span>
                ) : (
                  <span className="shrink-0 text-xs font-semibold text-slate-500">
                    {issueCount === 1 ? t("caddie.thingsToWorkOnSingular") : t("caddie.thingsToWorkOn", { count: issueCount })}
                  </span>
                )
              ) : (
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-400">
                  <Clock size={12} /> {t("caddie.analyzing")}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => navigate("/caddie")}
        className="flex min-h-11 items-center justify-center gap-1.5 self-center rounded-full px-4 text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:bg-fairway-50 hover:text-fairway-800"
      >
        {t("caddie.continueInCaddie")} <ArrowRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

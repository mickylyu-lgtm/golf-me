import { useNavigate } from "react-router-dom";
import { Clock, Globe, Sparkles, Video } from "lucide-react";
import { useData } from "../context/DataContext";
import { useLocale, LOCALES } from "../i18n/LocaleContext";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { CLICKABLE_CARD_CLASS } from "../components/ui/cardStyles";
import { formatShortDate } from "../lib/format";

// Caddie's own destination — kept deliberately uncrowded (per brief: the
// most obvious action is always "Analyze a Swing"). Reuses the same
// CaddieAnalysis data DataContext already branches demo/real on; this page
// never talks to Supabase or the mock data directly.
export function Caddie() {
  const { caddieAnalyses } = useData();
  const { t, locale, setLocale } = useLocale();
  const navigate = useNavigate();

  const recent = [...caddieAnalyses].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("caddie.title")}</h1>
          <p className="text-sm text-slate-500">{t("caddie.tagline")}</p>
        </div>
        {/* Feedback language, right here — new analyses use whatever this is
            set to at the moment "Ask Caddie" is tapped. A plain native
            <select> rather than a custom dropdown: full accessibility/mobile
            picker behavior for free, no positioning logic to get wrong. */}
        <label className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 py-1.5 pl-2.5 pr-1.5 text-xs font-semibold text-slate-600">
          <Globe size={13} className="text-slate-400" />
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as (typeof LOCALES)[number]["value"])}
            aria-label={t("language.title")}
            className="appearance-none bg-transparent pr-1 text-xs font-semibold text-slate-700 outline-none"
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
        {recent.length === 0 ? (
          <EmptyState icon={<Video size={20} />} title={t("caddie.emptyTitle")} description={t("caddie.emptyDescription")} />
        ) : (
          <div className="flex flex-col gap-3">
            {recent.map((a) => {
              const issueCount = a.details?.workOn.length ?? a.issues.length;
              return (
                <button
                  key={a.id}
                  onClick={() => navigate(`/caddie/${a.id}`)}
                  className={`flex w-full items-center justify-between gap-3 p-4 text-left ${CLICKABLE_CARD_CLASS}`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-slate-900">{a.swingType || t("caddie.title")}</span>
                    <span className="block text-xs text-slate-500">{formatShortDate(a.createdAt, locale)}</span>
                  </span>
                  {a.status === "complete" ? (
                    a.score !== undefined ? (
                      <span className="shrink-0 text-sm font-bold text-fairway-700">{t("caddie.scoreOutOf100", { score: a.score })}</span>
                    ) : (
                      <span className="shrink-0 text-xs font-semibold text-slate-500">{t("caddie.thingsToWorkOn", { count: issueCount })}</span>
                    )
                  ) : a.status === "failed" ? (
                    <span className="shrink-0 text-xs font-semibold text-red-500">{t("caddie.askCaddieError")}</span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-400">
                      <Clock size={12} /> {t("caddie.analyzing")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

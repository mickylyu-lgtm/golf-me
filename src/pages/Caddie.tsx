import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Globe, Sparkles, Video } from "lucide-react";
import { useData } from "../context/DataContext";
import { useLocale, LOCALES } from "../i18n/LocaleContext";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { CLICKABLE_CARD_CLASS } from "../components/ui/cardStyles";
import { formatShortDate } from "../lib/format";
import { isStaleProcessing, usePeriodicRerender } from "../lib/caddieAnalysis";

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

export function Caddie() {
  const { caddieAnalyses } = useData();
  const { t, locale, setLocale } = useLocale();
  const navigate = useNavigate();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const sorted = useMemo(() => [...caddieAnalyses].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [caddieAnalyses]);
  const visible = sorted.slice(0, visibleCount);
  const hasMore = sorted.length > visible.length;
  usePeriodicRerender(visible.some((a) => a.status === "processing"));

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
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as (typeof LOCALES)[number]["value"])}
            aria-label={t("language.title")}
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
              return (
                <button
                  key={a.id}
                  onClick={() => navigate(`/caddie/${a.id}`)}
                  className={`flex w-full items-center gap-3 p-4 text-left ${CLICKABLE_CARD_CLASS}`}
                >
                  {/* Only when a real captured frame already exists (see
                      CaddieAnalysis.thumbnailUrl) — never generated here,
                      per explicit instruction not to add processing just
                      for this. Older/incomplete analyses simply fall back
                      to the text-only layout below. */}
                  {a.thumbnailUrl && (
                    <img src={a.thumbnailUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-900">{a.swingType || t("caddie.title")}</span>
                    <span className="block text-xs text-slate-500">{formatShortDate(a.createdAt, locale)}</span>
                  </span>
                  {a.status === "complete" ? (
                    a.score !== undefined ? (
                      <span className="shrink-0 text-sm font-bold text-brand-forest">{t("caddie.scoreOutOf100", { score: a.score })}</span>
                    ) : (
                      <span className="shrink-0 text-xs font-semibold text-slate-500">{t("caddie.thingsToWorkOn", { count: issueCount })}</span>
                    )
                  ) : a.status === "failed" || isStaleProcessing(a) ? (
                    <span className="shrink-0 text-xs font-semibold text-red-500">{t("caddie.askCaddieError")}</span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-400">
                      <Clock size={12} /> {t("caddie.analyzing")}
                    </span>
                  )}
                </button>
              );
            })}
            {hasMore && (
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="rounded-2xl border border-dashed border-slate-200 py-2.5 text-sm font-semibold text-slate-500 transition-colors duration-150 hover:border-fairway-300 hover:text-fairway-700"
              >
                {t("common.viewMore")}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

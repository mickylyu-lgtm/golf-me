import { useMemo, useState } from "react";
import { Bookmark } from "lucide-react";
import type { CaddieAnalysis } from "../../types";
import { useLocale } from "../../i18n/LocaleContext";
import { useRealCaddie } from "../../context/RealCaddieContext";
import { clubLabel } from "../../lib/clubLabel";
import { formatShortDate } from "../../lib/format";
import { SAVED_FILTER_KEYS, filterSaved, savedAnalyses, savedCategoryOf, savedCounts, visibleSavedFilters } from "../../lib/caddieSaved";
import type { SavedFilter } from "../../lib/caddieSaved";
import { CLUB_ART, ClubArtDefs } from "./clubSketches";

// Caddie's "Saved swings" shelf (migration 20261107210000; Micky,
// 2026-11-06: "save their fav swings, compiled by big categories like
// driver or iron or woods, so they can go back and find it"). Above the
// history list on /caddie, which stays exactly as it was. Category chips
// use the club picker's cards (lib/clubCatalog) plus All and Other (no
// club, "Not sure", or a typed name that isn't a club); a chip only shows
// when something is in it. One compact, horizontally scrolling row of
// cards; tapping one opens the analysis.
export function SavedSwings({ analyses, onOpen }: { analyses: readonly CaddieAnalysis[]; onOpen: (id: string) => void }) {
  const { t, locale } = useLocale();
  const { refreshMediaUrls } = useRealCaddie();
  const [picked, setPicked] = useState<SavedFilter>("all");

  const saved = useMemo(() => savedAnalyses(analyses), [analyses]);
  const counts = useMemo(() => savedCounts(saved), [saved]);
  const filters = visibleSavedFilters(counts);
  // The last swing of a category was just un-saved: back to All.
  const filter: SavedFilter = counts[picked] > 0 ? picked : "all";
  const shown = filterSaved(saved, filter);
  const needsArt = shown.some((a) => !a.thumbnailUrl);

  return (
    <section data-testid="caddie-saved-swings" aria-labelledby="caddie-saved-title">
      <h2 id="caddie-saved-title" className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">
        {t("caddie.saved.title")}
      </h2>
      {saved.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-200 px-4 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Bookmark size={16} />
          </span>
          <p className="text-sm text-slate-500">{t("caddie.saved.empty")}</p>
        </div>
      ) : (
        <>
          {filters.length > 1 && (
            <div
              role="radiogroup"
              aria-label={t("caddie.saved.filterLabel")}
              className="-mx-1 mb-2.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {filters.map((f) => {
                const on = f === filter;
                return (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-saved-filter={f}
                    onClick={() => setPicked(f)}
                    className={`flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      on ? "border-transparent bg-fairway-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-fairway-300"
                    }`}
                  >
                    {t(SAVED_FILTER_KEYS[f])}
                    <span className={`tabular-nums ${on ? "text-white/75" : "text-slate-400"}`}>{counts[f]}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div
            className="[--club-rim:0.55] [--club-shadow:rgba(15,23,42,0.42)] dark:[--club-rim:0.9] dark:[--club-shadow:rgba(0,0,0,0.85)]"
          >
            {needsArt && <ClubArtDefs />}
            <ul className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1.5 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {shown.map((a) => {
                const category = savedCategoryOf(a.swingType);
                const Art = category === "other" ? null : CLUB_ART[category];
                const label = clubLabel(a.swingType, t) || t("caddie.title");
                return (
                  <li key={a.id} className="w-[136px] shrink-0 snap-start">
                    <button
                      type="button"
                      onClick={() => onOpen(a.id)}
                      data-saved-item={a.id}
                      className="group flex w-full flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white text-left shadow-sm shadow-slate-900/[0.03] transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md hover:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                    >
                      <span className="relative block h-[92px] w-full overflow-hidden bg-gradient-to-b from-slate-50 to-slate-100">
                        {a.thumbnailUrl ? (
                          <img
                            src={a.thumbnailUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            // A private thumbnail whose signed link lapsed: re-sign it.
                            onError={a.thumbnailPath ? () => refreshMediaUrls([a.thumbnailPath]) : undefined}
                          />
                        ) : Art ? (
                          <span className="flex h-full w-full items-center justify-center pt-1">
                            <Art width={92} />
                          </span>
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-slate-300">
                            <Bookmark size={22} />
                          </span>
                        )}
                      </span>
                      <span className="block px-2.5 pb-2.5 pt-2">
                        <span className="block truncate text-sm font-bold text-slate-900">{label}</span>
                        <span className="flex items-baseline justify-between gap-1.5 text-xs">
                          <span className="truncate text-slate-500">{formatShortDate(a.createdAt, locale)}</span>
                          {a.score !== undefined && (
                            <span className="shrink-0 font-bold tabular-nums text-brand-forest">{t("caddie.scoreOutOf100", { score: a.score })}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

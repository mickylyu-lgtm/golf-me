import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Flag, Search, Share2, SlidersHorizontal, Sparkles } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../i18n/LocaleContext";
import { GolferCard } from "../components/golfer/GolferCard";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { LoadErrorState } from "../components/ui/LoadStates";
import { GolfMeLoader } from "../components/loading/GolfMeLoader";
import { useRealSocial } from "../context/RealSocialContext";
import { findTabPath } from "../lib/findTab";
import { useShareActions } from "../lib/useShareActions";
import { computeCompatibility, golferDistanceMiles } from "../lib/compatibility";
import { GOLF_VIBES } from "../types";
import type { GolfVibe } from "../types";
import { vibeLabel } from "../lib/enumLabels";
import { useCredibilityForGolfers } from "../lib/useCredibility";
import { useSessionState } from "../lib/useSessionState";
import {
  DISCOVER_FILTERS_OPEN_KEY,
  DISCOVER_SORT_KEY,
  DISCOVER_VIBES_KEY,
  isOpenFlag,
  isSortMode,
  parseVibes,
  serializeVibes,
  toggleVibe as toggledVibes,
} from "../lib/discoverFilters";
import type { SortMode } from "../lib/discoverFilters";

interface DiscoverProps {
  embedded?: boolean;
}

export function Discover({ embedded = false }: DiscoverProps) {
  const { currentUser, visibleGolfers } = useData();
  const { isDemo } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const { shareApp } = useShareActions();
  const social = useRealSocial();
  // Session-persisted (see discoverFilters.ts): Back from a golfer and a
  // Rounds/Golfers switch both unmount this page, which used to reset all three.
  const [storedVibes, setStoredVibes] = useSessionState<string>(DISCOVER_VIBES_KEY, "");
  const activeVibes = useMemo(() => parseVibes(storedVibes), [storedVibes]);
  const [sortMode, setSortMode] = useSessionState<SortMode>(DISCOVER_SORT_KEY, "compatibility", isSortMode);
  const [filtersOpen, setFiltersOpen] = useSessionState<"1" | "0">(DISCOVER_FILTERS_OPEN_KEY, "0", isOpenFlag);
  const showFilters = filtersOpen === "1";
  const setShowFilters = (update: (open: boolean) => boolean) => setFiltersOpen((v) => (update(v === "1") ? "1" : "0"));

  function toggleVibe(v: GolfVibe) {
    setStoredVibes((prev) => serializeVibes(toggledVibes(parseVibes(prev), v)));
  }

  const rawCandidates = visibleGolfers();
  // Real accounts: server stats for the reputation sort, not the
  // never-updated profile counters (demo: fixture numbers).
  const reputations = useCredibilityForGolfers(rawCandidates);

  const results = useMemo(() => {
    let list = rawCandidates.map((g) => ({ golfer: g, compat: computeCompatibility(currentUser, g) }));
    if (activeVibes.length > 0) {
      list = list.filter(({ golfer }) => golfer.vibes.some((v) => activeVibes.includes(v)));
    }
    switch (sortMode) {
      case "distance":
        // Unknown distance sorts last.
        list.sort(
          (a, b) =>
            (golferDistanceMiles(currentUser, a.golfer) ?? Number.POSITIVE_INFINITY) -
            (golferDistanceMiles(currentUser, b.golfer) ?? Number.POSITIVE_INFINITY),
        );
        break;
      case "reputation":
        list.sort((a, b) => reputations[b.golfer.id].wouldPlayAgainPct - reputations[a.golfer.id].wouldPlayAgainPct);
        break;
      default:
        list.sort((a, b) => b.compat.overall - a.compat.overall);
    }
    return list;
  }, [rawCandidates, reputations, currentUser, activeVibes, sortMode]);

  return (
    <div className="flex flex-col gap-5">
      {!embedded && (
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("discover.title")}</h1>
          <p className="text-sm text-slate-500">{t("discover.subtitle")}</p>
        </div>
      )}

      {/* A fast entry point into FindFriends' own dedicated golfer-search
          screen (search_golfer_profiles(), by name/username) — not a second
          search implementation. This used to be a real inline <input> that
          called the same search RPC and rendered its own separate result
          list right here, which was exactly a duplicate search system
          living inside Discover (product direction: reuse the existing
          flow, don't build a second one). A plain button styled like a
          search bar, rather than a real input, is deliberate: tapping it
          always navigates away immediately, so there's never a moment
          where two different golfer-search UIs are both live at once. */}
      {!isDemo && (
        <button
          type="button"
          onClick={() => navigate("/profile/following/find")}
          className="relative w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-3.5 text-left text-sm text-slate-400 transition hover:border-fairway-300"
        >
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          {t("discover.searchPlaceholder")}
        </button>
      )}

      {/* Switches Play to its Rounds tab (Find adopts ?tab= and drops it);
          inside Play that's a tab switch, so it replaces rather than adds a
          Back step, same as tapping the Rounds tab. */}
      <button
        onClick={() => navigate(findTabPath("rounds"), { replace: embedded })}
        className="flex items-center justify-between gap-3 rounded-2xl border border-fairway-200 bg-fairway-50 px-4 py-3 text-left transition hover:border-fairway-300"
      >
        <span className="flex items-center gap-2">
          <Flag size={15} className="text-fairway-600" />
          <span className="text-sm font-semibold text-fairway-800">{t("find.browseGolfCalls")}</span>
        </span>
        <ArrowRight size={15} className="shrink-0 text-fairway-600" />
      </button>

      <button
        onClick={() => setShowFilters((v) => !v)}
        className="-my-2 flex min-h-10 items-center gap-1.5 self-start text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800"
      >
        <SlidersHorizontal size={14} />
        {showFilters ? t("find.hideFilters") : t("find.filters")}
      </button>

      {showFilters && (
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("find.golfVibe")}</p>
            <div className="flex flex-wrap gap-1.5">
              {GOLF_VIBES.map((v) => (
                <button
                  key={v}
                  onClick={() => toggleVibe(v)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    activeVibes.includes(v)
                      ? "border-transparent bg-fairway-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-fairway-300"
                  }`}
                >
                  {vibeLabel(v, t)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("find.sortBy")}</p>
            <div className="flex items-center gap-2 text-xs">
              {(
                [
                  ["compatibility", t("find.sortCompatibility")],
                  ["distance", t("find.sortDistance")],
                  ["reputation", t("find.sortReputation")],
                ] as [SortMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setSortMode(mode)}
                  className={`rounded-full px-2.5 py-1 font-semibold transition ${
                    sortMode === mode ? "bg-fairway-100 text-fairway-700" : "text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {results.length === 0 ? (
        // Still loading, or a failed load, must not read as "no golfers here".
        !isDemo && rawCandidates.length === 0 && social.loadError && !social.isLoading ? (
          <LoadErrorState onRetry={social.retry} />
        ) : !isDemo && rawCandidates.length === 0 && !social.hasLoaded ? (
          <GolfMeLoader className="py-12" />
        ) : !isDemo && rawCandidates.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={20} />}
            title={t("find.noRealGolfersYet")}
            description={t("find.noRealGolfersYetDesc")}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" icon={<Share2 size={14} />} onClick={() => void shareApp()}>
                  {t("common.inviteFriend")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigate(findTabPath("rounds"), { replace: embedded })}>
                  {t("find.seeOpenRounds")}
                </Button>
              </div>
            }
          />
        ) : (
          <EmptyState
            icon={<SlidersHorizontal size={20} />}
            title={t("find.noGolfersMatch")}
            description={t("find.clearFilter")}
            action={
              activeVibes.length > 0 ? (
                <Button size="sm" variant="outline" onClick={() => setStoredVibes("")}>
                  {t("find.clearFilters")}
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {results.map(({ golfer, compat }) => (
            <GolferCard key={golfer.id} golfer={golfer} compatibility={compat} onClick={() => navigate(`/golfer/${golfer.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

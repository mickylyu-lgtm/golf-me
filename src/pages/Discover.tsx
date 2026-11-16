import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Share2, SlidersHorizontal, Users } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../i18n/LocaleContext";
import { GolferCard } from "../components/golfer/GolferCard";
import { GolferSearchResultRow } from "../components/golfer/GolferSearchResultRow";
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
import { useFriendSearch } from "../lib/useFriendSearch";
import { isImeComposing } from "../lib/isImeComposing";
import {
  DISCOVER_FILTERS_OPEN_KEY,
  DISCOVER_QUERY_KEY,
  DISCOVER_SORT_KEY,
  DISCOVER_VIBES_KEY,
  isOpenFlag,
  isSortMode,
  parseVibes,
  serializeVibes,
  toggleVibe as toggledVibes,
} from "../lib/discoverFilters";
import type { SortMode } from "../lib/discoverFilters";

// The Golfers tab inside Play (Find.tsx). The old standalone /discover page
// was removed (2026-11-16); that URL now redirects to Play > Golfers.
export function Discover() {
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

  // The name search. Kept for the session like the filters, so Back from a
  // golfer opened from the results returns to them.
  const [query, setQuery] = useSessionState<string>(DISCOVER_QUERY_KEY, "");
  const searchText = query.trim().toLowerCase();
  const searching = searchText.length > 0;
  // Real accounts only (the RPC needs a session); an empty query never calls it.
  const friendSearch = useFriendSearch(isDemo ? "" : query);

  const rawCandidates = visibleGolfers();
  // Real accounts: server stats for the reputation sort, not the
  // never-updated profile counters (demo: fixture numbers).
  const reputations = useCredibilityForGolfers(rawCandidates);

  const results = useMemo(() => {
    let list = rawCandidates.map((g) => ({ golfer: g, compat: computeCompatibility(currentUser, g) }));
    if (activeVibes.length > 0) {
      list = list.filter(({ golfer }) => golfer.vibes.some((v) => activeVibes.includes(v)));
    }
    // Demo: the name search filters the local golfers (real accounts show
    // the server results instead of this list while searching).
    if (searchText) {
      list = list.filter(
        ({ golfer }) => golfer.name.toLowerCase().includes(searchText) || (golfer.username ?? "").toLowerCase().includes(searchText.replace(/^@/, "")),
      );
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
  }, [rawCandidates, reputations, currentUser, activeVibes, sortMode, searchText]);

  return (
    <div className="flex flex-col gap-5">
      {/* GolfMe's one golfer search (the old Find Golfers page now lands
          here). Real accounts search every discoverable golfer by name or
          @username on the server (search_golfer_profiles); the demo account
          filters its local golfers. */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("findFriends.searchPlaceholder")}
            aria-label={t("findFriends.searchPlaceholder")}
            type="search"
            maxLength={80}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            enterKeyHint="search"
            onKeyDown={(e) => {
              // Search is live as you type; Return just closes the keyboard.
              if (e.key === "Enter" && !isImeComposing(e)) e.currentTarget.blur();
            }}
            className="w-full rounded-full border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-fairway-400"
          />
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          aria-label={showFilters ? t("find.hideFilters") : t("find.filters")}
          aria-pressed={showFilters}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-white transition-all duration-200 ease-out hover:border-fairway-300 hover:text-fairway-700 active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 ${
            showFilters || activeVibes.length > 0 ? "border-fairway-300 text-fairway-700" : "border-slate-200 text-slate-500"
          }`}
        >
          <SlidersHorizontal size={16} />
        </button>
      </div>

      {searching && !isDemo ? (
        friendSearch.loading ? (
          <p className="py-6 text-center text-sm text-slate-400">{t("findFriends.searching")}</p>
        ) : friendSearch.error ? (
          <LoadErrorState onRetry={friendSearch.retry} />
        ) : friendSearch.results.length === 0 ? (
          <EmptyState icon={<Search size={20} />} title={t("findFriends.noResults")} description={t("findFriends.noResultsDesc")} />
        ) : (
          <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
            {friendSearch.results.map((golfer) => (
              <GolferSearchResultRow key={golfer.id} golfer={golfer} onOpenProfile={() => navigate(`/golfer/${golfer.id}`)} />
            ))}
          </div>
        )
      ) : (
        <>
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
            icon={<Users size={20} />}
            title={t("find.noRealGolfersYet")}
            description={t("find.noRealGolfersYetDesc")}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" icon={<Share2 size={14} />} onClick={() => void shareApp()}>
                  {t("common.inviteFriend")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigate(findTabPath("rounds"), { replace: true })}>
                  {t("find.seeOpenRounds")}
                </Button>
              </div>
            }
          />
        ) : searching ? (
          <EmptyState icon={<Search size={20} />} title={t("findFriends.noResults")} description={t("findFriends.noResultsDesc")} />
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
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
          {results.map(({ golfer, compat }) => (
            <GolferCard key={golfer.id} golfer={golfer} compatibility={compat} onClick={() => navigate(`/golfer/${golfer.id}`)} />
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}

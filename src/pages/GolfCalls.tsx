import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, MapPinned, Plus, Search, Share2, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useRealRounds } from "../context/RealRoundsContext";
import { useLocale } from "../i18n/LocaleContext";
import { GolfCallCard } from "../components/golfcall/GolfCallCard";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadErrorState, StaleDataNotice } from "../components/ui/LoadStates";
import { GolfMeLoader } from "../components/loading/GolfMeLoader";
import { FindRoundModal } from "../components/find/FindRoundModal";
import { RoundAlertsCard } from "../components/find/RoundAlertsCard";
import { listView } from "../lib/loadStatus";
import type { GolfCall } from "../types";
import { isMatchedSearch, parseRoundSearch, quickAutoMatchSearch } from "../lib/roundSearchParams";
import { computeCallCompatibility } from "../lib/compatibility";
import { matchesWhen } from "../lib/roundFilters";
import { isPastRound } from "../lib/golfCall";
import { isImeComposing } from "../lib/isImeComposing";
import { effectiveLocation } from "../lib/travelLocation";
import { resolveCallDistanceMiles } from "../lib/courseSearch";
import { useSessionState } from "../lib/useSessionState";
import { COURSE_MAP_TUTORIAL_ID } from "../lib/tutorialSteps";
import { useShareActions } from "../lib/useShareActions";

interface GolfCallsProps {
  embedded?: boolean;
}

export function GolfCalls({ embedded = false }: GolfCallsProps) {
  const { currentUser, golfCalls } = useData();
  const { isDemo } = useAuth();
  const rounds = useRealRounds();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [query, setQuery] = useSessionState<string>("golfme:roundSearch", "");
  const [wizardOpen, setWizardOpen] = useState(false);
  const { shareApp } = useShareActions();
  const [searchParams, setSearchParams] = useSearchParams();
  // A failed first load must not read as "no rounds near you".
  const view = listView({ count: golfCalls.length, isDemo, hasLoaded: rounds.hasLoaded, loadError: rounds.loadError, isLoading: rounds.isLoading });

  // Shared parser (roundSearchParams.ts) -- the same one FindRoundModal and
  // Auto-Match use, so a search reads back exactly as it was written.
  const isMatched = isMatchedSearch(searchParams);
  const { when, radius, intent, budgetMax, skill, vibe: vibeFilter, walk, date: customDate } = useMemo(
    () => parseRoundSearch(searchParams),
    [searchParams],
  );
  const effectiveLoc = useMemo(() => effectiveLocation(currentUser, searchParams), [currentUser, searchParams]);

  const trimmedQuery = query.trim().toLowerCase();
  const baseResults = useMemo(
    () =>
      golfCalls
        .filter((c) => c.status !== "completed" && c.status !== "cancelled" && !isPastRound(c))
        .filter(
          (c) =>
            !trimmedQuery || c.course.toLowerCase().includes(trimmedQuery) || c.areaLabel.toLowerCase().includes(trimmedQuery),
        ),
    [golfCalls, trimmedQuery],
  );

  const matchedResults = useMemo(() => {
    if (!isMatched) return null;
    let list = [...baseResults];

    if (radius) {
      list = list.filter((c) => {
        const distance = resolveCallDistanceMiles(c, effectiveLoc);
        return distance !== undefined && distance <= radius;
      });
    }
    if (when) list = list.filter((c) => matchesWhen(c, when, customDate));

    if (intent === "join") list = list.filter((c) => c.totalSpots - c.joinedGolferIds.length > 0);
    if (budgetMax !== null) list = list.filter((c) => c.estimatedPricePerPerson <= budgetMax);
    if (skill) list = list.filter((c) => c.skillLevel === skill || c.skillLevel === "Any Skill Level");
    if (vibeFilter) list = list.filter((c) => c.vibe === vibeFilter);
    if (walk && walk !== "Either") list = list.filter((c) => c.walkOrCart === walk || c.walkOrCart === "Either");

    return list
      .map((call) => ({
        call,
        // A small trust nudge, never a real ranking factor — enough to
        // break a near-tie between two otherwise-similar rounds, never
        // enough to override a genuine compatibility difference (max
        // realistic gap here is a small fraction of the 0-100 scale
        // computeCallCompatibility produces). Unverified rounds are never
        // hidden or excluded, just not the tiebreak winner.
        matchScore: computeCallCompatibility(currentUser, call).overall + (call.teeTimeSource === "user_verified" ? 2 : 0),
      }))
      .sort((a, b) => b.matchScore - a.matchScore);
  }, [isMatched, baseResults, radius, when, customDate, intent, budgetMax, skill, vibeFilter, walk, currentUser, effectiveLoc]);

  // Newest-posted first (not soonest tee time) -- a freshly hosted round
  // should show up at the top of the feed immediately, the same
  // expectation as a social post, rather than being buried under rounds
  // happening sooner but posted long ago.
  const defaultResults = useMemo(
    () => [...baseResults].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [baseResults],
  );

  const whenLabel =
    when === "today"
      ? t("filters.today").toLowerCase()
      : when === "tomorrow"
        ? t("filters.tomorrow").toLowerCase()
        : when === "weekend"
          ? t("filters.thisWeekend").toLowerCase()
          : when === "date"
            ? t("find.yourChosenDate")
            : null;

  function clearSearch() {
    setSearchParams({});
  }

  const results: GolfCall[] = isMatched ? (matchedResults ?? []).map((r) => r.call) : defaultResults;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        {embedded ? (
          <div />
        ) : (
          <div>
            <h1 className="text-xl font-bold text-slate-900">{t("find.golfCallsTitle")}</h1>
            <p className="text-sm text-slate-500">{t("find.golfCallsSubtitle")}</p>
          </div>
        )}
        <Button size="sm" icon={<Plus size={15} />} onClick={() => navigate("/golf-calls/new")}>
          {t("common.host")}
        </Button>
      </div>

      {/* One tap straight into Auto-Match with the golfer's saved
          preferences and travel radius, any upcoming day -- the filter
          sheet is still there for a specific day or area. */}
      <button
        onClick={() => navigate(`/auto-match?${quickAutoMatchSearch(currentUser.travelRadiusMiles).toString()}`)}
        className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-brand-forest to-brand-forest-deep px-4 py-3.5 text-left text-white shadow-sm transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15">
          <Sparkles size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold">{t("filters.autoMatchMe")}</span>
          <span className="block text-sm text-fairway-50">{t("find.autoMatchQuickSubtitle")}</span>
        </span>
        <ChevronRight size={18} className="shrink-0" />
      </button>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("find.searchPlaceholder")}
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
          onClick={() => setWizardOpen(true)}
          aria-label={t("find.filters")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-all duration-200 ease-out hover:border-fairway-300 hover:text-fairway-700 active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          <SlidersHorizontal size={16} />
        </button>
        {/* Golf courses near you, on a map (Micky, 2026-11-04). */}
        <button
          onClick={() => navigate("/courses/map")}
          aria-label={t("courseMap.showMap")}
          data-tutorial-id={COURSE_MAP_TUTORIAL_ID}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-all duration-200 ease-out hover:border-fairway-300 hover:text-fairway-700 active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          <MapPinned size={16} />
        </button>
      </div>

      {isMatched && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-fairway-200 bg-fairway-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-fairway-800">
              {whenLabel ? t("find.matchesFor", { when: whenLabel }) : t("find.matches")} {radius ? t("find.withinRadius", { radius }) : ""}
            </p>
            <p className="text-xs text-fairway-700">{t("find.sortedByCompatibility")}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setWizardOpen(true)} className="text-xs font-semibold text-fairway-700 hover:underline">
              {t("find.editSearch")}
            </button>
            <button onClick={clearSearch} aria-label={t("find.clearSearch")} className="rounded-full p-1 text-fairway-600 hover:bg-fairway-100">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* The unfiltered list is every upcoming round, not a distance-filtered
          one, so it isn't labelled "near you". */}
      {!isMatched && (
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">{t("find.upcomingRounds")}</h2>
      )}

      {rounds.refreshFailed && <StaleDataNotice onRetry={rounds.retry} />}

      {view === "loading" ? (
        <GolfMeLoader className="py-12" />
      ) : view === "error" ? (
        <LoadErrorState onRetry={rounds.retry} />
      ) : results.length === 0 ? (
        isMatched ? (
          <EmptyState
            icon={<SlidersHorizontal size={20} />}
            title={t("find.emptyNoMatches")}
            description={t("find.emptyNoMatchesDesc")}
            action={
              <div className="flex w-full flex-col items-center gap-3">
                {/* Widening the search happens in the same sheet that made it
                    (day, area, radius); saved preferences are never changed here. */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button size="sm" variant="outline" icon={<SlidersHorizontal size={14} />} onClick={() => setWizardOpen(true)}>
                    {t("find.editSearch")}
                  </Button>
                  <Button size="sm" onClick={() => navigate("/golf-calls/new")}>
                    {t("find.createGolfCall")}
                  </Button>
                </div>
                <RoundAlertsCard />
              </div>
            }
          />
        ) : query.trim() ? (
          <EmptyState
            icon={<Search size={20} />}
            title={t("find.emptyNoMatches")}
            description={t("find.emptyNoResultsSearch")}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setQuery("")}>
                  {t("find.clearSearchText")}
                </Button>
                <Button size="sm" onClick={() => navigate("/golf-calls/new")}>
                  {t("find.hostGolfCall")}
                </Button>
              </div>
            }
          />
        ) : (
          <EmptyState
            icon={<Plus size={20} />}
            title={t("find.emptyNoMatches")}
            description={t("find.emptyNoResults")}
            action={
              <div className="flex w-full flex-col items-center gap-3">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button size="sm" onClick={() => navigate("/golf-calls/new")}>
                    {t("find.hostGolfCall")}
                  </Button>
                  <Button size="sm" variant="outline" icon={<Share2 size={14} />} onClick={() => void shareApp()}>
                    {t("common.inviteFriend")}
                  </Button>
                </div>
                <RoundAlertsCard />
              </div>
            }
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {results.map((call) => (
            <GolfCallCard key={call.id} call={call} />
          ))}
        </div>
      )}

      {wizardOpen && <FindRoundModal searchParams={searchParams} onClose={() => setWizardOpen(false)} />}
    </div>
  );
}

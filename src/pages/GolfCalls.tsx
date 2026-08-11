import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bell, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { GolfCallCard } from "../components/golfcall/GolfCallCard";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { FindRoundModal } from "../components/find/FindRoundModal";
import type { GolfCall, GolfVibe, SkillFilter, WalkOrCart } from "../types";
import { computeCallCompatibility } from "../lib/compatibility";
import { matchesWhen } from "../lib/roundFilters";
import { effectiveLocation } from "../lib/travelLocation";
import { resolveCallDistanceMiles } from "../lib/courseSearch";

interface GolfCallsProps {
  embedded?: boolean;
}

export function GolfCalls({ embedded = false }: GolfCallsProps) {
  const { currentUser, golfCalls } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [notified, setNotified] = useState(false);

  const isMatched = searchParams.get("matched") === "1";
  const when = searchParams.get("when");
  const radius = searchParams.get("radius");
  const intent = searchParams.get("intent");
  const budgetMax = searchParams.get("budgetMax");
  const skill = searchParams.get("skill") as SkillFilter | null;
  const vibeFilter = searchParams.get("vibe") as GolfVibe | null;
  const walk = searchParams.get("walk") as WalkOrCart | null;
  const customDate = searchParams.get("date");
  const effectiveLoc = useMemo(() => effectiveLocation(currentUser, searchParams), [currentUser, searchParams]);

  const trimmedQuery = query.trim().toLowerCase();
  const baseResults = useMemo(
    () =>
      golfCalls
        .filter((c) => c.status !== "completed" && c.status !== "cancelled")
        .filter(
          (c) =>
            !trimmedQuery || c.course.toLowerCase().includes(trimmedQuery) || c.areaLabel.toLowerCase().includes(trimmedQuery),
        ),
    [golfCalls, trimmedQuery],
  );

  const matchedResults = useMemo(() => {
    if (!isMatched) return null;
    let list = [...baseResults];

    if (radius) list = list.filter((c) => resolveCallDistanceMiles(c, effectiveLoc) <= Number(radius));
    if (when) list = list.filter((c) => matchesWhen(c, when, customDate));

    if (intent === "join") list = list.filter((c) => c.totalSpots - c.joinedGolferIds.length > 0);
    if (budgetMax) list = list.filter((c) => c.estimatedPricePerPerson <= Number(budgetMax));
    if (skill) list = list.filter((c) => c.skillLevel === skill || c.skillLevel === "Any Skill Level");
    if (vibeFilter) list = list.filter((c) => c.vibe === vibeFilter);
    if (walk && walk !== "Either") list = list.filter((c) => c.walkOrCart === walk || c.walkOrCart === "Either");

    return list
      .map((call) => ({ call, matchScore: computeCallCompatibility(currentUser, call).overall }))
      .sort((a, b) => b.matchScore - a.matchScore);
  }, [isMatched, baseResults, radius, when, customDate, intent, budgetMax, skill, vibeFilter, walk, currentUser, effectiveLoc]);

  const defaultResults = useMemo(
    () => [...baseResults].sort((a, b) => a.dateISO.localeCompare(b.dateISO)),
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

  function handleNotifyMe() {
    setNotified(true);
    showToast(t("find.willNotify"), "success");
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

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("find.searchPlaceholder")}
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
            <button onClick={clearSearch} aria-label="Clear search" className="rounded-full p-1 text-fairway-600 hover:bg-fairway-100">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {!isMatched && (
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">{t("find.nearYou")}</h2>
      )}

      {results.length === 0 ? (
        isMatched ? (
          <EmptyState
            icon={<SlidersHorizontal size={20} />}
            title={t("find.emptyNoMatches")}
            description={t("find.emptyNoMatchesDesc")}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => navigate("/golf-calls/new")}>
                  {t("find.createGolfCall")}
                </Button>
                <Button size="sm" variant="outline" icon={<Bell size={14} />} disabled={notified} onClick={handleNotifyMe}>
                  {notified ? t("find.notifiedMe") : t("find.notifyMe")}
                </Button>
              </div>
            }
          />
        ) : (
          <EmptyState
            icon={<Plus size={20} />}
            title={t("find.emptyNoMatches")}
            description={query ? t("find.emptyNoResultsSearch") : t("find.emptyNoResults")}
            action={
              <Button size="sm" onClick={() => navigate("/golf-calls/new")}>
                {t("find.hostGolfCall")}
              </Button>
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

      {wizardOpen && <FindRoundModal onClose={() => setWizardOpen(false)} />}
    </div>
  );
}

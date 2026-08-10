import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bell, Plus, SlidersHorizontal, X } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { GolfCallCard } from "../components/golfcall/GolfCallCard";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { FindRoundModal } from "../components/find/FindRoundModal";
import { GOLF_VIBES } from "../types";
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
  const navigate = useNavigate();
  const [activeVibes, setActiveVibes] = useState<GolfVibe[]>([]);
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

  function toggleVibe(v: GolfVibe) {
    setActiveVibes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  const baseResults = useMemo(
    () =>
      golfCalls
        .filter((c) => c.status !== "completed" && c.status !== "cancelled")
        .filter((c) => (activeVibes.length === 0 ? true : activeVibes.includes(c.vibe))),
    [golfCalls, activeVibes],
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

  const whenLabel = when === "today" ? "today" : when === "tomorrow" ? "tomorrow" : when === "weekend" ? "this weekend" : when === "date" ? "your chosen date" : null;

  function clearSearch() {
    setSearchParams({});
  }

  function handleNotifyMe() {
    setNotified(true);
    showToast("We'll notify you when a matching round appears.", "success");
  }

  const results: GolfCall[] = isMatched ? (matchedResults ?? []).map((r) => r.call) : defaultResults;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        {embedded ? (
          <div />
        ) : (
          <div>
            <h1 className="text-xl font-bold text-slate-900">Golf Calls</h1>
            <p className="text-sm text-slate-500">Open rounds looking for players, right now.</p>
          </div>
        )}
        <Button size="sm" icon={<Plus size={15} />} onClick={() => navigate("/golf-calls/new")}>
          Host
        </Button>
      </div>

      {isMatched && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-fairway-200 bg-fairway-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-fairway-800">
              Matches {whenLabel ? `for ${whenLabel}` : ""} {radius ? `within ${radius} mi` : ""}
            </p>
            <p className="text-xs text-fairway-700">Sorted by Golf Compatibility Score.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setWizardOpen(true)} className="text-xs font-semibold text-fairway-700 hover:underline">
              Edit search
            </button>
            <button onClick={clearSearch} aria-label="Clear search" className="rounded-full p-1 text-fairway-600 hover:bg-fairway-100">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <SlidersHorizontal size={14} className="mr-0.5 text-slate-400" />
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
            {v}
          </button>
        ))}
      </div>

      {results.length === 0 ? (
        isMatched ? (
          <EmptyState
            icon={<SlidersHorizontal size={20} />}
            title="Nothing matches yet. Start the round."
            description="There aren't any matching rounds right now — widen your search, host your own, or we'll let you know when one opens up."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => navigate("/golf-calls/new")}>
                  Create a Golf Call
                </Button>
                <Button size="sm" variant="outline" icon={<Bell size={14} />} disabled={notified} onClick={handleNotifyMe}>
                  {notified ? "We'll notify you" : "Notify Me When One Opens"}
                </Button>
              </div>
            }
          />
        ) : (
          <EmptyState
            icon={<Plus size={20} />}
            title="Nothing matches yet. Start the round."
            description="No open Golf Calls with that vibe right now — be the first to start one."
            action={
              <Button size="sm" onClick={() => navigate("/golf-calls/new")}>
                Host a Golf Call
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

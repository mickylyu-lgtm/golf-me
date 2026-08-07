import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import { useData } from "../context/DataContext";
import { GolferCard } from "../components/golfer/GolferCard";
import { EmptyState } from "../components/ui/EmptyState";
import { computeCompatibility } from "../lib/compatibility";
import { GOLF_VIBES } from "../types";
import type { GolfVibe } from "../types";

type SortMode = "compatibility" | "distance" | "reputation";

export function Discover() {
  const { currentUser, visibleGolfers } = useData();
  const navigate = useNavigate();
  const [activeVibes, setActiveVibes] = useState<GolfVibe[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("compatibility");

  function toggleVibe(v: GolfVibe) {
    setActiveVibes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  const results = useMemo(() => {
    let list = visibleGolfers().map((g) => ({ golfer: g, compat: computeCompatibility(currentUser, g) }));
    if (activeVibes.length > 0) {
      list = list.filter(({ golfer }) => golfer.vibes.some((v) => activeVibes.includes(v)));
    }
    switch (sortMode) {
      case "distance":
        list.sort((a, b) => a.golfer.distanceMiles - b.golfer.distanceMiles);
        break;
      case "reputation":
        list.sort((a, b) => b.golfer.reputation.wouldPlayAgainPct - a.golfer.reputation.wouldPlayAgainPct);
        break;
      default:
        list.sort((a, b) => b.compat.overall - a.compat.overall);
    }
    return list;
  }, [visibleGolfers, currentUser, activeVibes, sortMode]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Discover golfers</h1>
        <p className="text-sm text-slate-500">Matched on schedule, skill, budget, and vibe — not looks.</p>
      </div>

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
            {v}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs">
        <SlidersHorizontal size={14} className="text-slate-400" />
        <span className="text-slate-500">Sort by</span>
        {(
          [
            ["compatibility", "Compatibility"],
            ["distance", "Distance"],
            ["reputation", "Reputation"],
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

      {results.length === 0 ? (
        <EmptyState icon={<SlidersHorizontal size={20} />} title="No golfers match those vibes" description="Try clearing a filter." />
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

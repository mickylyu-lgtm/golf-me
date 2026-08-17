import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Flag, Search, SlidersHorizontal, Sparkles, UserRoundCheck, UserRoundPlus } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { GolferCard } from "../components/golfer/GolferCard";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { computeCompatibility } from "../lib/compatibility";
import { GOLF_VIBES } from "../types";
import type { GolfVibe } from "../types";
import { vibeLabel } from "../lib/enumLabels";
import { useFriendSearch } from "../lib/useFriendSearch";
import type { FriendSearchResult } from "../lib/useFriendSearch";

type SortMode = "compatibility" | "distance" | "reputation";

interface DiscoverProps {
  embedded?: boolean;
}

export function Discover({ embedded = false }: DiscoverProps) {
  const { currentUser, visibleGolfers, isFollowing, followUser, unfollowUser } = useData();
  const { isDemo } = useAuth();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [activeVibes, setActiveVibes] = useState<GolfVibe[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("compatibility");
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // search_golfer_profiles() is a real Supabase RPC needing a real auth
  // session — same reasoning as FindFriends.tsx, which this reuses rather
  // than duplicating. Demo mode never sees the search bar at all.
  const { results: searchResults, loading: searchLoading, error: searchError } = useFriendSearch(isDemo ? "" : searchQuery);
  const searching = !isDemo && searchQuery.trim().length > 0;

  async function handleFollowToggle(golfer: FriendSearchResult) {
    try {
      if (isFollowing(golfer.id)) {
        await unfollowUser(golfer.id);
      } else {
        await followUser(golfer.id);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("findFriends.followFailed"), "warning");
    }
  }

  function toggleVibe(v: GolfVibe) {
    setActiveVibes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  const rawCandidates = visibleGolfers();

  const results = useMemo(() => {
    let list = rawCandidates.map((g) => ({ golfer: g, compat: computeCompatibility(currentUser, g) }));
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
  }, [rawCandidates, currentUser, activeVibes, sortMode]);

  return (
    <div className="flex flex-col gap-5">
      {!embedded && (
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("discover.title")}</h1>
          <p className="text-sm text-slate-500">{t("discover.subtitle")}</p>
        </div>
      )}

      {!isDemo && (
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("findFriends.searchPlaceholder")}
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-3.5 text-sm text-slate-800 outline-none transition focus:border-fairway-400 focus:ring-2 focus:ring-fairway-100"
          />
        </div>
      )}

      {searching ? (
        searchLoading ? (
          <p className="py-6 text-center text-sm text-slate-400">{t("findFriends.searching")}</p>
        ) : searchError ? (
          <p className="py-6 text-center text-sm text-rose-500">{searchError}</p>
        ) : searchResults.length === 0 ? (
          <EmptyState icon={<Search size={20} />} title={t("findFriends.noResults")} description={t("findFriends.noResultsDesc")} />
        ) : (
          <div className="flex flex-col gap-2">
            {searchResults.map((golfer) => {
              const following = isFollowing(golfer.id);
              return (
                <div key={golfer.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3">
                  <button onClick={() => navigate(`/golfer/${golfer.id}`)} className="flex flex-1 items-center gap-3 text-left">
                    <Avatar
                      golfer={{
                        avatarColor: golfer.avatarColor,
                        avatarInitials: golfer.avatarInitials,
                        photoUrl: golfer.photoUrl,
                        verification: { phoneVerified: false, emailVerified: false, verifiedGolfer: false },
                      }}
                      size="sm"
                      showVerified={false}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-800">{golfer.name}</p>
                      <p className="text-xs text-slate-500">
                        {golfer.username && <>@{golfer.username} · </>}
                        {golfer.handicap !== null ? t("golfCallDetail.handicapValue", { handicap: golfer.handicap }) : t("golfCallDetail.noHandicapYet")}
                      </p>
                    </div>
                  </button>
                  <Button
                    size="sm"
                    variant={following ? "outline" : "primary"}
                    icon={following ? <UserRoundCheck size={14} /> : <UserRoundPlus size={14} />}
                    onClick={() => handleFollowToggle(golfer)}
                  >
                    {following ? t("common.following") : t("common.follow")}
                  </Button>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <>
      <button
        onClick={() => navigate("/golf-calls")}
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
        className="flex items-center gap-1.5 self-start text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800"
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
        !isDemo && rawCandidates.length === 0 ? (
          <EmptyState icon={<Sparkles size={20} />} title={t("find.noRealGolfersYet")} />
        ) : (
          <EmptyState icon={<SlidersHorizontal size={20} />} title={t("find.noGolfersMatch")} description={t("find.clearFilter")} />
        )
      ) : (
        <div className="flex flex-col gap-3">
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

import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, Search, UserRoundCheck, UserRoundPlus } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { useFriendSearch } from "../lib/useFriendSearch";
import type { FriendSearchResult } from "../lib/useFriendSearch";

// Real-users-only by construction: search_golfer_profiles() (the RPC this
// queries via useFriendSearch) is a real Supabase RPC requiring a real auth
// session — a demo account has none, so the call would just error rather
// than degrade gracefully. Redirecting demo accounts away is simpler and
// more honest than trying to make this page pretend to work without real
// backend to search against — Find Friends has no demo-mode equivalent.
export function FindFriends() {
  const { isDemo } = useAuth();
  const { isFollowing, followUser, unfollowUser } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const { results, loading, error } = useFriendSearch(query);

  if (isDemo) return <Navigate to="/profile/following" replace />;

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

  return (
    <div className="flex flex-col gap-6 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("findFriends.title")}</h1>
        <p className="text-sm text-slate-500">{t("findFriends.subtitle")}</p>
      </div>

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("findFriends.searchPlaceholder")}
          className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-3.5 text-sm text-slate-800 outline-none transition focus:border-fairway-400 focus:ring-2 focus:ring-fairway-100"
        />
      </div>

      {!query.trim() ? (
        <EmptyState icon={<Search size={20} />} title={t("findFriends.startTyping")} />
      ) : loading ? (
        <p className="py-6 text-center text-sm text-slate-400">{t("findFriends.searching")}</p>
      ) : error ? (
        <p className="py-6 text-center text-sm text-rose-500">{error}</p>
      ) : results.length === 0 ? (
        <EmptyState icon={<Search size={20} />} title={t("findFriends.noResults")} description={t("findFriends.noResultsDesc")} />
      ) : (
        <div className="flex flex-col gap-2">
          {results.map((golfer) => {
            const following = isFollowing(golfer.id);
            return (
              <div key={golfer.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3">
                <button
                  onClick={() => navigate(`/golfer/${golfer.id}`)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
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
                      {golfer.areaLabel && <> · {golfer.areaLabel}</>}
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
      )}
    </div>
  );
}

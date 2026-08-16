import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search, UserRoundPlus } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";

export function FollowingDetail() {
  const { followingGolfers, unfollowUser } = useData();
  const { isDemo } = useAuth();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-6 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("following.title")}</h1>
        <p className="text-sm text-slate-500">{t("following.subtitle")}</p>
      </div>

      {/* Real accounts only — Find Friends has no demo-mode equivalent
          (search_golfer_profiles is a real Supabase RPC), same reasoning as
          FindFriends.tsx's own isDemo redirect. */}
      {!isDemo && (
        <Button variant="outline" icon={<Search size={15} />} onClick={() => navigate("/profile/following/find")}>
          {t("findFriends.entryPoint")}
        </Button>
      )}

      {followingGolfers.length === 0 ? (
        <EmptyState icon={<UserRoundPlus size={20} />} title={t("following.empty")} description={t("following.emptyDesc")} />
      ) : (
        <div className="flex flex-col gap-2">
          {followingGolfers.map((g) => (
            <div key={g.id} className="flex items-center gap-3">
              <button
                onClick={() => navigate(`/golfer/${g.id}`)}
                className="flex flex-1 items-center gap-3 rounded-xl py-1 text-left transition hover:bg-slate-50"
              >
                <Avatar golfer={g} size="sm" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-800">{g.name}</p>
                  <p className="text-xs text-slate-500">
                    {g.handicap !== null ? t("golfCallDetail.handicapValue", { handicap: g.handicap }) : t("golfCallDetail.noHandicapYet")} ·{" "}
                    {t("following.rounds", { count: g.reputation.completedRounds })}
                  </p>
                </div>
              </button>
              <button
                onClick={async () => {
                  try {
                    await unfollowUser(g.id);
                    showToast(t("following.unfollowedToast", { name: g.name }), "info");
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : t("following.unfollowError"), "warning");
                  }
                }}
                className="shrink-0 text-xs font-semibold text-slate-400 transition-colors duration-200 hover:text-slate-700"
              >
                {t("following.unfollow")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

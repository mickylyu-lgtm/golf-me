import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Search, UserPlus } from "lucide-react";
import { useData } from "../context/DataContext";
import { useLocale } from "../i18n/LocaleContext";
import { GolfCallCard } from "../components/golfcall/GolfCallCard";
import { PostCard } from "../components/community/PostCard";
import { CLICKABLE_CARD_CLASS } from "../components/ui/cardStyles";
import { firstName, greetingKeyForHour, isThisWeekend } from "../lib/greeting";
import { MIN_PREFERENCES_FOR_AUTO_MATCH, selectedPreferenceCount } from "../lib/preferenceMatch";

const HOME_RADIUS_MILES = 25;
const NEARBY_ROUNDS_SHOWN = 3;
const HOME_POSTS_SHOWN = 3;

// A standalone class list (rather than layering overrides onto
// CLICKABLE_CARD_CLASS) — Tailwind's generated stylesheet order doesn't
// follow class-attribute order, so a later `bg-fairway-600` in the string
// isn't guaranteed to beat CLICKABLE_CARD_CLASS's own `bg-white`.
const PRIMARY_ACTION_CLASS =
  "rounded-2xl bg-fairway-600 shadow-sm shadow-fairway-900/10 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-fairway-700 hover:shadow-md active:translate-y-0 active:bg-fairway-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

export function Home() {
  const { currentUser, golfCalls, visiblePosts } = useData();
  const { t } = useLocale();
  const navigate = useNavigate();

  const openCalls = useMemo(
    () => golfCalls.filter((c) => c.status === "open" && c.totalSpots - c.joinedGolferIds.length > 0),
    [golfCalls],
  );

  const nearbyThisWeekend = useMemo(
    () => openCalls.filter((c) => c.distanceMiles <= HOME_RADIUS_MILES && isThisWeekend(c.dateISO)),
    [openCalls],
  );

  const nearbyAnytime = useMemo(() => openCalls.filter((c) => c.distanceMiles <= HOME_RADIUS_MILES), [openCalls]);

  const subtitle =
    nearbyThisWeekend.length > 0
      ? nearbyThisWeekend.length === 1
        ? t("home.roundNeedsPlayers")
        : t("home.roundsNeedPlayers", { count: nearbyThisWeekend.length })
      : t("home.readyToGolf");

  const nearbyRounds = useMemo(
    () => [...nearbyAnytime].sort((a, b) => a.dateISO.localeCompare(b.dateISO)).slice(0, NEARBY_ROUNDS_SHOWN),
    [nearbyAnytime],
  );

  // Same underlying data + PostCard component as the full Community page —
  // just the newest slice, so Home never carries a duplicate feed implementation.
  const recentPosts = useMemo(
    () =>
      [...visiblePosts()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, HOME_POSTS_SHOWN),
    [visiblePosts],
  );

  // Self-resolving nudge — only shows while under the same 3-of-5 threshold
  // Auto-Match itself gates on, so it disappears the moment it's no longer
  // true rather than needing separate dismiss-state to avoid nagging.
  const preferencesRemaining = MIN_PREFERENCES_FOR_AUTO_MATCH - selectedPreferenceCount(currentUser);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-slate-500">
          {t(greetingKeyForHour(new Date().getHours()))}, {firstName(currentUser.name)}
        </p>
        <p className="mt-0.5 text-lg font-bold text-slate-900">{subtitle}</p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={() => navigate("/find")}
          className={`flex w-full items-center gap-3 p-4 text-left ${PRIMARY_ACTION_CLASS}`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-white">
            <Search size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-white">{t("home.findRound")}</span>
            <span className="block text-sm text-fairway-50">{t("home.findRoundSubtitle")}</span>
          </span>
          <ArrowRight size={16} className="shrink-0 text-white/80" />
        </button>

        <button
          onClick={() => navigate("/golf-calls/new")}
          className={`flex w-full items-center gap-3 p-4 text-left ${CLICKABLE_CARD_CLASS}`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">
            <UserPlus size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-slate-900">{t("home.hostRound")}</span>
            <span className="block text-sm text-slate-500">{t("home.hostRoundSubtitle")}</span>
          </span>
          <ArrowRight size={16} className="shrink-0 text-slate-400" />
        </button>
      </div>

      {nearbyRounds.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">{t("home.roundsNearYou")}</h2>
            <button
              onClick={() => navigate("/find")}
              className="text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800 hover:underline"
            >
              {t("common.viewMore")}
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {nearbyRounds.map((call) => (
              <GolfCallCard key={call.id} call={call} />
            ))}
          </div>
        </section>
      )}

      {preferencesRemaining > 0 && (
        <button
          onClick={() => navigate("/profile/preferences")}
          className={`flex w-full items-center justify-between gap-3 p-4 text-left ${CLICKABLE_CARD_CLASS}`}
        >
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-900">{t("home.completeProfile")}</span>
            <span className="block text-xs text-slate-500">{t("home.optionalPreferencesRemaining")}</span>
          </span>
          <span className="shrink-0 text-xs font-semibold text-fairway-700">{t("home.updatePreferences")}</span>
        </button>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{t("community.title")}</h2>
          <button
            onClick={() => navigate("/community")}
            className="text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800 hover:underline"
          >
            {t("common.viewMore")}
          </button>
        </div>
        {recentPosts.length > 0 ? (
          <div className="flex flex-col gap-3">
            {recentPosts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        ) : (
          <button
            onClick={() => navigate("/community/new")}
            className={`flex w-full items-center justify-between gap-3 p-4 text-left ${CLICKABLE_CARD_CLASS}`}
          >
            <span className="min-w-0">
              <span className="block text-sm font-bold text-slate-900">{t("community.emptyDefault")}</span>
              <span className="block text-xs text-slate-500">{t("community.subtitle")}</span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-fairway-700">{t("community.createPost")}</span>
          </button>
        )}
      </section>
    </div>
  );
}

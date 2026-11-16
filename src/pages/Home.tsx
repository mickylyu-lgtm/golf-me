import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { Activity, ArrowRight, ChevronRight, Flag, Plus, Share2, SlidersHorizontal, Users } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../i18n/LocaleContext";
import { useTutorial, useTutorialEligibility } from "../context/TutorialContext";
import { GolfCallCard } from "../components/golfcall/GolfCallCard";
import { PostCard } from "../components/community/PostCard";
import { AddToHomeScreenPrompt } from "../components/layout/AddToHomeScreenPrompt";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { CLICKABLE_CARD_CLASS } from "../components/ui/cardStyles";
import { firstName, greetingKeyForHour, isThisWeekend } from "../lib/greeting";
import { MIN_PREFERENCES_FOR_AUTO_MATCH, selectedPreferenceCount } from "../lib/preferenceMatch";
import { formatCompactDay, formatShortDate } from "../lib/format";
import { roundedMiles } from "../lib/geo";
import { isPastRound } from "../lib/golfCall";
import { COMMUNITY_TUTORIAL_ID } from "../lib/tutorialSteps";
import { findTabPath } from "../lib/findTab";
import { HostReminderCard } from "../components/onboarding/HostReminderCard";
import { useFirstRoundPrompt } from "../context/FirstRoundPromptContext";
import { clubLabel } from "../lib/clubLabel";
import { useShareActions } from "../lib/useShareActions";
import { homeFocus, readOnboardingIntents } from "../lib/onboardingIntent";
import { useRealCommunity } from "../context/RealCommunityContext";
import { rowToPost } from "../lib/communityPostRow";
import { feedCutoff, mergeFollowingPosts, withinCutoff } from "../lib/followingFeed";
import { useFollowingFeed } from "../lib/useFollowingFeed";
import type { CommunityPost, GolfCall, GolferProfile } from "../types";

const HOME_RADIUS_MILES = 25;
// The "rounds near you" strip stays short: Play has the full list.
const ROUND_STRIP_COUNT = 6;
// The feed keeps going as you scroll (Micky, 2026-11-05: "so people don't
// just scroll to the end"): this many at first, this many more each time the
// end of the list comes near, until every loaded item is shown.
const FEED_STEP = 6;
// New golfers who follow no one still see a little of the community.
const COMMUNITY_PREVIEW_COUNT = 3;

// Same dark-green gradient as the shared Button / app icon. A standalone
// class list: Tailwind's stylesheet order doesn't follow class order, so
// layering this over CLICKABLE_CARD_CLASS's bg-white isn't reliable.
const PRIMARY_ACTION_CLASS =
  "rounded-2xl bg-gradient-to-br from-brand-forest to-brand-forest-deep shadow-sm shadow-fairway-900/10 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:brightness-110 hover:shadow-md active:translate-y-0 active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

// One entry in the following feed: a post, or a round a followed golfer is
// hosting or has joined. Ordered by when it was created.
type FeedItem =
  | { kind: "post"; key: string; at: string; post: CommunityPost }
  | { kind: "round"; key: string; at: string; call: GolfCall; actor: GolferProfile; hosting: boolean };

// A compact card for the horizontal "rounds near you" strip.
function RoundStripCard({ call }: { call: GolfCall }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const openSpots = call.totalSpots - call.joinedGolferIds.length;
  return (
    <button
      type="button"
      onClick={() => navigate(`/golf-calls/${call.id}`)}
      className={`flex w-56 shrink-0 snap-start flex-col gap-1.5 p-3.5 text-left ${CLICKABLE_CARD_CLASS}`}
    >
      <span className="line-clamp-1 text-sm font-bold text-slate-900">{call.course}</span>
      <span className="text-xs font-medium text-slate-500">
        {formatCompactDay(call.dateISO, locale, t)} · {call.timeLabel}
      </span>
      <span className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs">
        <span className="font-semibold text-fairway-700">
          {openSpots === 1 ? t("golfCallCard.spotsRemainingSingular", { count: openSpots }) : t("golfCallCard.spotsRemainingPlural", { count: openSpots })}
        </span>
        {call.distanceMiles !== undefined && (
          <span className="shrink-0 text-slate-400">{t("golfCallCard.miAway", { miles: roundedMiles(call.distanceMiles) })}</span>
        )}
      </span>
    </button>
  );
}

// A small one-line prompt (profile completion, latest Caddie result).
function SmallPrompt({ icon, title, detail, onClick }: { icon: ReactNode; title: string; detail?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 px-3.5 py-3 text-left ${CLICKABLE_CARD_CLASS}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{title}</span>
        {detail && <span className="block truncate text-xs text-slate-500">{detail}</span>}
      </span>
      <ChevronRight size={16} className="shrink-0 text-slate-300" />
    </button>
  );
}

export function Home() {
  const { currentUser, golfCalls, visiblePosts, caddieAnalyses, followingGolfers, getGolfer, isBlockedEitherWay, isPostHidden } = useData();
  const { isDemo, authUser } = useAuth();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { start: startTutorial } = useTutorial();
  const { eligible: tutorialEligible } = useTutorialEligibility();
  const { showReminderCard: showHostReminder, startHosting } = useFirstRoundPrompt();
  const { shareApp } = useShareActions();
  // What a brand-new golfer told Ready they're here for (first week only,
  // this device): picks which way the empty feed points first.
  const intentOwner = isDemo ? "demo" : authUser?.id;
  const focus = useMemo(() => homeFocus(readOnboardingIntents(intentOwner)), [intentOwner]);

  // Home stays mounted for the whole session (RootTabCarousel keeps all 5
  // root panels alive), so this only ever runs once per app load.
  const tutorialStartedRef = useRef(false);
  useEffect(() => {
    if (tutorialStartedRef.current || !tutorialEligible) return;
    tutorialStartedRef.current = true;
    startTutorial();
  }, [tutorialEligible, startTutorial]);

  // Only the single latest analysis, and only if one exists.
  const latestCaddieAnalysis = useMemo(
    () => [...caddieAnalyses].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    [caddieAnalyses],
  );

  const openCalls = useMemo(
    () => golfCalls.filter((c) => c.status === "open" && c.totalSpots - c.joinedGolferIds.length > 0 && !isPastRound(c)),
    [golfCalls],
  );

  // Unknown-distance rounds never count as nearby. The headline count only
  // includes rounds you could actually join (not your own or ones you're in).
  const nearbyThisWeekend = useMemo(
    () =>
      openCalls.filter(
        (c) =>
          c.distanceMiles !== undefined &&
          c.distanceMiles <= HOME_RADIUS_MILES &&
          isThisWeekend(c.dateISO) &&
          !c.joinedGolferIds.includes(currentUser.id),
      ),
    [openCalls, currentUser.id],
  );

  const subtitle =
    nearbyThisWeekend.length > 0
      ? nearbyThisWeekend.length === 1
        ? t("home.roundNeedsPlayers")
        : t("home.roundsNeedPlayers", { count: nearbyThisWeekend.length })
      : t("home.readyToGolf");

  // The strip: nearby open rounds, newest first; with none nearby (or no
  // known location), the newest open rounds anywhere, so it's never empty
  // while rounds exist.
  const stripRounds = useMemo(() => {
    const newest = (list: GolfCall[]) => [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, ROUND_STRIP_COUNT);
    const nearby = openCalls.filter((c) => c.distanceMiles !== undefined && c.distanceMiles <= HOME_RADIUS_MILES);
    return { nearby: nearby.length > 0, rounds: nearby.length > 0 ? newest(nearby) : newest(openCalls) };
  }, [openCalls]);

  // The feed: posts (including swing posts) by golfers you follow, plus
  // upcoming rounds they host or have joined. Real accounts page posts from
  // get_following_feed and merge them with Community's loaded posts
  // (lib/followingFeed.ts). Demo, and real accounts until that migration is
  // applied, filter the posts already loaded for Community.
  const followingIds = useMemo(() => new Set(followingGolfers.map((g) => g.id)), [followingGolfers]);
  const followKey = useMemo(() => [...followingIds].sort().join(","), [followingIds]);
  const serverFeed = useFollowingFeed(!isDemo && Boolean(authUser), authUser?.id, followKey);
  const { hasLoaded: communityLoaded, loadError: communityLoadError, refreshFailed: communityRefreshFailed } = useRealCommunity();
  const allPosts = useMemo(
    () => [...visiblePosts()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [visiblePosts],
  );
  const serverPosts = useMemo(() => serverFeed.rows.map((row) => rowToPost(row, serverFeed.media)), [serverFeed.rows, serverFeed.media]);
  const usingServer = serverFeed.mode === "server";
  const followedPosts = useMemo(
    () =>
      usingServer
        ? mergeFollowingPosts({
            serverPosts,
            contextPosts: allPosts,
            contextLoaded: communityLoaded && !communityLoadError && !communityRefreshFailed,
            followingIds,
            isVisible: (post) => !isBlockedEitherWay(post.authorId) && !isPostHidden(post.id),
          })
        : allPosts.filter((post) => followingIds.has(post.authorId)),
    [usingServer, serverPosts, allPosts, communityLoaded, communityLoadError, communityRefreshFailed, followingIds, isBlockedEitherWay, isPostHidden],
  );
  const serverHasMore = usingServer && serverFeed.hasMore;
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    for (const post of followedPosts) items.push({ kind: "post", key: `post-${post.id}`, at: post.createdAt, post });
    for (const call of golfCalls) {
      if (call.hostId === currentUser.id || call.status === "cancelled" || isPastRound(call)) continue;
      const hosting = followingIds.has(call.hostId);
      const actorId = hosting ? call.hostId : call.joinedGolferIds.find((id) => followingIds.has(id));
      const actor = actorId ? getGolfer(actorId) : undefined;
      if (actor) items.push({ kind: "round", key: `round-${call.id}`, at: call.createdAt, call, actor, hosting });
    }
    items.sort((a, b) => b.at.localeCompare(a.at));
    // While older server pages remain, hold back anything older than the
    // last loaded post so it can't sit above posts not fetched yet.
    return withinCutoff(items, feedCutoff(followedPosts, serverHasMore));
  }, [followedPosts, serverHasMore, golfCalls, followingIds, currentUser.id, getGolfer]);

  const [feedShown, setFeedShown] = useState(FEED_STEP);
  const shownFeed = feed.slice(0, feedShown);
  const moreFeed = feedShown < feed.length || serverHasMore;
  const loadMoreServer = serverFeed.loadMore;
  const feedLength = feed.length;
  const feedEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const end = feedEndRef.current;
    if (!end || !moreFeed || typeof IntersectionObserver === "undefined") return;
    // Starts loading the next step a little before the end is on screen;
    // once the loaded items run out, fetches the next server page.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        // No state change while everything loaded is shown and a page is on
        // its way: the page's arrival (feedLength) re-runs this effect.
        if (feedShown < feedLength) setFeedShown((n) => n + FEED_STEP);
        if (feedShown + FEED_STEP >= feedLength) loadMoreServer();
      },
      { rootMargin: "0px 0px 600px 0px" },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [moreFeed, feedShown, feedLength, serverFeed.loading, loadMoreServer]);

  // Self-resolving nudge: only while under the same threshold Auto-Match
  // gates on, so it disappears without separate dismiss state.
  const preferencesRemaining = MIN_PREFERENCES_FOR_AUTO_MATCH - selectedPreferenceCount(currentUser);

  const seeAllPosts = (
    <button
      onClick={() => navigate("/community")}
      className="mt-1 flex min-h-11 items-center justify-center gap-1.5 self-center rounded-full px-4 text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:bg-fairway-50 hover:text-fairway-800"
    >
      {t("community.seeAllPosts")} <ArrowRight size={14} aria-hidden="true" />
    </button>
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[13px] font-normal text-slate-500">
            {t(greetingKeyForHour(new Date().getHours()))}, {firstName(currentUser.name)}
          </p>
          <p className="mt-0.5 text-xl font-bold text-slate-900">{subtitle}</p>
        </div>

        <AddToHomeScreenPrompt />

        {/* The one primary action on Home. Finding rounds and golfers lives in Play. */}
        <button
          type="button"
          onClick={() => navigate("/golf-calls/new")}
          className={`flex w-full items-center gap-3 p-4 text-left ${PRIMARY_ACTION_CLASS}`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fixed-white/15 text-white">
            <Plus size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-white">{t("home.hostRound")}</span>
            <span className="block text-sm text-fairway-50">{t("home.hostRoundSubtitle")}</span>
          </span>
          <ArrowRight size={16} className="shrink-0 text-white/80" />
        </button>

        {/* After the first-round popup was closed: a quiet nudge that stays
            until the first round is created (real accounts only). */}
        {showHostReminder && <HostReminderCard onHost={startHosting} />}
      </div>

      <section aria-labelledby="home-rounds-strip">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 id="home-rounds-strip" className="text-lg font-bold text-slate-900">
            {stripRounds.nearby ? t("home.roundsNearYou") : t("home.openRounds")}
          </h2>
          {stripRounds.rounds.length > 0 && (
            <button
              onClick={() => navigate(findTabPath("rounds"))}
              className="text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800 hover:underline"
            >
              {t("common.viewMore")}
            </button>
          )}
        </div>
        {stripRounds.rounds.length > 0 ? (
          <div className="-mx-4 flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:scroll-px-0 sm:px-0">
            {stripRounds.rounds.map((call) => (
              <RoundStripCard key={call.id} call={call} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-slate-200 bg-white p-4">
            <span className="min-w-0">
              <span className="block text-sm font-bold text-slate-900">{t("home.noRoundsYetTitle")}</span>
              <span className="block text-xs text-slate-500">{t("home.noRoundsYetBody")}</span>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" icon={<Share2 size={14} />} onClick={() => void shareApp()}>
                {t("common.inviteFriend")}
              </Button>
            </span>
          </div>
        )}
      </section>

      {(preferencesRemaining > 0 || latestCaddieAnalysis) && (
        <div className="flex flex-col gap-2">
          {preferencesRemaining > 0 && (
            <SmallPrompt
              icon={<SlidersHorizontal size={15} />}
              title={t("home.completeProfile")}
              detail={t("home.optionalPreferencesRemaining")}
              onClick={() => navigate("/profile/preferences")}
            />
          )}
          {latestCaddieAnalysis && (
            <SmallPrompt
              icon={<Activity size={15} />}
              title={`${clubLabel(latestCaddieAnalysis.swingType, t) || t("caddie.homeCardTitle")} · ${formatShortDate(latestCaddieAnalysis.createdAt, locale)}`}
              detail={
                latestCaddieAnalysis.status === "complete" && latestCaddieAnalysis.score !== undefined
                  ? t("caddie.scoreOutOf100", { score: latestCaddieAnalysis.score })
                  : t("caddie.continueInCaddie")
              }
              onClick={() => navigate(`/caddie/${latestCaddieAnalysis.id}`)}
            />
          )}
        </div>
      )}

      <section aria-labelledby="home-feed">
        <div data-tutorial-id={COMMUNITY_TUTORIAL_ID} className="mb-3 flex items-center justify-between gap-2">
          <h2 id="home-feed" className="text-lg font-bold text-slate-900">{t("home.feedTitle")}</h2>
          <Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={() => navigate("/community/new")}>
            {t("community.createPost")}
          </Button>
        </div>

        {feed.length > 0 ? (
          <div className="flex flex-col gap-3">
            {shownFeed.map((item) =>
              item.kind === "post" ? (
                <PostCard key={item.key} post={item.post} />
              ) : (
                <div key={item.key} className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/golfer/${item.actor.id}`)}
                    className="flex items-center gap-2 self-start rounded-full pr-2 text-left text-sm text-slate-600 transition-colors duration-200 hover:text-slate-900"
                  >
                    <Avatar golfer={item.actor} size="xs" showVerified={false} />
                    <span>
                      {item.hosting ? t("home.feedHosting", { name: firstName(item.actor.name) }) : t("home.feedJoined", { name: firstName(item.actor.name) })}
                    </span>
                  </button>
                  <GolfCallCard call={item.call} />
                </div>
              ),
            )}
            {moreFeed ? <div ref={feedEndRef} aria-hidden="true" className="h-px" /> : seeAllPosts}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-white px-5 py-6 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">
                <Users size={20} />
              </span>
              <span>
                <span className="block text-base font-bold text-slate-900">{t("home.feedEmptyTitle")}</span>
                <span className="mt-1 block text-sm text-slate-500">{t("home.feedEmptyBody")}</span>
              </span>
              <span className={`flex flex-wrap items-center justify-center gap-2 ${focus === "golfers" ? "" : "flex-row-reverse"}`}>
                <Button size="sm" icon={<Users size={14} />} variant={focus === "golfers" ? "primary" : "outline"} onClick={() => navigate(findTabPath("golfers"))}>
                  {t("home.findGolfers")}
                </Button>
                <Button size="sm" icon={<Flag size={14} />} variant={focus === "golfers" ? "outline" : "primary"} onClick={() => navigate(findTabPath("rounds"))}>
                  {t("home.findRound")}
                </Button>
              </span>
            </div>
            {allPosts.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">{t("home.fromCommunity")}</h3>
                {allPosts.slice(0, COMMUNITY_PREVIEW_COUNT).map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
                {seeAllPosts}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

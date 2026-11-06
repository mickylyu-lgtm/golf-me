import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Info, MapPin, Plus, Share2, Target, Users } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useRealRounds } from "../context/RealRoundsContext";
import { useRealSocial } from "../context/RealSocialContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { GolfCallCard } from "../components/golfcall/GolfCallCard";
import { RoundAlertsCard } from "../components/find/RoundAlertsCard";
import { EditMatchPreferencesSheet } from "../components/find/EditMatchPreferencesSheet";
import { AutoMatchGolferCard } from "../components/find/AutoMatchGolferCard";
import { LocationPicker } from "../components/location/LocationPicker";
import { LoadErrorState } from "../components/ui/LoadStates";
import { GolfMeLoader } from "../components/loading/GolfMeLoader";
import { listView } from "../lib/loadStatus";
import { SharedPreferencesBadge } from "../components/golfcall/SharedPreferencesBadge";
import { rankCallsWithPreferences } from "../lib/autoMatch";
import { effectiveNewPreferences } from "../lib/matchPreferences";
import { effectiveLocation, isTemporaryLocation, locationOverride, locationParams } from "../lib/travelLocation";
import { resolveCallDistanceMiles } from "../lib/courseSearch";
import { computeCompatibility, golferDistanceMiles } from "../lib/compatibility";
import type { CompatibilityBreakdown } from "../lib/compatibility";
import { haversineMiles } from "../lib/geo";
import type { PlayingArea } from "../lib/geo";
import { coarsenOptionalGeoPoint } from "../lib/coarseLocation";
import { MIN_PREFERENCES_FOR_AUTO_MATCH, preferenceTierKey, selectedPreferenceCount } from "../lib/preferenceMatch";
import type { PreferenceMatchContext } from "../lib/preferenceMatch";
import type { GolferProfile } from "../types";
import { browseAllSearch, defaultSearchRadius, parseRoundSearch } from "../lib/roundSearchParams";
import { dayRangeFor, isEligibleRound, matchesAdvancedFilters, planAutoMatch } from "../lib/autoMatchLadder";
import type { GolferCandidate, Widening } from "../lib/autoMatchLadder";
import { hostPrefillSearch } from "../lib/hostPrefill";
import { golferDistanceSource, golfersForSource } from "../lib/travelGolfers";
import { useTravelGolferDirectory } from "../lib/useTravelGolferDirectory";
import { useInviteToPlay } from "../lib/useInviteToPlay";
import { useShareActions } from "../lib/useShareActions";
import { formatShortDate } from "../lib/format";
import type { TranslationKey } from "../i18n/locales/en";
import { goBack } from "../lib/goBack";

// One suggested, single-tap value per not-yet-set Match Preference. No
// longer a gate (Auto-Match always runs now), just a quick way to get
// sharper matches. Each is a real value, never "No Preference".
const QUICK_PICK_SUGGESTIONS: {
  id: string;
  labelKey: TranslationKey;
  value: string;
  patch: Partial<GolferProfile>;
  isSet: (v: ReturnType<typeof effectiveNewPreferences>) => boolean;
}[] = [
  {
    id: "roundLength",
    labelKey: "matchPrefs.roundLength",
    value: "18 Holes",
    patch: { roundLengthPreference: "18 Holes" },
    isSet: (v) => v.roundLengthPreference !== "No Preference",
  },
  {
    id: "groupType",
    labelKey: "matchPrefs.groupType",
    value: "Mixed / Anyone",
    patch: { groupTypePreference: "Mixed / Anyone" },
    isSet: (v) => v.groupTypePreference !== "No Preference",
  },
  {
    id: "gameFormat",
    labelKey: "host.gameFormat",
    value: "Standard Stroke Play",
    patch: { gameFormatPreference: "Standard Stroke Play" },
    isSet: (v) => v.gameFormatPreference !== "No Preference",
  },
];

interface GolferSuggestion extends GolferCandidate {
  golfer: GolferProfile;
  compat: CompatibilityBreakdown;
}

export function AutoMatch() {
  const {
    currentUser,
    updateCurrentUserProfile,
    golfCalls,
    getGolfer,
    followingGolfers,
    circleGolfers,
    playedWithIds,
    visibleGolfers,
    isBlockedEitherWay,
    canMessage,
  } = useData();
  const { showToast } = useToast();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteToPlay = useInviteToPlay();
  const { shareApp } = useShareActions();

  const [resultIndex, setResultIndex] = useState(0);
  // Match Preferences edited here, in a sheet, instead of leaving Auto-Match.
  const [prefsSheetOpen, setPrefsSheetOpen] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const { isDemo } = useAuth();
  const rounds = useRealRounds();
  const social = useRealSocial();
  // Rounds failed to load -> say so instead of "no matches".
  const roundsView = listView({ count: golfCalls.length, isDemo, hasLoaded: rounds.hasLoaded, loadError: rounds.loadError, isLoading: rounds.isLoading });

  // Shared parser (roundSearchParams.ts), same as the browse list. A link
  // with no radius (e.g. an old bookmark) uses the golfer's travel radius.
  const parsed = useMemo(() => parseRoundSearch(searchParams), [searchParams]);
  const { when, date: customDate, budgetMax, skill, vibe: vibeFilter, walk } = parsed;
  const radius = parsed.radius ?? defaultSearchRadius(currentUser.travelRadiusMiles);

  const whenLabel =
    when === "today"
      ? t("filters.today").toLowerCase()
      : when === "tomorrow"
        ? t("filters.tomorrow").toLowerCase()
        : when === "weekend"
          ? t("filters.thisWeekend").toLowerCase()
          : t("find.yourChosenDate");

  // A temporary per-search override from Find a Round if present,
  // otherwise the golfer's saved Match Preferences / playing area.
  const effectivePrefs = useMemo(() => effectiveNewPreferences(currentUser, searchParams), [currentUser, searchParams]);
  const effectiveLoc = useMemo(() => effectiveLocation(currentUser, searchParams), [currentUser, searchParams]);
  const temporaryLocation = isTemporaryLocation(currentUser, searchParams);
  const selectedCount = selectedPreferenceCount(effectivePrefs);
  // Fixed for this visit so the date windows don't drift while it's open.
  const [now] = useState(() => new Date());

  const ctx: PreferenceMatchContext = useMemo(
    () => ({
      followingIds: new Set(followingGolfers.map((g) => g.id)),
      circleIds: new Set(circleGolfers.map((g) => g.id)),
      playedWithIds,
    }),
    [followingGolfers, circleGolfers, playedWithIds],
  );

  const eligibility = useMemo(() => ({ userId: currentUser.id, now, isBlocked: isBlockedEitherWay }), [currentUser.id, now, isBlockedEitherWay]);

  // Joinable rounds only (lib/autoMatchLadder isEligibleRound), Find a
  // Round's advanced filters applied as chosen, then the existing
  // preference + compatibility ranking.
  const roundCandidates = useMemo(() => {
    const eligible = golfCalls.filter(
      (c) => isEligibleRound(c, eligibility) && matchesAdvancedFilters(c, { budgetMax, skill, vibe: vibeFilter, walk }),
    );
    return rankCallsWithPreferences(currentUser, effectivePrefs, eligible, getGolfer, ctx).map((r) => ({
      ...r,
      // The distance the round card itself shows (from the saved area),
      // so a note like "Widened to 25 mi" never contradicts "4 mi away";
      // a "Playing Somewhere Else?" area measures from there instead.
      distanceMiles: temporaryLocation ? resolveCallDistanceMiles(r.call, effectiveLoc) : (r.call.distanceMiles ?? resolveCallDistanceMiles(r.call, effectiveLoc)),
      matchedCount: r.preferenceMatchedCount,
    }));
  }, [golfCalls, eligibility, budgetMax, skill, vibeFilter, walk, currentUser, effectivePrefs, getGolfer, ctx, effectiveLoc, temporaryLocation]);

  // Golfers come from visibleGolfers (discoverability + blocks already
  // applied there), ranked by the same compatibility as the Golfers tab.
  // Real golfers' distance buckets are measured from the SAVED area, so a
  // "Playing Somewhere Else?" search uses the directory measured from that
  // area instead (golfer_directory_from), and shows no golfers when the
  // server can't measure from it (lib/travelGolfers). URL-only; the saved
  // area is never written here.
  const travel = useTravelGolferDirectory(effectiveLoc.coords, temporaryLocation && !isDemo);
  const golferSource = golferDistanceSource({
    temporaryArea: temporaryLocation,
    isDemo,
    areaHasCoords: Boolean(effectiveLoc.coords),
    travelStatus: travel.status,
  });
  const golferCandidates = useMemo<GolferSuggestion[]>(
    () =>
      golfersForSource(
        golferSource,
        visibleGolfers(),
        travel.profiles.filter((g) => !isBlockedEitherWay(g.id)),
      ).map((g) => {
        const compat = computeCompatibility(currentUser, g);
        const distanceMiles =
          golferSource === "local" && effectiveLoc.coords && g.playingAreaCoords
            ? haversineMiles(effectiveLoc.coords, g.playingAreaCoords)
            : golferSource === "local"
              ? undefined
              : golferDistanceMiles(currentUser, g);
        return { id: g.id, golfer: g, compat, distanceMiles, score: compat.overall };
      }),
    [golferSource, visibleGolfers, travel.profiles, isBlockedEitherWay, currentUser, effectiveLoc],
  );
  const golfersHiddenForArea = golferSource === "hidden";

  const plan = useMemo(
    () =>
      planAutoMatch({
        hasLocation: Boolean(effectiveLoc.coords),
        when,
        customDate,
        radius,
        selectedPreferenceCount: selectedCount,
        strongThreshold: MIN_PREFERENCES_FOR_AUTO_MATCH,
        now,
        eligibility,
        rounds: roundCandidates,
        golfers: golferCandidates,
      }),
    [effectiveLoc.coords, when, customDate, radius, selectedCount, now, eligibility, roundCandidates, golferCandidates],
  );

  const results = plan.kind === "rounds" ? plan.rounds : [];
  const current = results[Math.min(resultIndex, Math.max(results.length - 1, 0))];
  const currentIsStrong = Boolean(current) && current.preferenceMatchedCount >= MIN_PREFERENCES_FOR_AUTO_MATCH;
  // A preference match (how many Match Preferences the round meets), named
  // as such: the round's own match rating is the compatibility score.
  const preferenceHeaderKey = current && currentIsStrong ? preferenceTierKey(current.preferenceTier) : null;
  // Real golfers load separately from rounds; don't call it empty early.
  const golfersPending = (!isDemo && !social.hasLoaded) || golferSource === "pending";
  // Why no golfers are suggested for a "Playing Somewhere Else?" area.
  const golfersHiddenNote = golfersHiddenForArea ? (
    <p className="flex items-start gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600" role="note">
      <Info size={14} className="mt-0.5 shrink-0 text-slate-400" />
      {t("autoMatch.golfersHiddenForArea", { area: effectiveLoc.label })}
    </p>
  ) : null;

  function widenedNotes(w: Widening, stepRadius: number): string[] {
    const notes: string[] = [];
    if (w.date === "week") {
      const range = dayRangeFor("week", when, customDate, now);
      const last = new Date(range.end ?? range.start);
      last.setDate(last.getDate() - 1);
      notes.push(
        t("autoMatch.widenedDateWeek", {
          when: whenLabel,
          miles: stepRadius,
          from: formatShortDate(range.start.toISOString(), locale),
          to: formatShortDate(last.toISOString(), locale),
        }),
      );
    }
    if (w.date === "any") notes.push(t("autoMatch.widenedDateAny", { when: whenLabel, miles: stepRadius }));
    if (w.radius !== null) notes.push(t("autoMatch.widenedRadius", { from: radius, to: w.radius }));
    if (w.prefs === "overlap") notes.push(t("autoMatch.widenedPrefsOverlap"));
    if (w.prefs === "none") notes.push(t("autoMatch.widenedPrefsNone"));
    return notes;
  }

  const notes = plan.kind === "rounds" ? widenedNotes(plan.widened, plan.step.radius) : [];

  function hostRound() {
    navigate(`/golf-calls/new?${hostPrefillSearch({ when, customDate, prefs: effectivePrefs, walk, skill }).toString()}`);
  }

  async function chooseLocation(area: PlayingArea) {
    setLocationPickerOpen(false);
    if (!area.coords) {
      showToast(t("autoMatch.locationNoCoords"), "warning");
      return;
    }
    // A search with its own "Playing Somewhere Else?" area: replace that
    // area for this search. Otherwise save it as the golfer's playing area
    // (coarsened, same as Find a Round's "Set as default").
    if (locationOverride(searchParams)) {
      const next = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(locationParams(area))) next.set(k, v);
      setSearchParams(next, { replace: true });
      return;
    }
    try {
      await updateCurrentUserProfile({ areaLabel: area.label, playingAreaCoords: coarsenOptionalGeoPoint(area.coords) });
      showToast(t("filters.defaultAreaSet", { area: area.label }), "success");
    } catch {
      showToast(t("preferences.saveError"), "warning");
    }
  }

  function golferCards(list: GolferSuggestion[]) {
    return list.map((s) => (
      <AutoMatchGolferCard
        key={s.id}
        golfer={s.golfer}
        compatibility={s.compat}
        distanceMiles={s.distanceMiles}
        canInvite={canMessage(s.id)}
        onInvite={() => inviteToPlay(s.golfer)}
        onViewProfile={() => navigate(`/golfer/${s.id}`)}
      />
    ));
  }

  const hostAndInvite = (
    <div className="flex flex-wrap justify-center gap-2">
      <Button size="sm" className="min-h-11" icon={<Plus size={14} />} onClick={hostRound}>
        {t("autoMatch.hostRound")}
      </Button>
      <Button size="sm" className="min-h-11" variant="outline" icon={<Share2 size={14} />} onClick={() => void shareApp()}>
        {t("common.inviteFriend")}
      </Button>
    </div>
  );

  const prefsNudge =
    selectedCount < MIN_PREFERENCES_FOR_AUTO_MATCH ? (
      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="text-sm font-semibold text-slate-800">{t("autoMatch.betterMatchesNudge")}</p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {QUICK_PICK_SUGGESTIONS.filter((s) => !s.isSet(effectivePrefs)).map((s) => (
            <button
              key={s.id}
              onClick={() => updateCurrentUserProfile(s.patch).catch(() => showToast(t("preferences.saveError"), "warning"))}
              className="min-h-9 rounded-full border border-fairway-200 bg-fairway-50/70 px-3 py-1.5 text-xs font-medium text-fairway-700 transition-colors duration-150 hover:bg-fairway-100 motion-reduce:transition-none"
            >
              {t(s.labelKey)}: {s.value}
            </button>
          ))}
          <button
            onClick={() => setPrefsSheetOpen(true)}
            className="min-h-9 rounded-full px-3 py-1.5 text-xs font-semibold text-fairway-700 hover:underline"
          >
            {t("autoMatch.setPreferences")}
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => goBack(navigate)}
        className="flex items-center gap-1.5 self-start text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Target size={20} className="text-fairway-600" /> {t("autoMatch.title")}
        </h1>
        {/* Names the chosen day only when the results are still for it;
            once the date widened (or there are no rounds) it stays neutral. */}
        <p className="text-sm text-slate-500">
          {when && plan.kind === "rounds" && plan.widened.date === null ? t("autoMatch.subtitle", { when: whenLabel }) : t("autoMatch.subtitleAnyDay")}
        </p>
      </div>

      {roundsView === "loading" ? (
        <GolfMeLoader className="py-12" />
      ) : roundsView === "error" ? (
        <LoadErrorState onRetry={rounds.retry} />
      ) : plan.kind === "needsLocation" ? (
        <EmptyState
          icon={<MapPin size={20} />}
          title={t("autoMatch.needsLocationTitle")}
          description={t("autoMatch.needsLocationDesc")}
          action={
            <Button size="sm" className="min-h-11" icon={<MapPin size={14} />} onClick={() => setLocationPickerOpen(true)}>
              {t("autoMatch.setLocation")}
            </Button>
          }
        />
      ) : plan.kind === "rounds" && current ? (
        <div className="flex flex-col gap-4">
          {notes.length > 0 && (
            <div className="flex items-start gap-2 rounded-2xl border border-sun-100 bg-sun-50 px-3.5 py-3 text-sm text-slate-700" role="status">
              <Info size={16} className="mt-0.5 shrink-0 text-sun-700" />
              <div className="flex flex-col gap-0.5">
                {notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-bold tracking-wide text-fairway-700 uppercase">
              {preferenceHeaderKey ? t(preferenceHeaderKey) : t("autoMatch.closestAvailable")}
            </p>
            {preferenceHeaderKey && <p className="mt-0.5 text-xs text-slate-500">{t("autoMatch.preferenceTierHint")}</p>}
            {results.length > 1 && (
              <p className="mt-0.5 text-xs font-semibold text-slate-400">
                {t("autoMatch.position", { n: Math.min(resultIndex, results.length - 1) + 1, total: results.length })}
              </p>
            )}
          </div>

          {/* The shared preferences are the row below (from the search's own
              preferences); the card's copy would repeat them. */}
          <GolfCallCard call={current.call} showSharedPreferences={false} />
          {current.preferenceChecks.length > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-3">
              <SharedPreferencesBadge checks={current.preferenceChecks} />
              <span className="shrink-0 text-xs text-slate-400">
                {t("autoMatch.preferencesCount", { matched: current.preferenceMatchedCount, total: current.preferenceChecks.length })}
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {results.length > 1 && (
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => setResultIndex((i) => (i + 1) % results.length)}>
                {t("autoMatch.showAnother")}
              </Button>
            )}
            <Button variant="ghost" size="sm" className="min-h-11" onClick={() => navigate(`/golf-calls?${browseAllSearch(searchParams).toString()}`)}>
              {t("autoMatch.browseAll")}
            </Button>
            <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setPrefsSheetOpen(true)}>
              {t("autoMatch.editPreferences")}
            </Button>
          </div>

          {plan.golfers.length > 0 && plan.golferRadius !== null && (
            <section className="flex flex-col gap-3 border-t border-slate-100 pt-4">
              <div>
                <h2 className="flex items-center gap-1.5 text-base font-bold text-slate-900">
                  <Users size={16} className="text-fairway-600" /> {t("autoMatch.golfersNearby")}
                </h2>
                <p className="text-xs text-slate-500">{t("autoMatch.golfersWithin", { miles: plan.golferRadius })}</p>
              </div>
              {golferCards(plan.golfers)}
            </section>
          )}
          {golfersHiddenNote}

          {prefsNudge}
        </div>
      ) : golfersPending ? (
        <GolfMeLoader className="py-12" />
      ) : plan.kind === "golfers" ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-fairway-200 bg-fairway-50 px-4 py-3">
            <p className="text-sm font-bold text-fairway-800">{t("autoMatch.noRoundsGolfersTitle")}</p>
            <p className="mt-0.5 text-sm text-fairway-800/80">{t("autoMatch.noRoundsGolfersDesc")}</p>
            <p className="mt-1 text-xs text-fairway-700">{t("autoMatch.golfersWithin", { miles: plan.golferRadius })}</p>
          </div>
          {golferCards(plan.golfers)}
          <div className="flex flex-col items-center gap-3 border-t border-slate-100 pt-4">
            {hostAndInvite}
            <RoundAlertsCard />
          </div>
          {prefsNudge}
        </div>
      ) : (
        <EmptyState
          icon={<Users size={20} />}
          title={t("autoMatch.emptyTitle")}
          description={t("autoMatch.emptyDesc")}
          action={
            <div className="flex w-full flex-col items-center gap-3">
              {golfersHiddenNote}
              {hostAndInvite}
              <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setPrefsSheetOpen(true)}>
                {t("autoMatch.editPreferences")}
              </Button>
              <RoundAlertsCard />
            </div>
          }
        />
      )}

      {prefsSheetOpen && <EditMatchPreferencesSheet onClose={() => setPrefsSheetOpen(false)} />}
      {locationPickerOpen && (
        <LocationPicker title={t("autoMatch.locationPickerTitle")} onSelect={(area) => void chooseLocation(area)} onClose={() => setLocationPickerOpen(false)} />
      )}
    </div>
  );
}

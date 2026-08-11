import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Bell, Sparkles } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { GolfMeLoader } from "../components/loading/GolfMeLoader";
import { GolfCallCard } from "../components/golfcall/GolfCallCard";
import { SharedPreferencesBadge } from "../components/golfcall/SharedPreferencesBadge";
import { rankCallsWithPreferences } from "../lib/autoMatch";
import { matchesWhen } from "../lib/roundFilters";
import { effectiveNewPreferences, selectedNewPreferenceLabels } from "../lib/matchPreferences";
import { effectiveLocation } from "../lib/travelLocation";
import { resolveCallDistanceMiles } from "../lib/courseSearch";
import { MIN_PREFERENCES_FOR_AUTO_MATCH, preferenceTierLabel, selectedPreferenceCount } from "../lib/preferenceMatch";
import type { PreferenceMatchContext } from "../lib/preferenceMatch";
import type { GolferProfile, GolfVibe, SkillFilter, WalkOrCart } from "../types";
import type { TranslationKey } from "../i18n/locales/en";

// One suggested, single-tap value per not-yet-set Match Preference — lets a
// first-time golfer (onboarding only sets Round Length) reach the 3-of-5
// Auto-Match threshold in a couple of taps instead of being sent away to a
// full preferences form. Each suggestion is a real, meaningful value (never
// "No Preference" itself, which wouldn't count) so accepting it is a
// genuine choice, not a placeholder.
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
  {
    id: "networking",
    labelKey: "matchPrefs.networking",
    value: "Open to Networking",
    patch: { networkingPreference: "Open to Networking" },
    isSet: (v) => v.networkingPreference !== "No Preference",
  },
  {
    id: "gender",
    labelKey: "matchPrefs.genderPreference",
    value: "Prefer mixed group",
    patch: { genderPreference: "Prefer mixed group" },
    isSet: (v) => v.genderPreference !== "No preference",
  },
];

export function AutoMatch() {
  const { currentUser, updateCurrentUserProfile, golfCalls, getGolfer, followingGolfers, circleGolfers, playedWithIds } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultIndex, setResultIndex] = useState(0);
  const [notified, setNotified] = useState(false);
  const [showClosest, setShowClosest] = useState(false);

  const when = searchParams.get("when");
  const radius = searchParams.get("radius");
  const customDate = searchParams.get("date");
  const budgetMax = searchParams.get("budgetMax");
  const skill = searchParams.get("skill") as SkillFilter | null;
  const vibeFilter = searchParams.get("vibe") as GolfVibe | null;
  const walk = searchParams.get("walk") as WalkOrCart | null;

  const whenLabel =
    when === "today"
      ? t("filters.today").toLowerCase()
      : when === "tomorrow"
        ? t("filters.tomorrow").toLowerCase()
        : when === "weekend"
          ? t("filters.thisWeekend").toLowerCase()
          : t("find.yourChosenDate");

  // Reads a temporary per-search override from Find Me a Round if present,
  // otherwise falls back to the golfer's saved Match Preferences.
  const effectivePrefs = useMemo(() => effectiveNewPreferences(currentUser, searchParams), [currentUser, searchParams]);
  // Same override pattern for location — "Playing Somewhere Else?" in Find
  // Me a Round, else the golfer's saved playing area.
  const effectiveLoc = useMemo(() => effectiveLocation(currentUser, searchParams), [currentUser, searchParams]);
  const selectedCount = selectedPreferenceCount(effectivePrefs);
  const preferenceLabels = useMemo(() => selectedNewPreferenceLabels(effectivePrefs), [effectivePrefs]);
  const enoughPreferences = selectedCount >= MIN_PREFERENCES_FOR_AUTO_MATCH;

  const ctx: PreferenceMatchContext = useMemo(
    () => ({
      followingIds: new Set(followingGolfers.map((g) => g.id)),
      circleIds: new Set(circleGolfers.map((g) => g.id)),
      playedWithIds,
    }),
    [followingGolfers, circleGolfers, playedWithIds],
  );

  const joinableCalls = useMemo(
    () =>
      golfCalls.filter(
        (c) =>
          c.status === "open" &&
          c.totalSpots - c.joinedGolferIds.length > 0 &&
          !c.joinedGolferIds.includes(currentUser.id) &&
          !c.pendingRequestIds.includes(currentUser.id),
      ),
    [golfCalls, currentUser.id],
  );

  // STEP 1 — basic eligibility. Region/coordinates + travel radius are
  // evaluated first (real distance when the selected area and the call's
  // course both have known coordinates, else the existing mock
  // distanceMiles — never regresses for golfers without one), then
  // date/time — the same filters Find Me a Round already offered, now just
  // labeled and ordered by step.
  const eligibleCalls = useMemo(() => {
    let list = joinableCalls;
    if (radius) list = list.filter((c) => resolveCallDistanceMiles(c, effectiveLoc) <= Number(radius));
    if (when) list = list.filter((c) => matchesWhen(c, when, customDate));
    if (budgetMax) list = list.filter((c) => c.estimatedPricePerPerson <= Number(budgetMax));
    if (skill) list = list.filter((c) => c.skillLevel === skill || c.skillLevel === "Any Skill Level");
    if (vibeFilter) list = list.filter((c) => c.vibe === vibeFilter);
    if (walk && walk !== "Either") list = list.filter((c) => c.walkOrCart === walk || c.walkOrCart === "Either");
    return list;
  }, [joinableCalls, radius, when, customDate, budgetMax, skill, vibeFilter, walk, effectiveLoc]);

  // STEP 2 (preference comparison) + STEP 4 (ranking) — STEP 3's 3+ gate is
  // applied just below via strongMatches/closestMatches.
  const rankedCandidates = useMemo(
    () => rankCallsWithPreferences(currentUser, effectivePrefs, eligibleCalls, getGolfer, ctx),
    [currentUser, effectivePrefs, eligibleCalls, getGolfer, ctx],
  );

  const strongMatches = useMemo(
    () => rankedCandidates.filter((c) => c.preferenceMatchedCount >= MIN_PREFERENCES_FOR_AUTO_MATCH),
    [rankedCandidates],
  );
  const closestMatches = useMemo(
    () =>
      [...rankedCandidates]
        .filter((c) => c.preferenceMatchedCount > 0 && c.preferenceMatchedCount < MIN_PREFERENCES_FOR_AUTO_MATCH)
        .sort((a, b) => b.preferenceMatchedCount - a.preferenceMatchedCount),
    [rankedCandidates],
  );

  const hasStrongMatch = strongMatches.length > 0;
  const results = hasStrongMatch ? strongMatches : showClosest ? closestMatches : [];
  const current = results[Math.min(resultIndex, Math.max(results.length - 1, 0))];

  function runAutoMatch() {
    if (!enoughPreferences) return;
    setLoading(true);
    setResultIndex(0);
    setShowClosest(false);
    window.setTimeout(() => {
      setLoading(false);
      setStarted(true);
    }, 500);
  }

  function showAnother() {
    setResultIndex((i) => (i + 1) % results.length);
  }

  function handleNotifyMe() {
    setNotified(true);
    showToast(t("find.willNotify"), "success");
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Sparkles size={20} className="text-fairway-600" /> {t("autoMatch.title")}
        </h1>
        <p className="text-sm text-slate-500">{t("autoMatch.subtitle", { when: whenLabel })}</p>
      </div>

      {loading ? (
        <GolfMeLoader fullScreen message={t("autoMatch.finding")} />
      ) : !started ? (
        !enoughPreferences ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-100 bg-white p-4">
              <p className="text-base font-bold text-slate-900">{t("autoMatch.helpFindBetter")}</p>
              <p className="mt-1 text-sm text-slate-500">{t("autoMatch.chooseOneMore")}</p>
              {preferenceLabels.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {preferenceLabels.map((label) => (
                    <Badge key={label} tone="fairway">
                      {label}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {QUICK_PICK_SUGGESTIONS.filter((s) => !s.isSet(effectivePrefs)).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => updateCurrentUserProfile(s.patch)}
                    className="rounded-full border border-fairway-200 bg-fairway-50/70 px-3 py-1.5 text-xs font-medium text-fairway-700 transition-colors duration-150 hover:bg-fairway-100"
                  >
                    {t(s.labelKey)}: {s.value}
                  </button>
                ))}
              </div>
            </div>
            <Button variant="ghost" size="sm" className="self-start" onClick={() => navigate("/profile/preferences")}>
              {t("autoMatch.setPreferences")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-100 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("autoMatch.usingPreferences")}</p>
                <button onClick={() => navigate("/profile")} className="text-xs font-semibold text-fairway-700 hover:underline">
                  {t("autoMatch.editPreferences")}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {preferenceLabels.map((label) => (
                  <Badge key={label} tone="fairway">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>

            <Button size="lg" fullWidth icon={<Sparkles size={18} />} onClick={runAutoMatch}>
              {t("filters.autoMatchMe")}
            </Button>
          </div>
        )
      ) : results.length === 0 ? (
        !showClosest ? (
          <EmptyState
            icon={<Sparkles size={20} />}
            title={t("autoMatch.noStrongMatches")}
            description={t("autoMatch.noStrongMatchesDesc")}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {closestMatches.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setShowClosest(true)}>
                    {t("autoMatch.showClosest")}
                  </Button>
                )}
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
            icon={<Sparkles size={20} />}
            title={t("autoMatch.nothingNearby")}
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
        )
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-bold tracking-wide text-fairway-700 uppercase">
              {hasStrongMatch ? preferenceTierLabel(current.preferenceTier) : t("autoMatch.closestAvailable")}
            </p>
            {!hasStrongMatch && <p className="mt-1 text-sm text-slate-500">{t("autoMatch.outsideNormalCriteria")}</p>}
          </div>

          {current && (
            <>
              <GolfCallCard call={current.call} />
              {current.preferenceChecks.length > 0 && (
                <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3">
                  <SharedPreferencesBadge checks={current.preferenceChecks} />
                  <span className="text-xs text-slate-400">
                    {t("autoMatch.preferencesCount", { matched: current.preferenceMatchedCount, total: current.preferenceChecks.length })}
                  </span>
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2">
            {results.length > 1 && (
              <Button variant="outline" size="sm" onClick={showAnother}>
                {t("autoMatch.showAnother")}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => navigate(`/golf-calls?${searchParams.toString()}`)}>
              {t("autoMatch.browseAll")}
            </Button>
          </div>

          {!hasStrongMatch && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <Button size="sm" onClick={() => navigate("/golf-calls/new")}>
                {t("find.createGolfCall")}
              </Button>
              <Button size="sm" variant="outline" icon={<Bell size={14} />} disabled={notified} onClick={handleNotifyMe}>
                {notified ? t("find.notifiedMe") : t("find.notifyMe")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Bell, Sparkles } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
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
import type { GolfVibe, SkillFilter, WalkOrCart } from "../types";

export function AutoMatch() {
  const { currentUser, golfCalls, getGolfer, followingGolfers, circleGolfers, playedWithIds } = useData();
  const { showToast } = useToast();
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

  const whenLabel = when === "today" ? "today" : when === "tomorrow" ? "tomorrow" : when === "weekend" ? "this weekend" : "your chosen date";

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
    showToast("We'll notify you when a matching round appears.", "success");
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Sparkles size={20} className="text-fairway-600" /> Auto-Match
        </h1>
        <p className="text-sm text-slate-500">We'll recommend the best available round for {whenLabel}, using your Match Preferences.</p>
      </div>

      {loading ? (
        <GolfMeLoader fullScreen message="Finding your best match..." />
      ) : !started ? (
        !enoughPreferences ? (
          <EmptyState
            icon={<Sparkles size={20} />}
            title="Choose at least 3 preferences for Auto-Match."
            description="Round Length, Gender, Group Type, Game Format, and Networking — pick at least 3 so Auto-Match has enough to go on."
            action={
              <Button size="sm" onClick={() => navigate("/profile")}>
                Set Preferences
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-100 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Using Your Match Preferences</p>
                <button onClick={() => navigate("/profile")} className="text-xs font-semibold text-fairway-700 hover:underline">
                  Edit Preferences
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
              Auto-Match Me
            </Button>
          </div>
        )
      ) : results.length === 0 ? (
        !showClosest ? (
          <EmptyState
            icon={<Sparkles size={20} />}
            title="No strong matches yet."
            description="Nothing open right now hits 3 or more of your Match Preferences."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {closestMatches.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setShowClosest(true)}>
                    Show Closest Matches
                  </Button>
                )}
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
            icon={<Sparkles size={20} />}
            title="Nothing nearby right now."
            description="There's nothing open near you at all — host your own round or we'll let you know when one opens up."
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
        )
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-bold tracking-wide text-fairway-700 uppercase">
              {hasStrongMatch ? preferenceTierLabel(current.preferenceTier) : "Closest Available Round"}
            </p>
            {!hasStrongMatch && (
              <p className="mt-1 text-sm text-slate-500">
                Outside your normal Auto-Match criteria — shown because nothing hit 3+ of your preferences yet.
              </p>
            )}
          </div>

          {current && (
            <>
              <GolfCallCard call={current.call} />
              {current.preferenceChecks.length > 0 && (
                <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3">
                  <SharedPreferencesBadge checks={current.preferenceChecks} />
                  <span className="text-xs text-slate-400">
                    {current.preferenceMatchedCount}/{current.preferenceChecks.length} preferences
                  </span>
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2">
            {results.length > 1 && (
              <Button variant="outline" size="sm" onClick={showAnother}>
                Show Another Match
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => navigate(`/golf-calls?${searchParams.toString()}`)}>
              Browse All Rounds
            </Button>
          </div>

          {!hasStrongMatch && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <Button size="sm" onClick={() => navigate("/golf-calls/new")}>
                Create a Golf Call
              </Button>
              <Button size="sm" variant="outline" icon={<Bell size={14} />} disabled={notified} onClick={handleNotifyMe}>
                {notified ? "We'll notify you" : "Notify Me When a Better Match Opens"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronDown, Users } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useRealRounds } from "../context/RealRoundsContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import type { TranslationKey } from "../i18n/locales/en";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { GAME_FORMATS, GOLF_VIBES } from "../types";
import type { GameFormat, GolfVibe, Holes, JoinMode, SkillFilter, WalkOrCart } from "../types";
import { CourseAutocomplete } from "../components/golfcall/CourseAutocomplete";
import { inputClass, labelClass } from "../components/ui/FormControls";
import { formatDate, formatMoney } from "../lib/format";
import { skillLabel, vibeLabel } from "../lib/enumLabels";
import { getWeekendRange } from "../lib/greeting";
import { skillTierFromHandicap } from "../lib/format";
import { coordsForCourse } from "../lib/courses";
import { haversineMiles } from "../lib/geo";
import { track } from "../lib/analytics";

const SKILL_OPTIONS: SkillFilter[] = ["Any Skill Level", "Beginner", "Intermediate", "Advanced"];
const WALK_OPTIONS: WalkOrCart[] = ["Either", "Walking", "Cart"];
type LookingFor = "anyone" | "similar" | "custom";
type WhenChoice = "today" | "tomorrow" | "weekend" | "date";

const WHEN_OPTIONS: { value: WhenChoice; labelKey: "filters.today" | "filters.tomorrow" | "filters.thisWeekend" | "filters.chooseDate" }[] = [
  { value: "today", labelKey: "filters.today" },
  { value: "tomorrow", labelKey: "filters.tomorrow" },
  { value: "weekend", labelKey: "filters.thisWeekend" },
  { value: "date", labelKey: "filters.chooseDate" },
];

const TOTAL_STEPS = 5;
const STEP_TITLE_KEYS: Record<number, TranslationKey> = {
  1: "host.step1Title",
  2: "host.step2Title",
  3: "host.step3Title",
  4: "host.step4Title",
  5: "host.step5Title",
};

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function prefillDateFromWhen(when: string | null, dateParam: string | null): string {
  if (when === "date" && dateParam) return dateParam;
  if (when === "today") return toDateInputValue(new Date());
  if (when === "tomorrow") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return toDateInputValue(d);
  }
  if (when === "weekend") return toDateInputValue(getWeekendRange().start);
  return "";
}

export function CreateGolfCall() {
  const navigate = useNavigate();
  const { currentUser, golfCalls, createGolfCall, visibleGolfers, circleGolfers, attachGolfCallToPost } = useData();
  const { isDemo } = useAuth();
  const { hostRound } = useRealRounds();
  const { showToast } = useToast();
  const { t, locale } = useLocale();
  const [searchParams] = useSearchParams();
  const fromPostId = searchParams.get("fromPost");

  const [step, setStep] = useState(1);
  // Fill My Foursome (pre-inviting specific players at creation time) needs
  // a real Golf Circle/Following to invite by id, which doesn't exist yet —
  // real hosting this phase is "Starting Fresh" only. Demo mode keeps both.
  const [fillMode, setFillMode] = useState(isDemo && searchParams.get("mode") === "fill");
  const [course, setCourse] = useState(() => searchParams.get("course") ?? "");
  const [pickedCourseId, setPickedCourseId] = useState<string | null>(null);
  const [pickedCourseLat, setPickedCourseLat] = useState<number | null>(null);
  const [pickedCourseLng, setPickedCourseLng] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [areaLabel, setAreaLabel] = useState(() => currentUser.areaLabel);
  const [editingArea, setEditingArea] = useState(false);
  // "" is a valid mid-edit state — never coerced to 0 until handleSubmit, so
  // an intentional 0 can't get stuck un-clearable.
  const [distanceMiles, setDistanceMiles] = useState<number | "">(5);
  const [when, setWhen] = useState<WhenChoice>(
    () => (searchParams.get("when") as WhenChoice | null) ?? (searchParams.get("date") ? "date" : "today"),
  );
  // Derived from the resolved `when` above (not the raw URL param) so the
  // default "Today" pill and the actual date value always agree — the URL
  // param is absent on a plain visit, but `when` still resolves to "today".
  const [date, setDate] = useState(() => prefillDateFromWhen(when, searchParams.get("date")));
  const [timeLabel, setTimeLabel] = useState("");
  const [price, setPrice] = useState<number | "">(50);
  const [totalSpots, setTotalSpots] = useState(4);
  const [joinMode, setJoinMode] = useState<JoinMode>("instant");
  const [lookingFor, setLookingFor] = useState<LookingFor>("anyone");
  const [skillLevel, setSkillLevel] = useState<SkillFilter>("Any Skill Level");
  const [vibe, setVibe] = useState<GolfVibe>("Casual & Social");
  const [walkOrCart, setWalkOrCart] = useState<WalkOrCart>("Either");
  const [holes, setHoles] = useState<Holes>(18);
  const [gameFormat, setGameFormat] = useState<GameFormat>("Standard Stroke Play");
  const [notes, setNotes] = useState("");
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const maxFriends = Math.max(0, totalSpots - 2); // leave room for host + at least 1 open spot
  const openSpotsRemaining = totalSpots - 1 - friendIds.length;

  // Guards the ?mode=fill deep-link case too, not just the in-page toggle.
  useEffect(() => {
    if (!isDemo && fillMode) setFillMode(false);
  }, [isDemo, fillMode]);

  const recentCourses = useMemo(() => {
    const mine = golfCalls
      .filter((c) => c.joinedGolferIds.includes(currentUser.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const seen = new Set<string>();
    const names: string[] = [];
    for (const c of mine) {
      if (seen.has(c.course)) continue;
      seen.add(c.course);
      names.push(c.course);
      if (names.length >= 3) break;
    }
    return names;
  }, [golfCalls, currentUser.id]);

  const userLocation = { label: currentUser.areaLabel, coords: currentUser.playingAreaCoords };

  function handleCourseChange(value: string) {
    setCourse(value);
    setPickedCourseId(null);
    setPickedCourseLat(null);
    setPickedCourseLng(null);
  }

  function handlePickKnownCourse(pick: { name: string; area?: string; id?: string; lat?: number; lng?: number }) {
    if (pick.area) setAreaLabel(pick.area);
    setPickedCourseId(pick.id ?? null);
    setPickedCourseLat(pick.lat ?? null);
    setPickedCourseLng(pick.lng ?? null);
    // Real (Geoapify-backed) picks already carry their own coords; demo
    // picks still resolve distance from the static fixture, same as before.
    const courseCoords = pick.lat != null && pick.lng != null ? { lat: pick.lat, lng: pick.lng } : coordsForCourse(pick.name);
    if (courseCoords && currentUser.playingAreaCoords) {
      setDistanceMiles(Math.round(haversineMiles(currentUser.playingAreaCoords, courseCoords)));
    }
  }

  function pickWhen(next: WhenChoice) {
    setWhen(next);
    if (next !== "date") setDate(prefillDateFromWhen(next, null));
  }

  const otherGolfers = useMemo(() => visibleGolfers(), [visibleGolfers]);
  const circleIds = useMemo(() => new Set(circleGolfers.map((g) => g.id)), [circleGolfers]);
  const nonCircleGolfers = useMemo(() => otherGolfers.filter((g) => !circleIds.has(g.id)), [otherGolfers, circleIds]);

  const effectiveSkillLevel: SkillFilter = fillMode
    ? lookingFor === "anyone"
      ? "Any Skill Level"
      : lookingFor === "similar"
        ? skillTierFromHandicap(currentUser.handicap)
        : skillLevel
    : skillLevel;

  function toggleFriend(id: string) {
    setFriendIds((prev) => {
      if (prev.includes(id)) return prev.filter((f) => f !== id);
      if (prev.length >= maxFriends) return prev;
      return [...prev, id];
    });
  }

  const step1Valid = Boolean(course.trim() && areaLabel.trim());
  const step2Valid = Boolean(date && timeLabel.trim());
  const step3Valid = !fillMode || openSpotsRemaining >= 1;
  const canSubmit = step1Valid && step2Valid && step3Valid;

  function goNext() {
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  }

  function goBack() {
    if (step === 1) {
      navigate(-1);
      return;
    }
    setStep((s) => s - 1);
  }

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    const dateISO = new Date(`${date}T12:00:00`).toISOString();

    if (isDemo) {
      const call = createGolfCall({
        course: course.trim(),
        areaLabel: areaLabel.trim(),
        distanceMiles: distanceMiles === "" ? 0 : distanceMiles,
        dateISO,
        timeLabel: timeLabel.trim(),
        estimatedPricePerPerson: price === "" ? 0 : price,
        totalSpots,
        joinMode,
        skillLevel: effectiveSkillLevel,
        vibe,
        walkOrCart,
        holes,
        gameFormat,
        notes: notes.trim() || undefined,
        additionalJoinedGolferIds: fillMode ? friendIds : undefined,
      });
      if (fromPostId) attachGolfCallToPost(fromPostId, call.id).catch((err) => console.error("Golf Me: failed to attach round to post.", err));
      track("first_round_hosted");
      showToast(fillMode ? t("host.postedFillToast") : t("host.postedFreshToast"), "success");
      navigate(fromPostId ? `/community/${fromPostId}` : `/golf-calls/${call.id}`);
      return;
    }

    setSubmitting(true);
    try {
      const call = await hostRound({
        courseId: pickedCourseId,
        courseName: course.trim(),
        courseAreaLabel: areaLabel.trim(),
        courseLat: pickedCourseLat,
        courseLng: pickedCourseLng,
        dateISO,
        timeLabel: timeLabel.trim(),
        holes,
        gameFormat,
        estimatedPricePerPerson: price === "" ? null : price,
        totalSpots,
        skillLevel: effectiveSkillLevel,
        vibe,
        walkOrCart,
        notes: notes.trim() || undefined,
      });
      track("first_round_hosted");
      showToast(t("host.postedFreshToast"), "success");
      navigate(`/golf-calls/${call.id}`);
    } catch (err) {
      setSubmitting(false);
      showToast(err instanceof Error ? err.message : "Couldn't post this round. Please try again.", "warning");
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={goBack}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{fillMode ? t("host.titleFill") : t("host.titleFresh")}</h1>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("host.step", { step, total: TOTAL_STEPS })}</p>
        <p className="mt-0.5 text-base font-bold text-slate-800">{t(STEP_TITLE_KEYS[step])}</p>
      </div>

      {step === 1 && (
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-4">
          <CourseAutocomplete
            value={course}
            onChange={handleCourseChange}
            onPickKnownCourse={handlePickKnownCourse}
            recentCourses={recentCourses}
            preferredCourses={currentUser.preferredCourses}
            location={userLocation}
          />
          {course.trim() && (
            <div className="rounded-xl bg-slate-50/60 px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  {t("host.playingArea")}: <span className="font-semibold text-slate-800">{areaLabel || t("host.notSet")}</span>
                  {distanceMiles !== "" && <span className="text-slate-400"> · {distanceMiles} mi</span>}
                </p>
                <button
                  onClick={() => setEditingArea((v) => !v)}
                  className="shrink-0 text-xs font-semibold text-fairway-700 hover:underline"
                >
                  {editingArea ? t("common.done") : t("common.edit")}
                </button>
              </div>
              {editingArea && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>{t("host.generalArea")}</label>
                    <input className={inputClass} value={areaLabel} onChange={(e) => setAreaLabel(e.target.value)} placeholder={t("host.areaPlaceholder")} />
                  </div>
                  <div>
                    <label className={labelClass}>{t("host.distanceFromYou")}</label>
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={distanceMiles}
                      onChange={(e) => setDistanceMiles(e.target.value === "" ? "" : Number(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-4">
          <div>
            <label className={labelClass}>{t("filters.when")}</label>
            <div className="flex flex-wrap gap-1.5">
              {WHEN_OPTIONS.map((opt) => (
                <Pill key={opt.value} active={when === opt.value} onClick={() => pickWhen(opt.value)}>
                  {t(opt.labelKey)}
                </Pill>
              ))}
            </div>
            {when === "date" && (
              <input type="date" className={`${inputClass} mt-2 w-full`} value={date} onChange={(e) => setDate(e.target.value)} />
            )}
          </div>
          <div>
            <label className={labelClass}>{t("host.tellUsWhenTeeTime")}</label>
            <input className={inputClass} value={timeLabel} onChange={(e) => setTimeLabel(e.target.value)} placeholder="e.g. 10:00 AM" />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-4">
          {isDemo && (
            <div className="flex gap-2">
              <button
                onClick={() => setFillMode(false)}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 ${
                  !fillMode ? "border-fairway-400 bg-fairway-50 text-fairway-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {t("host.startingFresh")}
              </button>
              <button
                onClick={() => setFillMode(true)}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 ${
                  fillMode ? "border-fairway-400 bg-fairway-50 text-fairway-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {t("host.alreadyHavePlayers")}
              </button>
            </div>
          )}

          <div>
            <label className={labelClass}>{fillMode ? t("host.totalPlayersInGroup") : t("host.totalSpots")}</label>
            <select className={inputClass} value={totalSpots} onChange={(e) => setTotalSpots(Number(e.target.value))}>
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {t("host.playersCountOption", { count: n })}
                </option>
              ))}
            </select>
          </div>

          {fillMode && (
            <>
              <div>
                <label className={labelClass}>{t("host.yourGroup")}</label>
                <p className="mb-2 text-xs text-slate-500">
                  {maxFriends === 1 ? t("host.pickUpToPlayer") : t("host.pickUpToPlayers", { max: maxFriends })}
                </p>
                <div className="flex flex-col gap-3">
                  {circleGolfers.length > 0 && (
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fairway-700">
                        <Users size={12} /> {t("host.yourGolfCircle")}
                      </p>
                      <div className="flex flex-col gap-1">
                        {circleGolfers.map((g) => (
                          <FriendRow
                            key={g.id}
                            golferId={g.id}
                            name={g.name}
                            handicap={g.handicap}
                            avatar={g}
                            checked={friendIds.includes(g.id)}
                            disabled={!friendIds.includes(g.id) && friendIds.length >= maxFriends}
                            onToggle={toggleFriend}
                            circle
                            newGolferLabel={t("host.newGolfer")}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    {circleGolfers.length > 0 && <p className="mb-1.5 text-xs font-semibold text-slate-500">{t("host.otherGolfers")}</p>}
                    <div className="flex flex-col gap-1">
                      {nonCircleGolfers.map((g) => (
                        <FriendRow
                          key={g.id}
                          golferId={g.id}
                          name={g.name}
                          handicap={g.handicap}
                          avatar={g}
                          checked={friendIds.includes(g.id)}
                          disabled={!friendIds.includes(g.id) && friendIds.length >= maxFriends}
                          onToggle={toggleFriend}
                          newGolferLabel={t("host.newGolfer")}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div
                className={`rounded-xl px-4 py-3 text-center font-bold ${
                  openSpotsRemaining >= 1 ? "bg-sun-100 text-sun-700" : "bg-red-50 text-red-600"
                }`}
              >
                {openSpotsRemaining >= 1
                  ? openSpotsRemaining === 1
                    ? t("host.playerNeeded")
                    : t("host.playersNeeded", { count: openSpotsRemaining })
                  : t("host.pickFewer")}
              </div>

              <div>
                <label className={labelClass}>{t("host.lookingFor")}</label>
                <div className="flex flex-wrap gap-1.5">
                  <Pill active={lookingFor === "anyone"} onClick={() => setLookingFor("anyone")}>
                    {t("host.anyone")}
                  </Pill>
                  <Pill active={lookingFor === "similar"} onClick={() => setLookingFor("similar")}>
                    {t("host.similarHandicap")}
                  </Pill>
                  <Pill active={lookingFor === "custom"} onClick={() => setLookingFor("custom")}>
                    {t("host.custom")}
                  </Pill>
                </div>
                {lookingFor === "custom" && (
                  <select className={`${inputClass} mt-2`} value={skillLevel} onChange={(e) => setSkillLevel(e.target.value as SkillFilter)}>
                    {SKILL_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {skillLabel(s, t)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-4">
          <div>
            <label className={labelClass}>{t("host.holes")}</label>
            <div className="flex gap-2">
              <Pill active={holes === 9} onClick={() => setHoles(9)} className="flex-1 py-2 text-center">
                9 {t("host.holes")}
              </Pill>
              <Pill active={holes === 18} onClick={() => setHoles(18)} className="flex-1 py-2 text-center">
                18 {t("host.holes")}
              </Pill>
            </div>
          </div>

          <div>
            <label className={labelClass}>{t("host.gameFormat")}</label>
            <div className="flex flex-wrap gap-1.5">
              {GAME_FORMATS.map((g) => (
                <Pill key={g} active={gameFormat === g} onClick={() => setGameFormat(g)}>
                  {g}
                </Pill>
              ))}
            </div>
          </div>

          <div>
            <label className={labelClass}>{t("host.estimatedPrice")}</label>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={price}
              onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>

          <div>
            <label className={labelClass}>{t("host.vibe")}</label>
            <div className="flex flex-wrap gap-1.5">
              {GOLF_VIBES.map((v) => (
                <Pill key={v} active={vibe === v} onClick={() => setVibe(v)}>
                  {vibeLabel(v, t)}
                </Pill>
              ))}
            </div>
          </div>

          <div>
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800"
            >
              <ChevronDown size={15} className={`transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`} />
              {showAdvanced ? t("host.hideAdvancedPreferences") : t("host.advancedPreferences")}
            </button>
            {showAdvanced && (
              <div className="mt-3 flex flex-col gap-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
                {!fillMode && (
                  <div>
                    <label className={labelClass}>{t("host.preferredSkillLevel")}</label>
                    <select className={inputClass} value={skillLevel} onChange={(e) => setSkillLevel(e.target.value as SkillFilter)}>
                      {SKILL_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className={labelClass}>{t("filters.walkingOrCart")}</label>
                  <div className="flex gap-2">
                    {WALK_OPTIONS.map((w) => (
                      <Pill key={w} active={walkOrCart === w} onClick={() => setWalkOrCart(w)} className="flex-1 py-2 text-center">
                        {w}
                      </Pill>
                    ))}
                  </div>
                </div>
                {!fillMode && isDemo && (
                  <div>
                    <label className={labelClass}>{t("host.howShouldPeopleJoin")}</label>
                    <div className="flex gap-2">
                      <Pill active={joinMode === "instant"} onClick={() => setJoinMode("instant")} className="flex-1 py-2 text-center">
                        {t("host.instantJoin")}
                      </Pill>
                      <Pill active={joinMode === "request"} onClick={() => setJoinMode("request")} className="flex-1 py-2 text-center">
                        {t("host.requestToJoin")}
                      </Pill>
                    </div>
                  </div>
                )}
                <div>
                  <label className={labelClass}>{fillMode ? t("host.messageToGroup") : t("host.notes")}</label>
                  <textarea
                    className={inputClass}
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={fillMode ? t("host.notesPlaceholderFill") : t("host.notesPlaceholderFresh")}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-4">
          <div>
            <p className="text-base font-bold text-slate-900">{course}</p>
            <p className="text-sm text-slate-500">{areaLabel}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="fairway">
              {formatDate(new Date(`${date}T12:00:00`).toISOString(), locale, t)} · {timeLabel}
            </Badge>
            <Badge tone="outline">
              {holes} {t("host.holes")}
            </Badge>
            <Badge tone="outline">{gameFormat}</Badge>
            <Badge tone={vibe === "Competitive" ? "sun" : "fairway"}>{vibe}</Badge>
            <Badge tone="outline">{formatMoney(price === "" ? 0 : price)}/person</Badge>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("host.players")}</p>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <Avatar golfer={currentUser} size="xs" showVerified={false} />
                <span className="font-semibold">{currentUser.name}</span>
                <span className="text-xs text-slate-400">{t("host.hostLabel")}</span>
              </div>
              {fillMode &&
                friendIds.map((id) => {
                  const g = [...circleGolfers, ...otherGolfers].find((golfer) => golfer.id === id);
                  if (!g) return null;
                  return (
                    <div key={id} className="flex items-center gap-2 text-sm text-slate-700">
                      <Avatar golfer={g} size="xs" showVerified={false} />
                      <span className="font-semibold">{g.name}</span>
                    </div>
                  );
                })}
            </div>
            <p className="mt-2 text-xs font-medium text-slate-500">
              {(() => {
                const openSpots = totalSpots - 1 - (fillMode ? friendIds.length : 0);
                return openSpots === 1 ? t("host.openSpotToFill") : t("host.openSpotsToFill", { count: openSpots });
              })()}
            </p>
          </div>
        </div>
      )}

      {step < TOTAL_STEPS ? (
        <Button
          disabled={step === 1 ? !step1Valid : step === 2 ? !step2Valid : step === 3 ? !step3Valid : false}
          onClick={goNext}
          size="lg"
          icon={<ArrowRight size={18} />}
          className="flex-row-reverse"
        >
          {t("common.next")}
        </Button>
      ) : (
        <Button disabled={!canSubmit || submitting} onClick={handleSubmit} size="lg" icon={<ArrowRight size={18} />} className="flex-row-reverse">
          {fillMode ? t("host.postOpenSpot") : t("host.postRound")}
        </Button>
      )}
    </div>
  );
}

function FriendRow({
  golferId,
  name,
  handicap,
  avatar,
  checked,
  disabled,
  onToggle,
  circle,
  newGolferLabel,
}: {
  golferId: string;
  name: string;
  handicap: number | null;
  avatar: Parameters<typeof Avatar>[0]["golfer"];
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
  circle?: boolean;
  newGolferLabel: string;
}) {
  return (
    <label
      className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-all duration-200 ease-out ${
        checked ? "border-fairway-400 bg-fairway-50" : disabled ? "border-slate-100 opacity-50" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <input type="checkbox" checked={checked} disabled={disabled && !checked} onChange={() => onToggle(golferId)} className="h-4 w-4 accent-fairway-600" />
      <Avatar golfer={avatar} size="xs" showVerified={false} />
      <span className="flex-1 font-medium text-slate-800">{name}</span>
      <span className="text-xs text-slate-500">{handicap !== null ? `${handicap} HCP` : newGolferLabel}</span>
      {circle && <Badge tone="fairway">Circle</Badge>}
    </label>
  );
}

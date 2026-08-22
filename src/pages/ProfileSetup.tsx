import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, LocateFixed, MapPin } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Slider } from "../components/ui/Slider";
import { AvatarUpload } from "../components/profile/AvatarUpload";
import { LocationPicker } from "../components/location/LocationPicker";
import { inputClass, labelClass } from "../components/ui/FormControls";
import { BUDGET_PREF_MAX, BUDGET_PREF_MIN, GENDER_OPTIONS, GOLF_VIBES, TRAVEL_RADIUS_MAX, TRAVEL_RADIUS_MIN } from "../types";
import type { GolfVibe, RoundLengthPreference, WalkOrCart } from "../types";
import { vibeLabel, walkOrCartLabel } from "../lib/enumLabels";
import { initialsFromName, avatarColorForName } from "../lib/avatar";
import { formatBudgetValue, formatDistanceValue, TRAVEL_RADIUS_PRESETS } from "../lib/matchPreferences";
import { useNearbyCourses } from "../lib/useCourseSearch";
import { CourseSearchStatus } from "../components/ui/CourseSearchStatus";
import type { GeoPoint } from "../lib/geo";
import { track } from "../lib/analytics";
import { clearOnboardingDraft, loadOnboardingDraft, saveOnboardingDraft } from "../lib/onboardingDraft";
import type { OnboardingDraft, RoundLengthChoice, SkillBand } from "../lib/onboardingDraft";
import type { TranslationKey } from "../i18n/locales/en";

const SKILL_HANDICAP: Record<SkillBand, number> = { Beginner: 22, Intermediate: 14, Advanced: 6 };
const SKILL_BANDS: SkillBand[] = ["Beginner", "Intermediate", "Advanced"];
const WALK_OPTIONS: WalkOrCart[] = ["Walking", "Cart", "Either"];
const NEARBY_RADIUS_MILES = 30;
const STEP_LABEL_KEYS: TranslationKey[] = [
  "profileSetup.stepYou",
  "profileSetup.stepYourGolf",
  "profileSetup.stepWhereYouPlay",
  "profileSetup.stepHowYouPlay",
];

function draftDefaults(): OnboardingDraft {
  return {
    step: 0,
    name: "",
    is18Plus: false,
    gender: "",
    customGender: false,
    areaLabel: "",
    playingAreaCoords: undefined,
    favoriteCourse: "",
    hasHandicap: true,
    handicap: 15,
    skillBand: "Intermediate",
    vibes: ["Casual & Social"],
    walkOrCart: "Either",
    budget: 60,
    travelRadiusMiles: 25,
    roundLength: "either",
  };
}

export function ProfileSetup() {
  const navigate = useNavigate();
  const { signUpNewGolfer } = useData();
  const { isDemo, saveProfile } = useAuth();
  const { showToast } = useToast();
  const { t } = useLocale();
  const [submitting, setSubmitting] = useState(false);

  const initial = loadOnboardingDraft() ?? draftDefaults();
  const [step, setStep] = useState(initial.step);

  const [name, setName] = useState(initial.name);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [is18Plus, setIs18Plus] = useState(initial.is18Plus);
  const [gender, setGender] = useState(initial.gender);
  const [customGender, setCustomGender] = useState(initial.customGender);

  const [areaLabel, setAreaLabel] = useState(initial.areaLabel);
  const [playingAreaCoords, setPlayingAreaCoords] = useState<GeoPoint | undefined>(initial.playingAreaCoords);
  const [favoriteCourse, setFavoriteCourse] = useState(initial.favoriteCourse);
  const [locationPickerMode, setLocationPickerMode] = useState<"none" | "auto" | "manual">("none");

  const [hasHandicap, setHasHandicap] = useState(initial.hasHandicap);
  const [handicap, setHandicap] = useState<number | "">(initial.handicap);
  const [skillBand, setSkillBand] = useState<SkillBand>(initial.skillBand);

  const [vibes, setVibes] = useState<GolfVibe[]>(initial.vibes);
  const [walkOrCart, setWalkOrCart] = useState<WalkOrCart>(initial.walkOrCart);
  const [budget, setBudget] = useState<number | "">(initial.budget);
  const [travelRadiusMiles, setTravelRadiusMiles] = useState(initial.travelRadiusMiles);
  const [roundLength, setRoundLength] = useState<RoundLengthChoice>(initial.roundLength);

  // Persist a resumable draft on every change (not photoUrl — a data-URL
  // image would bloat localStorage for a draft that might never be
  // finished; a golfer who abandons and returns just re-picks a photo).
  useEffect(() => {
    saveOnboardingDraft({
      step,
      name,
      is18Plus,
      gender,
      customGender,
      areaLabel,
      playingAreaCoords,
      favoriteCourse,
      hasHandicap,
      handicap,
      skillBand,
      vibes,
      walkOrCart,
      budget,
      travelRadiusMiles,
      roundLength,
    });
  }, [step, name, is18Plus, gender, customGender, areaLabel, playingAreaCoords, favoriteCourse, hasHandicap, handicap, skillBand, vibes, walkOrCart, budget, travelRadiusMiles, roundLength]);

  function toggleVibe(v: GolfVibe) {
    setVibes((prev) => {
      if (prev.includes(v)) return prev.filter((x) => x !== v);
      if (prev.length >= 2) return prev;
      return [...prev, v];
    });
  }

  const nearbyState = useNearbyCourses(playingAreaCoords ? { label: areaLabel, coords: playingAreaCoords } : undefined, NEARBY_RADIUS_MILES);
  const nearbyCourses = nearbyState.results.slice(0, 3).map((c) => c.name);

  const stepValid = [Boolean(name.trim()) && is18Plus, true, Boolean(areaLabel.trim()), vibes.length > 0][step];

  async function next() {
    if (!stepValid || submitting) return;
    if (step < STEP_LABEL_KEYS.length - 1) {
      setStep((s) => s + 1);
      return;
    }
    const finalHandicap = handicap === "" ? 0 : handicap;
    const finalBudget = budget === "" ? 0 : budget;
    const roundLengthPreference: RoundLengthPreference = roundLength === "9" ? "9 Holes" : roundLength === "18" ? "18 Holes" : "No Preference";

    if (isDemo) {
      signUpNewGolfer({
        name: name.trim(),
        photoUrl,
        ageRange: "25-34",
        gender: gender.trim() || "Prefer not to say",
        areaLabel: areaLabel.trim(),
        playingAreaCoords,
        handicap: hasHandicap ? finalHandicap : SKILL_HANDICAP[skillBand],
        vibes,
        walkOrCart,
        budgetMin: Math.max(0, finalBudget - 15),
        budgetMax: finalBudget + 15,
        favoriteCourses: favoriteCourse ? [favoriteCourse] : [],
        preferredCourses: [],
        travelRadiusMiles,
        roundLengthPreference,
      });
    } else {
      // Real account: the auth identity already exists (Google/email sign-in
      // happened before this wizard could even be reached — see App.tsx's
      // route guards), so this writes into that existing profiles row
      // instead of minting a new mock golfer. Avatar upload isn't wired to
      // Supabase Storage yet (that's a later phase) — photoUrl stays local-
      // only for real accounts for now, never written as a data-URL.
      setSubmitting(true);
      try {
        await saveProfile({
          name: name.trim(),
          avatar_color: avatarColorForName(name),
          avatar_initials: initialsFromName(name),
          age_range: "25-34",
          gender: gender.trim() || "Prefer not to say",
          area_label: areaLabel.trim(),
          playing_area_lat: playingAreaCoords?.lat ?? null,
          playing_area_lng: playingAreaCoords?.lng ?? null,
          handicap: hasHandicap ? finalHandicap : null,
          skill_level: hasHandicap ? null : skillBand,
          vibes,
          walk_or_cart: walkOrCart,
          budget_min: Math.max(0, finalBudget - 15),
          budget_max: finalBudget + 15,
          favorite_courses: favoriteCourse ? [favoriteCourse] : [],
          travel_radius_miles: travelRadiusMiles,
          round_length_preference: roundLengthPreference,
          has_onboarded: true,
        });
      } catch (err) {
        setSubmitting(false);
        showToast(err instanceof Error ? err.message : t("auth.authError"), "warning");
        return;
      }
    }

    clearOnboardingDraft();
    track("profile_basic_completed");
    // Deferred one tick, verified against real behavior (not a hypothetical
    // guard): the session flips to onboarded synchronously above, but
    // react-router-dom's own internal location state doesn't update in the
    // same commit as a navigate() call made from the same handler. GuestOnly
    // (still wrapping this /profile-setup route in that stale render) sees
    // the new state against its OLD location and fires its own `replace`
    // redirect to "/" — which, calling history.replaceState AFTER this
    // navigate's pushState, wins and strands the user on Home instead of
    // /ready. Pushing this navigate to a macrotask lets that stale render
    // (and GuestOnly's redirect) fully settle first, so this call is
    // guaranteed to be the last history write.
    setTimeout(() => navigate("/ready"), 0);
  }

  function handleLocationSelected(area: { label: string; coords?: GeoPoint }) {
    setAreaLabel(area.label);
    setPlayingAreaCoords(area.coords);
    setLocationPickerMode("none");
    track("location_selected", { hasCoords: Boolean(area.coords) });
  }

  return (
    // Fixed to the real visible viewport (dvh, not vh/min-h-screen -- mobile
    // Safari's 100vh includes space the collapsible address bar is actually
    // covering, which was exactly why a short step's Continue button needed
    // a scroll to reach even though its content alone fit on screen). The
    // step content scrolls independently in the middle; the button stays a
    // non-shrinking footer, always reachable without hunting for it,
    // however long a given step's content gets.
    <div className="flex h-[100dvh] flex-col bg-[#faf9f6]">
      <div className="flex items-center justify-between px-6 pt-8">
        <button
          onClick={() => (step === 0 ? navigate(-1) : setStep((s) => s - 1))}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> {t("common.back")}
        </button>
        <div className="flex gap-1.5">
          {STEP_LABEL_KEYS.map((_, i) => (
            <span key={i} className={`h-1.5 w-5 rounded-full transition-colors duration-300 ${i <= step ? "bg-fairway-600" : "bg-slate-200"}`} />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6">
        <div className="flex flex-col gap-5 py-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fairway-600">{t("host.step", { step: step + 1, total: STEP_LABEL_KEYS.length })}</p>
          <h1 className="text-xl font-bold text-slate-900">{t(STEP_LABEL_KEYS[step])}</h1>
        </div>

        {step === 0 && (
          <div className="flex flex-col gap-4">
            <AvatarUpload
              golfer={{
                photoUrl,
                avatarColor: name.trim() ? avatarColorForName(name) : "from-slate-300 to-slate-400",
                avatarInitials: name.trim() ? initialsFromName(name) : "?",
                verification: { phoneVerified: false, emailVerified: false, verifiedGolfer: false },
              }}
              onChange={setPhotoUrl}
            />
            <div>
              <label className={labelClass}>{t("profileSetup.name")}</label>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("profileSetup.namePlaceholder")} />
            </div>
            <div>
              <label className={labelClass}>{t("profileSetup.genderOptional")}</label>
              <div className="flex flex-wrap gap-1.5">
                {GENDER_OPTIONS.map((g) => (
                  <Pill
                    key={g}
                    active={!customGender && gender === g}
                    onClick={() => {
                      setGender(g);
                      setCustomGender(false);
                    }}
                  >
                    {g}
                  </Pill>
                ))}
                <Pill active={customGender} onClick={() => setCustomGender(true)}>
                  {t("host.custom")}
                </Pill>
              </div>
              {customGender && (
                <input
                  className={`${inputClass} mt-2`}
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  placeholder={t("profileSetup.genderCustomPlaceholder")}
                  autoFocus
                />
              )}
              <p className="mt-1 text-xs text-slate-400">{t("profileSetup.genderHelp")}</p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-3.5 py-3">
              <input type="checkbox" checked={is18Plus} onChange={() => setIs18Plus((v) => !v)} className="mt-0.5 h-4 w-4 accent-fairway-600" />
              <span className="text-sm text-slate-700">{t("profileSetup.confirm18")}</span>
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <button
                onClick={() => setHasHandicap(true)}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  hasHandicap ? "border-fairway-400 bg-fairway-50 text-fairway-700" : "border-slate-200 text-slate-600"
                }`}
              >
                {t("profileSetup.iHaveHandicap")}
              </button>
              <button
                onClick={() => setHasHandicap(false)}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  !hasHandicap ? "border-fairway-400 bg-fairway-50 text-fairway-700" : "border-slate-200 text-slate-600"
                }`}
              >
                {t("profileSetup.noHandicap")}
              </button>
            </div>
            {hasHandicap ? (
              <div>
                <label className={labelClass}>{t("profile.handicap")}</label>
                <input
                  type="number"
                  className={inputClass}
                  value={handicap}
                  onChange={(e) => setHandicap(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
            ) : (
              <div>
                <label className={labelClass}>{t("profileSetup.describeGame")}</label>
                <div className="flex gap-2">
                  {SKILL_BANDS.map((band) => (
                    <Pill key={band} active={skillBand === band} onClick={() => setSkillBand(band)} className="flex-1 py-2 text-center">
                      {band}
                    </Pill>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            {!areaLabel ? (
              <>
                <p className="text-sm font-bold text-slate-800">{t("profileSetup.locationTitle")}</p>
                <p className="-mt-2 text-sm text-slate-500">{t("profileSetup.locationBody")}</p>
                <Button variant="secondary" fullWidth icon={<LocateFixed size={16} />} onClick={() => setLocationPickerMode("auto")}>
                  {t("profileSetup.useMyLocation")}
                </Button>
                <Button variant="outline" fullWidth onClick={() => setLocationPickerMode("manual")}>
                  {t("profileSetup.chooseManually")}
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4">
                  <div className="flex items-center gap-2.5">
                    <MapPin size={16} className="shrink-0 text-fairway-600" />
                    <p className="text-sm font-semibold text-slate-800">{areaLabel}</p>
                  </div>
                  <button onClick={() => setLocationPickerMode("manual")} className="shrink-0 text-xs font-semibold text-fairway-700 hover:underline">
                    {t("common.change")}
                  </button>
                </div>
                <CourseSearchStatus loading={nearbyState.loading} error={nearbyState.error} onRetry={nearbyState.retry} />
                {nearbyCourses.length > 0 && (
                  <div>
                    <p className={labelClass}>{t("profileSetup.nearbyCourses")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {nearbyCourses.map((c) => (
                        <span key={c} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {nearbyCourses.length > 0 && (
                  <div>
                    <label className={labelClass}>{t("profileSetup.chooseFavoriteCourse")}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {nearbyCourses.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setFavoriteCourse((prev) => (prev === c ? "" : c))}
                          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
                            favoriteCourse === c ? "border-transparent bg-fairway-600 text-white" : "border-fairway-200 bg-fairway-50/70 text-fairway-700 hover:bg-fairway-100"
                          }`}
                        >
                          {favoriteCourse === c && <Check size={12} />}
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-5">
            <div>
              <label className={labelClass}>{t("matchPrefs.roundLength")}</label>
              <div className="flex gap-2">
                <Pill active={roundLength === "9"} onClick={() => setRoundLength("9")} className="flex-1 py-2 text-center">
                  {t("profileSetup.round9")}
                </Pill>
                <Pill active={roundLength === "18"} onClick={() => setRoundLength("18")} className="flex-1 py-2 text-center">
                  {t("profileSetup.round18")}
                </Pill>
                <Pill active={roundLength === "either"} onClick={() => setRoundLength("either")} className="flex-1 py-2 text-center">
                  {t("profileSetup.roundEither")}
                </Pill>
              </div>
            </div>
            <div>
              <label className={labelClass}>{t("matchPrefs.golfVibeUpTo2")}</label>
              <div className="flex flex-wrap gap-1.5">
                {GOLF_VIBES.map((v) => (
                  <Pill key={v} active={vibes.includes(v)} onClick={() => toggleVibe(v)}>
                    {vibeLabel(v, t)}
                  </Pill>
                ))}
              </div>
            </div>
            <div>
              <label className={labelClass}>{t("filters.walkingOrCart")}</label>
              <div className="flex gap-2">
                {WALK_OPTIONS.map((w) => (
                  <Pill key={w} active={walkOrCart === w} onClick={() => setWalkOrCart(w)} className="flex-1 py-2 text-center">
                    {walkOrCartLabel(w, t)}
                  </Pill>
                ))}
              </div>
            </div>
            <Slider
              label={t("profileSetup.typicalBudget")}
              min={BUDGET_PREF_MIN}
              max={BUDGET_PREF_MAX}
              step={10}
              value={budget === "" ? 0 : budget}
              onChange={setBudget}
              formatValue={formatBudgetValue}
            />
            <Slider
              label={t("profileSetup.travelDistance")}
              min={TRAVEL_RADIUS_MIN}
              max={TRAVEL_RADIUS_MAX}
              step={5}
              value={travelRadiusMiles}
              onChange={setTravelRadiusMiles}
              formatValue={formatDistanceValue}
              presets={TRAVEL_RADIUS_PRESETS}
            />
            <p className="text-xs text-slate-400">{t("profileSetup.optionalPreferencesNote")}</p>
          </div>
        )}
        </div>
      </div>

      <div className="shrink-0 px-6 pb-8 pt-3">
        <Button size="lg" fullWidth disabled={!stepValid || submitting} onClick={next}>
          {step === STEP_LABEL_KEYS.length - 1 ? t("profileSetup.startGolfing") : t("common.continue")}
        </Button>
      </div>

      {locationPickerMode !== "none" && (
        <LocationPicker
          title={t("profileSetup.locationTitle")}
          autoRequestLocation={locationPickerMode === "auto"}
          onSelect={handleLocationSelected}
          onClose={() => setLocationPickerMode("none")}
        />
      )}
    </div>
  );
}

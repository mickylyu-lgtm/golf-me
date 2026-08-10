import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin } from "lucide-react";
import { useData } from "../context/DataContext";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { AvatarUpload } from "../components/profile/AvatarUpload";
import { CoursePicker } from "../components/profile/CoursePicker";
import { RangeSlider } from "../components/ui/RangeSlider";
import { LocationPicker } from "../components/location/LocationPicker";
import { inputClass, labelClass } from "../components/ui/FormControls";
import { AGE_PREF_MAX, AGE_PREF_MIN, GENDER_OPTIONS, GENDER_PREFERENCES, GOLF_VIBES } from "../types";
import type { GenderPreference, GolfVibe, WalkOrCart, AvailabilitySlot } from "../types";
import { initialsFromName, avatarColorForName } from "../lib/avatar";
import { formatAgeValue } from "../lib/matchPreferences";
import type { GeoPoint } from "../lib/geo";

type SkillBand = "Beginner" | "Intermediate" | "Advanced";
const SKILL_HANDICAP: Record<SkillBand, number> = { Beginner: 22, Intermediate: 14, Advanced: 6 };
const SKILL_BANDS: SkillBand[] = ["Beginner", "Intermediate", "Advanced"];

type AvailabilityQuickPick = "Weekday mornings" | "Weekday afternoons" | "Weekends" | "Flexible";
const AVAILABILITY_PICKS: AvailabilityQuickPick[] = ["Weekday mornings", "Weekday afternoons", "Weekends", "Flexible"];
const PICK_TO_SLOTS: Record<AvailabilityQuickPick, AvailabilitySlot[]> = {
  "Weekday mornings": ["Weekday Mornings"],
  "Weekday afternoons": ["Weekday Afternoons"],
  Weekends: ["Weekend Mornings", "Weekend Afternoons", "Weekend Evenings"],
  Flexible: [
    "Weekday Mornings",
    "Weekday Afternoons",
    "Weekday Evenings",
    "Weekend Mornings",
    "Weekend Afternoons",
    "Weekend Evenings",
  ],
};

const WALK_OPTIONS: WalkOrCart[] = ["Walking", "Cart", "Either"];
const STEP_LABELS = ["Basics", "Your Golf", "How You Play", "Availability", "Preferences"];

export function ProfileSetup() {
  const navigate = useNavigate();
  const { signUpNewGolfer } = useData();
  const [step, setStep] = useState(0);

  // Step 1
  const [name, setName] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [is18Plus, setIs18Plus] = useState(false);
  const [areaLabel, setAreaLabel] = useState("");
  const [playingAreaCoords, setPlayingAreaCoords] = useState<GeoPoint | undefined>(undefined);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [gender, setGender] = useState("");
  const [customGender, setCustomGender] = useState(false);

  // Step 2
  const [hasHandicap, setHasHandicap] = useState(true);
  // "" is a valid mid-edit state (user cleared the field) — never coerce to
  // 0 while typing, only when building the final profile in next().
  const [handicap, setHandicap] = useState<number | "">(15);
  const [skillBand, setSkillBand] = useState<SkillBand>("Intermediate");

  // Step 3
  const [vibes, setVibes] = useState<GolfVibe[]>(["Casual & Social"]);
  const [walkOrCart, setWalkOrCart] = useState<WalkOrCart>("Either");
  const [budget, setBudget] = useState<number | "">(60);

  // Step 4
  const [picks, setPicks] = useState<AvailabilityQuickPick[]>([]);

  // Step 5 — optional match preferences
  const [preferredCourses, setPreferredCourses] = useState<string[]>([]);
  const [agePreferenceMin, setAgePreferenceMin] = useState(AGE_PREF_MIN);
  const [agePreferenceMax, setAgePreferenceMax] = useState(AGE_PREF_MAX);
  const [noAgePreference, setNoAgePreference] = useState(true);
  const [genderPreference, setGenderPreference] = useState<GenderPreference>("No preference");

  function toggleVibe(v: GolfVibe) {
    setVibes((prev) => {
      if (prev.includes(v)) return prev.filter((x) => x !== v);
      if (prev.length >= 2) return prev;
      return [...prev, v];
    });
  }

  function togglePick(p: AvailabilityQuickPick) {
    setPicks((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  const stepValid = [
    Boolean(name.trim()) && is18Plus && Boolean(areaLabel.trim()),
    true,
    vibes.length > 0,
    picks.length > 0,
    true,
  ][step];

  function next() {
    if (!stepValid) return;
    if (step < STEP_LABELS.length - 1) {
      setStep((s) => s + 1);
      return;
    }
    const availability = Array.from(new Set(picks.flatMap((p) => PICK_TO_SLOTS[p])));
    const finalHandicap = handicap === "" ? 0 : handicap;
    const finalBudget = budget === "" ? 0 : budget;
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
      availability,
      preferredCourses,
      travelRadiusMiles: 25,
      agePreferenceMin,
      agePreferenceMax,
      noAgePreference,
      genderPreference,
    });
    navigate("/");
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#faf8f2] px-6 py-8">
      <div className="flex items-center justify-between">
        <button
          onClick={() => (step === 0 ? navigate(-1) : setStep((s) => s - 1))}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex gap-1.5">
          {STEP_LABELS.map((_, i) => (
            <span key={i} className={`h-1.5 w-5 rounded-full transition-colors duration-300 ${i <= step ? "bg-fairway-600" : "bg-slate-200"}`} />
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 py-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fairway-600">
            Step {step + 1} of {STEP_LABELS.length}
          </p>
          <h1 className="text-xl font-bold text-slate-900">{STEP_LABELS[step]}</h1>
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
              <label className={labelClass}>Name</label>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Rivera" />
            </div>
            <div>
              <label className={labelClass}>Where do you usually play?</label>
              <button
                type="button"
                onClick={() => setLocationPickerOpen(true)}
                className={`${inputClass} flex items-center gap-2 text-left ${areaLabel ? "text-slate-800" : "text-slate-400"}`}
              >
                <MapPin size={15} className="shrink-0 text-fairway-600" />
                {areaLabel || "Use My Current Location or choose an area"}
              </button>
              <p className="mt-1 text-xs text-slate-400">General area only — we never ask for your exact home address.</p>
            </div>
            <div>
              <label className={labelClass}>Gender (optional)</label>
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
                  Custom
                </Pill>
              </div>
              {customGender && (
                <input
                  className={`${inputClass} mt-2`}
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  placeholder="How do you describe your gender?"
                  autoFocus
                />
              )}
              <p className="mt-1 text-xs text-slate-400">Self-reported only — never shared beyond your profile.</p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-3.5 py-3">
              <input type="checkbox" checked={is18Plus} onChange={() => setIs18Plus((v) => !v)} className="mt-0.5 h-4 w-4 accent-fairway-600" />
              <span className="text-sm text-slate-700">I confirm I am 18 years of age or older.</span>
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
                I have a handicap
              </button>
              <button
                onClick={() => setHasHandicap(false)}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  !hasHandicap ? "border-fairway-400 bg-fairway-50 text-fairway-700" : "border-slate-200 text-slate-600"
                }`}
              >
                I don't have a handicap
              </button>
            </div>
            {hasHandicap ? (
              <div>
                <label className={labelClass}>Handicap</label>
                <input
                  type="number"
                  className={inputClass}
                  value={handicap}
                  onChange={(e) => setHandicap(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
            ) : (
              <div>
                <label className={labelClass}>How would you describe your game?</label>
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
            <div>
              <label className={labelClass}>Golf vibe (up to 2)</label>
              <div className="flex flex-wrap gap-1.5">
                {GOLF_VIBES.map((v) => (
                  <Pill key={v} active={vibes.includes(v)} onClick={() => toggleVibe(v)}>
                    {v}
                  </Pill>
                ))}
              </div>
            </div>
            <div>
              <label className={labelClass}>Walking or cart</label>
              <div className="flex gap-2">
                {WALK_OPTIONS.map((w) => (
                  <Pill key={w} active={walkOrCart === w} onClick={() => setWalkOrCart(w)} className="flex-1 py-2 text-center">
                    {w}
                  </Pill>
                ))}
              </div>
            </div>
            <div>
              <label className={labelClass}>Typical budget per round</label>
              <input
                type="number"
                min={0}
                className={inputClass}
                value={budget}
                onChange={(e) => setBudget(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <label className={labelClass}>When can you usually play?</label>
            <div className="flex flex-col gap-2">
              {AVAILABILITY_PICKS.map((p) => (
                <label
                  key={p}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm font-medium transition-all duration-200 ${
                    picks.includes(p) ? "border-fairway-400 bg-fairway-50 text-fairway-700" : "border-slate-200 text-slate-600"
                  }`}
                >
                  <input type="checkbox" checked={picks.includes(p)} onChange={() => togglePick(p)} className="h-4 w-4 accent-fairway-600" />
                  {p}
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-slate-500">
              Totally optional — these help us find better rounds for you, but never hide a good round just because
              one preference doesn't match.
            </p>
            <div>
              <label className={labelClass}>Preferred courses</label>
              <CoursePicker selected={preferredCourses} onChange={setPreferredCourses} location={{ label: areaLabel, coords: playingAreaCoords }} />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className={labelClass + " mb-0"}>Age preference for playing partners</label>
                <Pill active={noAgePreference} onClick={() => setNoAgePreference((v) => !v)}>
                  No Age Preference
                </Pill>
              </div>
              <RangeSlider
                label="Age Range"
                min={AGE_PREF_MIN}
                max={AGE_PREF_MAX}
                step={1}
                valueMin={agePreferenceMin}
                valueMax={agePreferenceMax}
                onChangeMin={setAgePreferenceMin}
                onChangeMax={setAgePreferenceMax}
                formatValue={formatAgeValue}
                disabled={noAgePreference}
              />
            </div>
            <div>
              <label className={labelClass}>Gender preference for playing partners</label>
              <div className="flex flex-wrap gap-1.5">
                {GENDER_PREFERENCES.map((g) => (
                  <Pill key={g} active={genderPreference === g} onClick={() => setGenderPreference(g)}>
                    {g}
                  </Pill>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <Button size="lg" fullWidth disabled={!stepValid} onClick={next}>
        {step === STEP_LABELS.length - 1 ? "Start Golfing" : "Continue"}
      </Button>

      {locationPickerOpen && (
        <LocationPicker
          onSelect={(area) => {
            setAreaLabel(area.label);
            setPlayingAreaCoords(area.coords);
            setLocationPickerOpen(false);
          }}
          onClose={() => setLocationPickerOpen(false)}
        />
      )}
    </div>
  );
}

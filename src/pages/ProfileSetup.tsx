import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useData } from "../context/DataContext";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { inputClass, labelClass } from "../components/ui/FormControls";
import { GOLF_VIBES } from "../types";
import type { GolfVibe, WalkOrCart, AvailabilitySlot } from "../types";
import { initialsFromName, avatarColorForName } from "../lib/avatar";

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
const STEP_LABELS = ["Basics", "Your Golf", "How You Play", "Availability"];

export function ProfileSetup() {
  const navigate = useNavigate();
  const { signUpNewGolfer } = useData();
  const [step, setStep] = useState(0);

  // Step 1
  const [name, setName] = useState("");
  const [is18Plus, setIs18Plus] = useState(false);
  const [areaLabel, setAreaLabel] = useState("");

  // Step 2
  const [hasHandicap, setHasHandicap] = useState(true);
  const [handicap, setHandicap] = useState(15);
  const [skillBand, setSkillBand] = useState<SkillBand>("Intermediate");

  // Step 3
  const [vibes, setVibes] = useState<GolfVibe[]>(["Casual & Social"]);
  const [walkOrCart, setWalkOrCart] = useState<WalkOrCart>("Either");
  const [budget, setBudget] = useState(60);

  // Step 4
  const [picks, setPicks] = useState<AvailabilityQuickPick[]>([]);

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

  const stepValid = [Boolean(name.trim()) && is18Plus && Boolean(areaLabel.trim()), true, vibes.length > 0, picks.length > 0][step];

  function next() {
    if (!stepValid) return;
    if (step < 3) {
      setStep((s) => s + 1);
      return;
    }
    const availability = Array.from(new Set(picks.flatMap((p) => PICK_TO_SLOTS[p])));
    signUpNewGolfer({
      name: name.trim(),
      ageRange: "25-34",
      areaLabel: areaLabel.trim(),
      handicap: hasHandicap ? handicap : SKILL_HANDICAP[skillBand],
      vibes,
      walkOrCart,
      budgetMin: Math.max(0, budget - 15),
      budgetMax: budget + 15,
      availability,
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
            <span key={i} className={`h-1.5 w-6 rounded-full transition-colors duration-300 ${i <= step ? "bg-fairway-600" : "bg-slate-200"}`} />
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 py-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fairway-600">
            Step {step + 1} of 4
          </p>
          <h1 className="text-xl font-bold text-slate-900">{STEP_LABELS[step]}</h1>
        </div>

        {step === 0 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-lg font-bold text-white ${name.trim() ? avatarColorForName(name) : "from-slate-300 to-slate-400"}`}
              >
                {name.trim() ? initialsFromName(name) : "?"}
              </span>
              <p className="text-xs text-slate-500">
                Profile photo upload isn't available in this prototype — we'll use your initials instead.
              </p>
            </div>
            <div>
              <label className={labelClass}>Name</label>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Rivera" />
            </div>
            <div>
              <label className={labelClass}>General location</label>
              <input
                className={inputClass}
                value={areaLabel}
                onChange={(e) => setAreaLabel(e.target.value)}
                placeholder="e.g. Long Island, NY"
              />
              <p className="mt-1 text-xs text-slate-400">General area only — we never ask for your exact home address.</p>
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
                <input type="number" className={inputClass} value={handicap} onChange={(e) => setHandicap(Number(e.target.value))} />
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
              <input type="number" min={0} className={inputClass} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
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
      </div>

      <Button size="lg" fullWidth disabled={!stepValid} onClick={next}>
        {step === 3 ? "Start Golfing" : "Continue"}
      </Button>
    </div>
  );
}

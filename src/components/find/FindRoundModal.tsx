import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { inputClass } from "../ui/FormControls";
import { GOLF_VIBES } from "../../types";
import type { GolfVibe, SkillFilter, WalkOrCart } from "../../types";

export type WhenChoice = "today" | "tomorrow" | "weekend" | "date";
export type RadiusChoice = "10" | "25" | "50" | "custom";
export type IntentChoice = "join" | "need-players" | "either";

const WHEN_OPTIONS: { value: WhenChoice; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "weekend", label: "This weekend" },
  { value: "date", label: "Choose date" },
];

const RADIUS_OPTIONS: { value: RadiusChoice; label: string }[] = [
  { value: "10", label: "10 miles" },
  { value: "25", label: "25 miles" },
  { value: "50", label: "50 miles" },
  { value: "custom", label: "Custom" },
];

const INTENT_OPTIONS: { value: IntentChoice; label: string; hint: string }[] = [
  { value: "join", label: "Join an existing group", hint: "Find an open Golf Call with spots free." },
  { value: "need-players", label: "I already have friends and need more players", hint: "Fill your foursome instead." },
  { value: "either", label: "Either", hint: "Show me everything." },
];

const SKILL_OPTIONS: SkillFilter[] = ["Any Skill Level", "Beginner", "Intermediate", "Advanced"];
const WALK_OPTIONS: WalkOrCart[] = ["Either", "Walking", "Cart"];

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active ? "border-transparent bg-fairway-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-fairway-300"
      }`}
    >
      {children}
    </button>
  );
}

export function FindRoundModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();

  const [when, setWhen] = useState<WhenChoice>("today");
  const [customDate, setCustomDate] = useState("");
  const [radius, setRadius] = useState<RadiusChoice>("25");
  const [customRadius, setCustomRadius] = useState(35);
  const [intent, setIntent] = useState<IntentChoice>("either");
  const [showFilters, setShowFilters] = useState(false);
  const [budgetMax, setBudgetMax] = useState<number | "">("");
  const [skillLevel, setSkillLevel] = useState<SkillFilter | "">("");
  const [vibe, setVibe] = useState<GolfVibe | "">("");
  const [walkOrCart, setWalkOrCart] = useState<WalkOrCart | "">("");

  const radiusMiles = radius === "custom" ? customRadius : Number(radius);
  const canSubmit = when !== "date" || Boolean(customDate);

  function handleFindRound() {
    if (!canSubmit) return;

    if (intent === "need-players") {
      const params = new URLSearchParams({ mode: "fill", when, radius: String(radiusMiles) });
      if (when === "date" && customDate) params.set("date", customDate);
      navigate(`/golf-calls/new?${params.toString()}`);
      onClose();
      return;
    }

    const params = new URLSearchParams({ matched: "1", when, radius: String(radiusMiles), intent });
    if (when === "date" && customDate) params.set("date", customDate);
    if (budgetMax !== "") params.set("budgetMax", String(budgetMax));
    if (skillLevel) params.set("skill", skillLevel);
    if (vibe) params.set("vibe", vibe);
    if (walkOrCart) params.set("walk", walkOrCart);
    navigate(`/golf-calls?${params.toString()}`);
    onClose();
  }

  return (
    <Modal
      title="Find a round"
      onClose={onClose}
      footer={
        <Button size="lg" fullWidth disabled={!canSubmit} onClick={handleFindRound} icon={<ArrowRight size={18} />} className="flex-row-reverse">
          Find Me a Round
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-sm font-bold text-slate-800">When do you want to play?</p>
          <div className="flex flex-wrap gap-1.5">
            {WHEN_OPTIONS.map((opt) => (
              <Pill key={opt.value} active={when === opt.value} onClick={() => setWhen(opt.value)}>
                {opt.label}
              </Pill>
            ))}
          </div>
          {when === "date" && (
            <input type="date" className={`${inputClass} mt-2`} value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-bold text-slate-800">How far are you willing to travel?</p>
          <div className="flex flex-wrap gap-1.5">
            {RADIUS_OPTIONS.map((opt) => (
              <Pill key={opt.value} active={radius === opt.value} onClick={() => setRadius(opt.value)}>
                {opt.label}
              </Pill>
            ))}
          </div>
          {radius === "custom" && (
            <input
              type="number"
              min={1}
              className={`${inputClass} mt-2`}
              value={customRadius}
              onChange={(e) => setCustomRadius(Number(e.target.value))}
              placeholder="Miles"
            />
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-bold text-slate-800">What are you looking for?</p>
          <div className="flex flex-col gap-1.5">
            {INTENT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setIntent(opt.value)}
                className={`rounded-xl border px-3.5 py-2.5 text-left transition ${
                  intent === opt.value ? "border-fairway-400 bg-fairway-50" : "border-slate-200"
                }`}
              >
                <p className="text-sm font-semibold text-slate-800">{opt.label}</p>
                <p className="text-xs text-slate-500">{opt.hint}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <button onClick={() => setShowFilters((v) => !v)} className="text-sm font-semibold text-fairway-700 hover:underline">
            {showFilters ? "Hide optional filters" : "Add optional filters"}
          </button>
          {showFilters && (
            <div className="mt-3 flex flex-col gap-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Budget max ($/round)</label>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={budgetMax}
                  onChange={(e) => setBudgetMax(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="No limit"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Skill / handicap preference</label>
                <div className="flex flex-wrap gap-1.5">
                  {SKILL_OPTIONS.map((s) => (
                    <Pill key={s} active={skillLevel === s} onClick={() => setSkillLevel(skillLevel === s ? "" : s)}>
                      {s}
                    </Pill>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Golf vibe</label>
                <div className="flex flex-wrap gap-1.5">
                  {GOLF_VIBES.map((v) => (
                    <Pill key={v} active={vibe === v} onClick={() => setVibe(vibe === v ? "" : v)}>
                      {v}
                    </Pill>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Walking or cart</label>
                <div className="flex flex-wrap gap-1.5">
                  {WALK_OPTIONS.map((w) => (
                    <Pill key={w} active={walkOrCart === w} onClick={() => setWalkOrCart(walkOrCart === w ? "" : w)}>
                      {w}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, SlidersHorizontal } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";
import { inputClass } from "../ui/FormControls";
import { GOLF_VIBES } from "../../types";
import type { GolfVibe, SkillFilter, WalkOrCart } from "../../types";

export type WhenChoice = "today" | "tomorrow" | "weekend" | "date";
export type RadiusChoice = "10" | "25" | "50";

const WHEN_OPTIONS: { value: WhenChoice; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "weekend", label: "This Weekend" },
  { value: "date", label: "Choose Date" },
];

const RADIUS_OPTIONS: { value: RadiusChoice; label: string }[] = [
  { value: "10", label: "10 miles" },
  { value: "25", label: "25 miles" },
  { value: "50", label: "50 miles" },
];

const SKILL_OPTIONS: SkillFilter[] = ["Any Skill Level", "Beginner", "Intermediate", "Advanced"];
const WALK_OPTIONS: WalkOrCart[] = ["Either", "Walking", "Cart"];

// Reached only from the homepage's "Find Me a Round" action, so intent is
// implied (join an existing group) — no separate question needed here.
export function FindRoundModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();

  const [when, setWhen] = useState<WhenChoice>("today");
  const [customDate, setCustomDate] = useState("");
  const [radius, setRadius] = useState<RadiusChoice>("25");
  const [showFilters, setShowFilters] = useState(false);
  const [budgetMax, setBudgetMax] = useState<number | "">("");
  const [skillLevel, setSkillLevel] = useState<SkillFilter | "">("");
  const [vibe, setVibe] = useState<GolfVibe | "">("");
  const [walkOrCart, setWalkOrCart] = useState<WalkOrCart | "">("");

  const canSubmit = when !== "date" || Boolean(customDate);

  function handleFindRound() {
    if (!canSubmit) return;

    const params = new URLSearchParams({ matched: "1", when, radius, intent: "join" });
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
      title="Find Me a Round"
      onClose={onClose}
      footer={
        <Button size="lg" fullWidth disabled={!canSubmit} onClick={handleFindRound} icon={<ArrowRight size={18} />} className="flex-row-reverse">
          Find Me a Round
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-sm font-bold text-slate-800">When?</p>
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
          <p className="mb-2 text-sm font-bold text-slate-800">How far?</p>
          <div className="flex flex-wrap gap-1.5">
            {RADIUS_OPTIONS.map((opt) => (
              <Pill key={opt.value} active={radius === opt.value} onClick={() => setRadius(opt.value)}>
                {opt.label}
              </Pill>
            ))}
          </div>
        </div>

        <div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800"
          >
            <SlidersHorizontal size={14} />
            {showFilters ? "Hide advanced filters" : "Advanced Filters"}
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

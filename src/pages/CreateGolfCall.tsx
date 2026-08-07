import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Users } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { GOLF_VIBES } from "../types";
import type { GolfVibe, JoinMode, SkillFilter, WalkOrCart } from "../types";
import { inputClass, labelClass } from "../components/ui/FormControls";
import { getWeekendRange } from "../lib/greeting";

const SKILL_OPTIONS: SkillFilter[] = ["Any Skill Level", "Beginner", "Intermediate", "Advanced"];
const WALK_OPTIONS: WalkOrCart[] = ["Either", "Walking", "Cart"];

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
  const { createGolfCall, visibleGolfers, circleGolfers } = useData();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();

  const [fillMode, setFillMode] = useState(searchParams.get("mode") === "fill");
  const [course, setCourse] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [distanceMiles, setDistanceMiles] = useState(5);
  const [date, setDate] = useState(() => prefillDateFromWhen(searchParams.get("when"), searchParams.get("date")));
  const [timeLabel, setTimeLabel] = useState("");
  const [price, setPrice] = useState(50);
  const [totalSpots, setTotalSpots] = useState(4);
  const [joinMode, setJoinMode] = useState<JoinMode>("instant");
  const [skillLevel, setSkillLevel] = useState<SkillFilter>("Any Skill Level");
  const [vibe, setVibe] = useState<GolfVibe>("Casual & Social");
  const [walkOrCart, setWalkOrCart] = useState<WalkOrCart>("Either");
  const [notes, setNotes] = useState("");
  const [friendIds, setFriendIds] = useState<string[]>([]);

  const maxFriends = Math.max(0, totalSpots - 2); // leave room for host + at least 1 open spot
  const openSpotsRemaining = totalSpots - 1 - friendIds.length;

  const otherGolfers = useMemo(() => visibleGolfers(), [visibleGolfers]);
  const circleIds = useMemo(() => new Set(circleGolfers.map((g) => g.id)), [circleGolfers]);
  const nonCircleGolfers = useMemo(() => otherGolfers.filter((g) => !circleIds.has(g.id)), [otherGolfers, circleIds]);

  function toggleFriend(id: string) {
    setFriendIds((prev) => {
      if (prev.includes(id)) return prev.filter((f) => f !== id);
      if (prev.length >= maxFriends) return prev;
      return [...prev, id];
    });
  }

  const canSubmit = Boolean(
    course.trim() && areaLabel.trim() && date && timeLabel.trim() && (!fillMode || openSpotsRemaining >= 1),
  );

  function handleSubmit() {
    if (!canSubmit) return;
    const dateISO = new Date(`${date}T12:00:00`).toISOString();
    const call = createGolfCall({
      course: course.trim(),
      areaLabel: areaLabel.trim(),
      distanceMiles,
      dateISO,
      timeLabel: timeLabel.trim(),
      estimatedPricePerPerson: price,
      totalSpots,
      joinMode,
      skillLevel,
      vibe,
      walkOrCart,
      notes: notes.trim() || undefined,
      additionalJoinedGolferIds: fillMode ? friendIds : undefined,
    });
    showToast(fillMode ? "Your foursome is live — we'll help you fill the last spot." : "Your Golf Call is live!", "success");
    navigate(`/golf-calls/${call.id}`);
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
        <ArrowLeft size={16} /> Back
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{fillMode ? "Fill My Foursome" : "Host a Golf Call"}</h1>
        <p className="text-sm text-slate-500">
          {fillMode ? "You've already got players — let's find the rest." : "Set the details and we'll help you fill the group."}
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setFillMode(false)}
          className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
            !fillMode ? "border-fairway-400 bg-fairway-50 text-fairway-700" : "border-slate-200 text-slate-600"
          }`}
        >
          Starting fresh
        </button>
        <button
          onClick={() => setFillMode(true)}
          className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
            fillMode ? "border-fairway-400 bg-fairway-50 text-fairway-700" : "border-slate-200 text-slate-600"
          }`}
        >
          I already have players
        </button>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-4">
        <div>
          <label className={labelClass}>Course</label>
          <input className={inputClass} value={course} onChange={(e) => setCourse(e.target.value)} placeholder="e.g. Bethpage Red" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>General area</label>
            <input className={inputClass} value={areaLabel} onChange={(e) => setAreaLabel(e.target.value)} placeholder="e.g. Farmingdale, NY" />
          </div>
          <div>
            <label className={labelClass}>Distance from you (mi)</label>
            <input type="number" min={0} className={inputClass} value={distanceMiles} onChange={(e) => setDistanceMiles(Number(e.target.value))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Date</label>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Tee time / window</label>
            <input className={inputClass} value={timeLabel} onChange={(e) => setTimeLabel(e.target.value)} placeholder="e.g. 10:00 AM" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Estimated price / person</label>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={labelClass}>Total spots</label>
            <select className={inputClass} value={totalSpots} onChange={(e) => setTotalSpots(Number(e.target.value))}>
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} players
                </option>
              ))}
            </select>
          </div>
        </div>

        {fillMode && (
          <div>
            <label className={labelClass}>Who's already in?</label>
            <p className="mb-2 text-xs text-slate-500">
              Pick up to {maxFriends} confirmed player{maxFriends === 1 ? "" : "s"} — we'll leave room for the rest.
            </p>
            <div className="flex flex-col gap-3">
              {circleGolfers.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fairway-700">
                    <Users size={12} /> Your Golf Circle
                  </p>
                  <div className="flex flex-col gap-1">
                    {circleGolfers.map((g) => (
                      <FriendRow key={g.id} golferId={g.id} name={g.name} handicap={g.handicap} avatar={g} checked={friendIds.includes(g.id)} disabled={!friendIds.includes(g.id) && friendIds.length >= maxFriends} onToggle={toggleFriend} circle />
                    ))}
                  </div>
                </div>
              )}
              <div>
                {circleGolfers.length > 0 && <p className="mb-1.5 text-xs font-semibold text-slate-500">Other golfers</p>}
                <div className="flex flex-col gap-1">
                  {nonCircleGolfers.map((g) => (
                    <FriendRow key={g.id} golferId={g.id} name={g.name} handicap={g.handicap} avatar={g} checked={friendIds.includes(g.id)} disabled={!friendIds.includes(g.id) && friendIds.length >= maxFriends} onToggle={toggleFriend} />
                  ))}
                </div>
              </div>
            </div>
            <p className={`mt-2 text-xs font-semibold ${openSpotsRemaining >= 1 ? "text-fairway-700" : "text-red-600"}`}>
              {openSpotsRemaining >= 1
                ? `${openSpotsRemaining} open spot${openSpotsRemaining === 1 ? "" : "s"} to fill`
                : "Pick fewer players so there's at least one open spot to fill."}
            </p>
          </div>
        )}

        <div>
          <label className={labelClass}>Preferred skill level</label>
          <select className={inputClass} value={skillLevel} onChange={(e) => setSkillLevel(e.target.value as SkillFilter)}>
            {SKILL_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Golf vibe</label>
          <select className={inputClass} value={vibe} onChange={(e) => setVibe(e.target.value as GolfVibe)}>
            {GOLF_VIBES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Walking or cart</label>
          <div className="flex gap-2">
            {WALK_OPTIONS.map((w) => (
              <button
                key={w}
                onClick={() => setWalkOrCart(w)}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                  walkOrCart === w ? "border-fairway-400 bg-fairway-50 text-fairway-700" : "border-slate-200 text-slate-600"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>How should people join?</label>
          <div className="flex gap-2">
            <button
              onClick={() => setJoinMode("instant")}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                joinMode === "instant" ? "border-fairway-400 bg-fairway-50" : "border-slate-200"
              }`}
            >
              <p className="font-semibold text-slate-800">Instant join</p>
              <p className="text-xs text-slate-500">Anyone can tap "I'm In" and they're on the roster.</p>
            </button>
            <button
              onClick={() => setJoinMode("request")}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                joinMode === "request" ? "border-fairway-400 bg-fairway-50" : "border-slate-200"
              }`}
            >
              <p className="font-semibold text-slate-800">Request to join</p>
              <p className="text-xs text-slate-500">You approve each player before they're added.</p>
            </button>
          </div>
        </div>
        <div>
          <label className={labelClass}>{fillMode ? "Message to the group you're filling (optional)" : "Notes (optional)"}</label>
          <textarea
            className={inputClass}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={fillMode ? "e.g. Playing a casual morning round. Any skill level welcome." : "Anything players should know — pace expectations, meeting spot, etc."}
          />
        </div>
      </div>

      <Button disabled={!canSubmit} onClick={handleSubmit} size="lg">
        {fillMode ? "Publish & Find My Last Spot" : "Create Golf Call"}
      </Button>
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
}: {
  golferId: string;
  name: string;
  handicap: number | null;
  avatar: Parameters<typeof Avatar>[0]["golfer"];
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
  circle?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition ${
        checked ? "border-fairway-400 bg-fairway-50" : disabled ? "border-slate-100 opacity-50" : "border-slate-200"
      }`}
    >
      <input type="checkbox" checked={checked} disabled={disabled && !checked} onChange={() => onToggle(golferId)} className="h-4 w-4 accent-fairway-600" />
      <Avatar golfer={avatar} size="xs" showVerified={false} />
      <span className="flex-1 font-medium text-slate-800">{name}</span>
      <span className="text-xs text-slate-500">{handicap !== null ? `${handicap} HCP` : "New golfer"}</span>
      {circle && <Badge tone="fairway">Circle</Badge>}
    </label>
  );
}

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flag, UserPlus } from "lucide-react";
import { useData } from "../context/DataContext";
import { GolfCallCard } from "../components/golfcall/GolfCallCard";
import { Button } from "../components/ui/Button";
import { FindRoundModal } from "../components/find/FindRoundModal";
import { computeCallCompatibility } from "../lib/compatibility";
import { firstName, greetingForHour, isThisWeekend } from "../lib/greeting";

const HOME_RADIUS_MILES = 25;

export function Home() {
  const { currentUser, golfCalls } = useData();
  const [wizardOpen, setWizardOpen] = useState(false);
  const navigate = useNavigate();

  const openCalls = useMemo(
    () => golfCalls.filter((c) => c.status === "open" && c.totalSpots - c.joinedGolferIds.length > 0),
    [golfCalls],
  );

  const nearbyThisWeekend = useMemo(
    () => openCalls.filter((c) => c.distanceMiles <= HOME_RADIUS_MILES && isThisWeekend(c.dateISO)),
    [openCalls],
  );

  const nearbyAnytime = useMemo(() => openCalls.filter((c) => c.distanceMiles <= HOME_RADIUS_MILES), [openCalls]);

  const insight =
    nearbyThisWeekend.length > 0
      ? `${nearbyThisWeekend.length} round${nearbyThisWeekend.length === 1 ? "" : "s"} need${nearbyThisWeekend.length === 1 ? "s" : ""} players near you this weekend.`
      : nearbyAnytime.length > 0
        ? `${nearbyAnytime.length} round${nearbyAnytime.length === 1 ? "" : "s"} open near you right now.`
        : null;

  const happeningSoon = useMemo(() => {
    return [...golfCalls]
      .filter((c) => c.status === "open" || c.status === "full")
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
      .slice(0, 4)
      .map((call) => ({ call, matchScore: computeCallCompatibility(currentUser, call).overall }));
  }, [golfCalls, currentUser]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-slate-500">{greetingForHour(new Date().getHours())}, {firstName(currentUser.name)}</p>
        {insight && <p className="mt-0.5 text-lg font-bold text-slate-900">{insight}</p>}
      </div>

      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-fairway-700 via-fairway-800 to-fairway-950 px-6 py-10 text-white shadow-lg shadow-fairway-900/20 sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-16 left-10 h-64 w-64 rounded-full bg-sun-400/10" />
        <div className="relative flex flex-col items-start gap-5">
          <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-fairway-50">
            <Flag size={12} fill="currentColor" /> Golf Me
          </span>
          <h1 className="max-w-lg text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            Coordinating a foursome shouldn't be harder than finding a tee time.
          </h1>
          <p className="max-w-md text-sm text-fairway-100 sm:text-base">
            Find nearby golfers who match your skill, schedule, and budget — then jump into an upcoming Golf Call
            and build your group in minutes.
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Button size="lg" variant="secondary" icon={<Flag size={18} fill="currentColor" />} onClick={() => setWizardOpen(true)}>
              I want to golf
            </Button>
            <button
              onClick={() => navigate("/golf-calls/new?mode=fill")}
              className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              <UserPlus size={16} /> Fill My Foursome
            </button>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Happening soon</h2>
          <button onClick={() => navigate("/golf-calls")} className="text-sm font-semibold text-fairway-700 hover:underline">
            View all
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {happeningSoon.map(({ call, matchScore }) => (
            <GolfCallCard key={call.id} call={call} matchScore={matchScore} />
          ))}
        </div>
      </section>

      {wizardOpen && <FindRoundModal onClose={() => setWizardOpen(false)} />}
    </div>
  );
}

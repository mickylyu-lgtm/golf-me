import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Flag, Search, UserPlus, Users } from "lucide-react";
import { useData } from "../context/DataContext";
import { GolfCallCard } from "../components/golfcall/GolfCallCard";
import { Avatar } from "../components/ui/Avatar";
import { FindRoundModal } from "../components/find/FindRoundModal";
import { firstName, greetingForHour, isThisWeekend } from "../lib/greeting";
import { formatDate } from "../lib/format";

const HOME_RADIUS_MILES = 25;

export function Home() {
  const { currentUser, golfCalls, circleGolfers } = useData();
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

  const circlePlaying = useMemo(() => {
    const circleIds = new Set(circleGolfers.map((g) => g.id));
    return openCalls
      .filter((c) => !c.joinedGolferIds.includes(currentUser.id))
      .map((c) => {
        const circleHost = circleIds.has(c.hostId) ? circleGolfers.find((g) => g.id === c.hostId) : undefined;
        const circleJoiner = circleHost
          ? undefined
          : circleGolfers.find((g) => c.joinedGolferIds.includes(g.id));
        const via = circleHost ?? circleJoiner;
        return via ? { call: c, via } : null;
      })
      .filter((x): x is { call: (typeof openCalls)[number]; via: (typeof circleGolfers)[number] } => x !== null)
      .slice(0, 2);
  }, [openCalls, circleGolfers, currentUser.id]);

  const happeningSoon = useMemo(() => {
    return [...golfCalls]
      .filter((c) => c.status === "open" || c.status === "full")
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
      .slice(0, 4);
  }, [golfCalls]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-slate-500">
          {greetingForHour(new Date().getHours())}, {firstName(currentUser.name)}
        </p>
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

          <div className="mt-1 w-full">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fairway-100/70">I want to golf</p>
            <div className="grid w-full grid-cols-1 gap-3 sm:max-w-lg sm:grid-cols-2">
              <button
                onClick={() => setWizardOpen(true)}
                className="group flex flex-col items-start gap-1 rounded-2xl bg-sun-400 px-5 py-4 text-left text-fairway-950 shadow-md shadow-sun-900/20 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-sun-300 hover:shadow-lg active:translate-y-0 active:bg-sun-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fairway-800 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span className="flex items-center gap-2 text-base font-extrabold">
                  <Search size={18} /> Find Me a Round
                </span>
                <span className="text-sm font-medium text-fairway-900/80">I need people to play with</span>
              </button>
              <button
                onClick={() => navigate("/golf-calls/new?mode=fill")}
                className="group flex flex-col items-start gap-1 rounded-2xl border border-white/25 bg-white/10 px-5 py-4 text-left text-white transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-white/20 hover:shadow-lg active:translate-y-0 active:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fairway-800 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span className="flex items-center gap-2 text-base font-extrabold">
                  <UserPlus size={18} /> Fill My Foursome
                </span>
                <span className="text-sm font-medium text-white/70">I already have a group and need players</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {circlePlaying.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-1.5">
            <Users size={16} className="text-fairway-600" />
            <h2 className="text-lg font-bold text-slate-900">Your Circle is playing</h2>
          </div>
          <div className="flex flex-col gap-2">
            {circlePlaying.map(({ call, via }) => {
              const openSpots = call.totalSpots - call.joinedGolferIds.length;
              return (
                <button
                  key={call.id}
                  onClick={() => navigate(`/golf-calls/${call.id}`)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-fairway-100 bg-fairway-50/60 p-3.5 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <Avatar golfer={via} size="sm" />
                  <div className="flex-1">
                    <p className="text-sm text-slate-700">
                      <strong className="font-semibold text-slate-900">{firstName(via.name)}</strong> is looking for {openSpots} player
                      {openSpots === 1 ? "" : "s"} {formatDate(call.dateISO)}.
                    </p>
                    <p className="text-xs text-slate-500">
                      {call.course} · {call.timeLabel}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-fairway-700">
                    Join <ArrowRight size={14} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Who's playing this weekend?</h2>
          <button
            onClick={() => navigate("/golf-calls")}
            className="text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800 hover:underline"
          >
            View all
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {happeningSoon.map((call) => (
            <GolfCallCard key={call.id} call={call} />
          ))}
        </div>
      </section>

      {wizardOpen && <FindRoundModal onClose={() => setWizardOpen(false)} />}
    </div>
  );
}

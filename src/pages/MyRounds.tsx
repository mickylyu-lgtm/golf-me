import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ClipboardList, MapPin, Users } from "lucide-react";
import { useData } from "../context/DataContext";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { ReviewModal } from "../components/review/ReviewModal";
import { formatDate, formatMoney } from "../lib/format";
import { VIBE_TONE } from "../lib/theme";
import type { GolfCall } from "../types";

export function MyRounds() {
  const { currentUser, golfCalls, getGolfer, hasReviewed } = useData();
  const navigate = useNavigate();
  const [reviewTarget, setReviewTarget] = useState<{ call: GolfCall; revieweeId: string } | null>(null);

  const myCalls = useMemo(
    () => golfCalls.filter((c) => c.joinedGolferIds.includes(currentUser.id) || c.hostId === currentUser.id),
    [golfCalls, currentUser.id],
  );

  const upcoming = useMemo(
    () =>
      myCalls
        .filter((c) => c.status === "open" || c.status === "full")
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO)),
    [myCalls],
  );

  const past = useMemo(
    () => myCalls.filter((c) => c.status === "completed" || c.status === "cancelled").sort((a, b) => b.dateISO.localeCompare(a.dateISO)),
    [myCalls],
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-bold text-slate-900">My Rounds</h1>
        <p className="text-sm text-slate-500">Everything you're hosting or playing in, in one place.</p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Upcoming</h2>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={20} />}
            title="No upcoming rounds yet"
            description="Join a Golf Call to get one on the books."
            action={
              <Button size="sm" onClick={() => navigate("/golf-calls")}>
                Browse Golf Calls
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {upcoming.map((c) => {
              const isHost = c.hostId === currentUser.id;
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/golf-calls/${c.id}`)}
                  className="flex w-full flex-col gap-2.5 rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm shadow-slate-900/[0.03] transition hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900">{c.course}</p>
                      <p className="flex items-center gap-1 text-xs text-slate-500">
                        <MapPin size={12} /> {c.areaLabel}
                      </p>
                    </div>
                    {isHost ? <Badge tone="sun">Hosting</Badge> : <Badge tone="fairway">Joined</Badge>}
                  </div>
                  <p className="flex items-center gap-1 text-xs font-medium text-fairway-700">
                    <CalendarDays size={12} /> {formatDate(c.dateISO)} · {c.timeLabel}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={VIBE_TONE[c.vibe]}>{c.vibe}</Badge>
                    <Badge tone="outline">{formatMoney(c.estimatedPricePerPerson)}/person</Badge>
                    <Badge tone="outline" icon={<Users size={11} />}>
                      {c.joinedGolferIds.length}/{c.totalSpots} joined
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Past</h2>
        {past.length === 0 ? (
          <EmptyState icon={<ClipboardList size={20} />} title="No past rounds yet" description="Completed Golf Calls will show up here." />
        ) : (
          <div className="flex flex-col gap-3">
            {past.map((c) => {
              const teammates = c.joinedGolferIds.filter((gid) => gid !== currentUser.id);
              const reviewedCount = teammates.filter((gid) => hasReviewed(c.id, gid)).length;
              const allReviewed = c.status === "completed" && reviewedCount === teammates.length;
              return (
                <div key={c.id} className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4">
                  <button onClick={() => navigate(`/golf-calls/${c.id}`)} className="flex items-start justify-between gap-3 text-left">
                    <div>
                      <p className="font-bold text-slate-900">{c.course}</p>
                      <p className="flex items-center gap-1 text-xs text-slate-500">
                        <CalendarDays size={12} /> {formatDate(c.dateISO)}
                      </p>
                    </div>
                    <Badge tone={c.status === "cancelled" ? "rose" : "slate"}>{c.status === "cancelled" ? "Cancelled" : "Completed"}</Badge>
                  </button>

                  {c.status === "completed" && teammates.length > 0 && (
                    <div className="border-t border-slate-100 pt-3">
                      {allReviewed ? (
                        <p className="text-xs font-medium text-fairway-700">All reviews submitted — thanks for keeping Golf Me trustworthy.</p>
                      ) : (
                        <>
                          <p className="mb-2 text-xs font-semibold text-slate-500">
                            Leave a review ({reviewedCount}/{teammates.length} done)
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {teammates.map((gid) => {
                              const g = getGolfer(gid);
                              if (!g) return null;
                              const reviewed = hasReviewed(c.id, gid);
                              return (
                                <button
                                  key={gid}
                                  disabled={reviewed}
                                  onClick={() => setReviewTarget({ call: c, revieweeId: gid })}
                                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                                    reviewed
                                      ? "border-fairway-200 bg-fairway-50 text-fairway-700"
                                      : "border-slate-200 text-slate-600 hover:border-fairway-300"
                                  }`}
                                >
                                  <Avatar golfer={g} size="xs" showVerified={false} />
                                  {g.name.split(" ")[0]}
                                  {reviewed ? " ✓" : ""}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {reviewTarget &&
        (() => {
          const reviewee = getGolfer(reviewTarget.revieweeId);
          if (!reviewee) return null;
          return <ReviewModal callId={reviewTarget.call.id} reviewee={reviewee} onClose={() => setReviewTarget(null)} />;
        })()}
    </div>
  );
}

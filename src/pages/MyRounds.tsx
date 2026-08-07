import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ClipboardList, MapPin, Search, Users } from "lucide-react";
import { useData } from "../context/DataContext";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { ReviewModal } from "../components/review/ReviewModal";
import { CLICKABLE_CARD_CLASS } from "../components/ui/cardStyles";
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
            title="Nothing on the books yet."
            description="Find a round nearby or host your own — either way, you'll be golfing soon."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" icon={<Search size={14} />} onClick={() => navigate("/golf-calls")}>
                  Find a Round
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigate("/golf-calls/new")}>
                  Host a Golf Call
                </Button>
              </div>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {upcoming.map((c) => {
              const isHost = c.hostId === currentUser.id;
              const openSpots = c.totalSpots - c.joinedGolferIds.length;
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/golf-calls/${c.id}`)}
                  className={`flex w-full flex-col gap-2.5 p-4 text-left ${CLICKABLE_CARD_CLASS}`}
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
                      {openSpots === 1 ? "One more and you're set" : `${c.joinedGolferIds.length}/${c.totalSpots} joined`}
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
          <EmptyState
            icon={<ClipboardList size={20} />}
            title="No rounds played yet."
            description="Once you complete a round, it'll show up here for reviews and reputation."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {past.map((c) => {
              const teammates = c.joinedGolferIds.filter((gid) => gid !== currentUser.id);
              const reviewedCount = teammates.filter((gid) => hasReviewed(c.id, gid)).length;
              const allReviewed = c.status === "completed" && reviewedCount === teammates.length;
              return (
                <div key={c.id} className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4">
                  <button
                    onClick={() => navigate(`/golf-calls/${c.id}`)}
                    className="flex items-start justify-between gap-3 rounded-xl text-left transition-colors duration-200 hover:text-fairway-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
                  >
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
                                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 disabled:pointer-events-none ${
                                    reviewed
                                      ? "border-fairway-200 bg-fairway-50 text-fairway-700"
                                      : "border-slate-200 text-slate-600 hover:border-fairway-300 hover:text-fairway-700 active:bg-slate-50"
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

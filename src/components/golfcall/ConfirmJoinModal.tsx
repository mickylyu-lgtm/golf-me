import { ShieldCheck } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Avatar } from "../ui/Avatar";
import { CredibilityBadge } from "../golfer/CredibilityBadge";
import { useData } from "../../context/DataContext";
import type { GolfCall } from "../../types";
import { formatDate } from "../../lib/format";
import { computeCredibility } from "../../lib/credibility";

interface ConfirmJoinModalProps {
  call: GolfCall;
  onClose: () => void;
  onConfirm: () => void;
}

// Lightweight reassurance before committing to a round — not a safety
// warning, just "here's who you'd be playing with."
export function ConfirmJoinModal({ call, onClose, onConfirm }: ConfirmJoinModalProps) {
  const { getGolfer, reviewsAbout } = useData();
  const roster = call.joinedGolferIds.map((id) => getGolfer(id)).filter((g): g is NonNullable<typeof g> => Boolean(g));

  const verifiedCount = roster.filter((g) => g.verification.verifiedGolfer).length;
  const combinedRounds = roster.reduce((sum, g) => sum + g.reputation.completedRounds, 0);
  const avgWouldPlayAgain =
    roster.length > 0 ? Math.round(roster.reduce((sum, g) => sum + g.reputation.wouldPlayAgainPct, 0) / roster.length) : 0;
  const noRecentNoShows = roster.length > 0 && roster.every((g) => g.reputation.showUpRatePct >= 90);

  return (
    <Modal
      title="You're joining"
      onClose={onClose}
      footer={
        <Button size="lg" fullWidth onClick={onConfirm}>
          {call.joinMode === "instant" ? "Confirm Join" : "Confirm Request"} →
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-fairway-100 bg-fairway-50/60 p-4">
          <ul className="flex flex-col gap-2 text-sm text-fairway-800">
            <li className="flex items-center gap-2 font-semibold">
              <ShieldCheck size={15} className="text-fairway-600" />
              {verifiedCount} Verified Golfer{verifiedCount === 1 ? "" : "s"}
            </li>
            <li className="font-semibold">{combinedRounds} Combined GolfMe Rounds</li>
            <li className="font-semibold">{avgWouldPlayAgain}% Average Would Play Again</li>
            {noRecentNoShows && <li className="font-semibold">No Recent No-Shows</li>}
          </ul>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Playing with</p>
          <div className="flex flex-col gap-2">
            {roster.map((g) => {
              const credibility = computeCredibility(g, reviewsAbout(g.id));
              return (
                <div key={g.id} className="flex items-center gap-2.5">
                  <Avatar golfer={g} size="xs" showVerified={false} />
                  <span className="flex-1 text-sm font-medium text-slate-700">{g.name}</span>
                  <CredibilityBadge tier={credibility.tier} label={credibility.label} size="sm" />
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <p className="font-bold text-slate-900">{call.course}</p>
          <p className="text-sm text-slate-500">
            {formatDate(call.dateISO)} · {call.timeLabel}
          </p>
        </div>
      </div>
    </Modal>
  );
}

import type { GolferProfile } from "../../types";
import { isNewAccount, memberSinceLabel } from "../../lib/format";

interface ReputationRowProps {
  golfer: GolferProfile;
  compact?: boolean;
}

export function ReputationRow({ golfer, compact }: ReputationRowProps) {
  const isNew = isNewAccount(golfer.reputation.completedRounds);

  if (isNew) {
    return (
      <p className={`font-medium text-slate-500 ${compact ? "text-xs" : "text-sm"}`}>
        New Golfer · {golfer.reputation.completedRounds} Completed Round{golfer.reputation.completedRounds === 1 ? "" : "s"}
      </p>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600 ${compact ? "text-xs" : "text-sm"}`}>
      <span>
        <strong className="font-semibold text-slate-800">{golfer.reputation.completedRounds}</strong> rounds
      </span>
      <span className="text-slate-300">·</span>
      <span>
        <strong className="font-semibold text-slate-800">{golfer.reputation.wouldPlayAgainPct}%</strong> would play again
      </span>
      <span className="text-slate-300">·</span>
      <span>
        <strong className="font-semibold text-slate-800">{golfer.reputation.showUpRatePct}%</strong> show-up rate
      </span>
      {!compact && (
        <>
          <span className="text-slate-300">·</span>
          <span>{memberSinceLabel(golfer.memberSince)}</span>
        </>
      )}
    </div>
  );
}

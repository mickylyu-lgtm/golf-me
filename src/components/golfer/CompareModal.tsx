import { useMemo } from "react";
import type { GolferProfile } from "../../types";
import { useData } from "../../context/DataContext";
import { Modal } from "../ui/Modal";
import { Avatar } from "../ui/Avatar";
import { MatchReasons } from "./MatchReasons";
import { computeCompatibility } from "../../lib/compatibility";
import { golferMatchReasons } from "../../lib/matchReasons";
import { computeCredibility } from "../../lib/credibility";
import { formatBudgetRange, handicapLabel, paceLabel } from "../../lib/format";
import type { MatchFactor } from "../../lib/matchReasons";
import { useLocale } from "../../i18n/LocaleContext";

// Purposefully not a leaderboard: no ranking, no "who's better" framing —
// just a side-by-side read of whether two golfers would likely enjoy a
// round together. Stacked (You / Them) rows rather than a wide table so it
// never needs horizontal scroll on mobile.
function CompareRow({ label, you, them }: { label: string; you: string; them: string }) {
  return (
    <div className="border-b border-slate-100 py-2.5 last:border-0">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <p className="text-sm font-semibold text-slate-800">{you}</p>
        <p className="text-sm font-semibold text-slate-800">{them}</p>
      </div>
    </div>
  );
}

export function CompareModal({ other, onClose }: { other: GolferProfile; onClose: () => void }) {
  const { currentUser, reviewsAbout } = useData();
  const { t } = useLocale();

  const compat = useMemo(() => computeCompatibility(currentUser, other), [currentUser, other]);
  const reasons = useMemo(() => golferMatchReasons(compat), [compat]);

  const myCredibility = useMemo(() => computeCredibility(currentUser, reviewsAbout(currentUser.id)), [currentUser, reviewsAbout]);
  const theirCredibility = useMemo(() => computeCredibility(other, reviewsAbout(other.id)), [other, reviewsAbout]);

  const credibilityFactor: MatchFactor | null =
    myCredibility.tier === "excellent" || myCredibility.tier === "good"
      ? theirCredibility.tier === "excellent" || theirCredibility.tier === "good"
        ? { key: "credibility", score: 100, positive: true, text: "Strong credibility on both sides" }
        : null
      : null;

  const positives = reasons.filter((r) => r.positive);
  const negatives = reasons.filter((r) => !r.positive);
  if (credibilityFactor) positives.unshift(credibilityFactor);

  const firstName = other.name.split(" ")[0];

  return (
    <Modal title={`Compare with ${firstName}`} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <Avatar golfer={currentUser} size="md" />
            <p className="text-sm font-bold text-slate-900">You</p>
          </div>
          <div className="flex flex-col items-center gap-1.5 text-center">
            <Avatar golfer={other} size="md" />
            <p className="truncate text-sm font-bold text-slate-900">{firstName}</p>
          </div>
        </div>

        <div>
          <CompareRow label="Handicap" you={handicapLabel(currentUser.handicap, t)} them={handicapLabel(other.handicap, t)} />
          <CompareRow
            label="Rounds Played"
            you={`${currentUser.reputation.completedRounds} rounds`}
            them={`${other.reputation.completedRounds} rounds`}
          />
          <CompareRow
            label="Would Play Again"
            you={`${currentUser.reputation.wouldPlayAgainPct}%`}
            them={`${other.reputation.wouldPlayAgainPct}%`}
          />
          <CompareRow label="Show-Up Rate" you={`${currentUser.reputation.showUpRatePct}%`} them={`${other.reputation.showUpRatePct}%`} />
          <CompareRow label="Pace" you={paceLabel(currentUser.reputation.goodPacePct, t)} them={paceLabel(other.reputation.goodPacePct, t)} />
          <CompareRow label="Golf Vibe" you={currentUser.vibes.join(" & ")} them={other.vibes.join(" & ")} />
          <CompareRow
            label="Budget / Round"
            you={formatBudgetRange(currentUser.budgetMin, currentUser.budgetMax, currentUser.noBudgetPreference, t)}
            them={formatBudgetRange(other.budgetMin, other.budgetMax, other.noBudgetPreference, t)}
          />
          <CompareRow label="Walking or Cart" you={currentUser.walkOrCart} them={other.walkOrCart} />
          <CompareRow label="Credibility" you={myCredibility.label} them={theirCredibility.label} />
        </div>

        {positives.length > 0 && (
          <div className="rounded-2xl bg-fairway-50/70 p-3.5">
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-fairway-800">Why you may play well together</p>
            <MatchReasons reasons={positives} />
          </div>
        )}

        {negatives.length > 0 && (
          <div className="rounded-2xl bg-amber-50/70 p-3.5">
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-amber-800">Possible differences</p>
            <MatchReasons reasons={negatives} />
          </div>
        )}
      </div>
    </Modal>
  );
}

import type { ReactionSummary } from "../../lib/reactions";

interface ReactionPillProps {
  summary: ReactionSummary[];
  // My message: the pill sits on the bubble's bottom-right, else bottom-left.
  alignRight: boolean;
  label: string;
  removeLabel: string;
  // Present when one of the reactions is mine: tapping the pill takes it back.
  onRemoveMine: (() => void) | null;
}

// The small pill overlapping a DM bubble's bottom corner: each emoji once,
// plus the total when there's more than one reaction; outlined in green
// when one of them is mine. Rendered INSIDE the bubble (absolutely
// positioned) so it slides with the bubble during swipe-to-reply; the
// bubble reserves room for it with a bottom margin.
export function ReactionPill({ summary, alignRight, label, removeLabel, onRemoveMine }: ReactionPillProps) {
  if (summary.length === 0) return null;
  const total = summary.reduce((n, s) => n + s.count, 0);
  const mine = summary.some((s) => s.mine);
  const body = (
    <>
      <span aria-hidden="true" className="flex items-center gap-px text-[0.9rem] leading-none">
        {summary.map((s) => (
          <span key={s.emoji}>{s.emoji}</span>
        ))}
      </span>
      {total > 1 && (
        <span aria-hidden="true" className="text-[11px] font-semibold text-slate-600 tabular-nums">
          {total}
        </span>
      )}
    </>
  );
  const cls = `absolute -bottom-4 flex h-6 items-center gap-1 rounded-full border px-1.5 shadow-sm select-none ${
    alignRight ? "right-2" : "left-2"
  } ${mine ? "border-fairway-300 bg-fairway-50" : "border-slate-200 bg-white"}`;
  if (onRemoveMine) {
    return (
      <button
        type="button"
        aria-label={`${label}. ${removeLabel}`}
        // Don't take focus off the composer (keyboard stays put).
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemoveMine}
        className={`${cls} transition-colors duration-150 hover:border-fairway-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400`}
      >
        {body}
      </button>
    );
  }
  return (
    <span role="img" aria-label={label} className={cls}>
      {body}
    </span>
  );
}

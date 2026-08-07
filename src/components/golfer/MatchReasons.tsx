import type { MatchFactor } from "../../lib/matchReasons";

// The explanatory checklist that backs a CompatibilityBadge — e.g.
// "✓ Similar handicap · ✓ Within your budget · ⚠ 27 miles away". Keeps the
// scoring model legible instead of asking someone to trust a bare number.
export function MatchReasons({ reasons, className = "" }: { reasons: MatchFactor[]; className?: string }) {
  if (reasons.length === 0) return null;
  return (
    <ul className={`flex flex-col gap-0.5 ${className}`}>
      {reasons.map((r) => (
        <li
          key={r.key}
          className={`flex items-center gap-1.5 text-xs ${r.positive ? "text-fairway-700" : "text-amber-700"}`}
        >
          <span aria-hidden className="font-bold">
            {r.positive ? "✓" : "⚠"}
          </span>
          {r.text}
        </li>
      ))}
    </ul>
  );
}

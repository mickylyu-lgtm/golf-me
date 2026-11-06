import { ShieldCheck } from "lucide-react";

// The Verified Golfer medallion on the golfer's own Reputation screen. The
// mark is the same lucide ShieldCheck other golfers see on a verified
// profile/avatar (VerifiedBadge, Avatar's corner badge), set in a fairway disc.
// A thin ring around it shows progress (done of total). Not earned: pale disc,
// outlined shield. Earned: filled fairway disc, white shield, full ring, and
// (when `shine`) one specular sweep; prefers-reduced-motion keeps it static.
// Decorative: callers state the progress as text for screen readers.
export function VerifiedMedallion({
  done,
  total,
  earned,
  shine = false,
  size = 64,
}: {
  done: number;
  total: number;
  earned: boolean;
  shine?: boolean;
  size?: number;
}) {
  const stroke = Math.max(2, Math.round(size / 26));
  const r = size / 2 - stroke / 2 - 0.5;
  const c = 2 * Math.PI * r;
  const fraction = earned ? 1 : Math.max(0, Math.min(1, total > 0 ? done / total : 0));
  const inset = Math.round(size * 0.12);
  const icon = Math.round(size * 0.42);

  return (
    <div aria-hidden="true" className="relative shrink-0" style={{ width: size, height: size }} data-testid="verified-medallion">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-slate-200" />
        {fraction > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * fraction} ${c}`}
            className="text-fairway-600 transition-[stroke-dasharray] duration-500 ease-out"
          />
        )}
      </svg>
      <div
        className={`absolute overflow-hidden rounded-full ${
          earned
            ? "bg-gradient-to-br from-fairway-500 via-fairway-600 to-fairway-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_12px_-4px_rgba(21,128,61,0.55)]"
            : "border border-fairway-200 bg-fairway-50"
        }`}
        style={{ inset }}
      >
        <div className="flex h-full w-full items-center justify-center">
          {earned ? (
            <ShieldCheck size={icon} strokeWidth={2} className="text-fixed-white" fill="currentColor" fillOpacity={0.16} />
          ) : (
            <ShieldCheck size={icon} strokeWidth={1.75} className="text-fairway-600 opacity-60" />
          )}
        </div>
        {earned && shine && (
          <span className="pointer-events-none absolute -inset-y-1/4 left-0 w-1/2 animate-medallion-shine bg-gradient-to-r from-transparent via-white/55 to-transparent" />
        )}
      </div>
    </div>
  );
}

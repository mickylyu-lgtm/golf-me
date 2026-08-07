import { compatibilityLabel } from "../../lib/compatibility";

function toneForScore(score: number): string {
  if (score >= 85) return "bg-fairway-600 text-white";
  if (score >= 70) return "bg-fairway-100 text-fairway-700";
  if (score >= 50) return "bg-sun-100 text-sun-700";
  return "bg-slate-100 text-slate-600";
}

export function CompatibilityBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  return (
    <div
      className={`inline-flex flex-col items-center justify-center rounded-2xl px-3 py-1.5 leading-none ${toneForScore(score)} ${size === "sm" ? "text-[11px]" : "text-xs"}`}
    >
      <span className={`font-extrabold ${size === "sm" ? "text-sm" : "text-lg"}`}>{score}%</span>
      <span className="font-medium opacity-90">{compatibilityLabel(score)}</span>
    </div>
  );
}

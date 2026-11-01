import { matchTier } from "../../lib/matchReasons";
import { useLocale } from "../../i18n/LocaleContext";

const TONE_CLASSES: Record<string, string> = {
  great: "bg-fairway-600 text-white",
  decent: "bg-sun-100 text-sun-700",
  possible: "bg-slate-100 text-slate-600",
  low: "bg-slate-100 text-slate-500",
};

// Shows the tier + label only — never the raw percentage. The score still
// drives sorting/filtering internally (see lib/compatibility.ts); this is
// just the human-readable face of it. Pair with <MatchReasons> when there's
// room to explain *why*.
export function CompatibilityBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  const { t } = useLocale();
  const { emoji, tier } = matchTier(score);
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 shrink-0 font-semibold whitespace-nowrap ${TONE_CLASSES[tier]} ${size === "sm" ? "text-[11px]" : "text-xs"}`}
    >
      <span aria-hidden>{emoji}</span>
      {t(`matchTier.${tier}`)}
    </div>
  );
}

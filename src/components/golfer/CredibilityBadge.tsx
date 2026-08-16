import { Shield, ShieldCheck } from "lucide-react";
import type { CredibilityTier } from "../../lib/credibility";
import { credibilityLabel } from "../../lib/credibility";
import { useLocale } from "../../i18n/LocaleContext";

const TIER_CLASSES: Record<CredibilityTier, string> = {
  excellent: "bg-fairway-600 text-white",
  good: "bg-fairway-50 text-fairway-700",
  building: "bg-sun-100 text-sun-700",
  limited: "bg-slate-100 text-slate-600",
};

interface CredibilityBadgeProps {
  tier: CredibilityTier;
  size?: "sm" | "md";
}

export function CredibilityBadge({ tier, size = "md" }: CredibilityBadgeProps) {
  const { t } = useLocale();
  const Icon = tier === "excellent" || tier === "good" ? ShieldCheck : Shield;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold whitespace-nowrap ${TIER_CLASSES[tier]} ${size === "sm" ? "text-[11px]" : "text-xs"}`}
    >
      <Icon size={size === "sm" ? 12 : 13} />
      {credibilityLabel(tier, t)}
    </span>
  );
}

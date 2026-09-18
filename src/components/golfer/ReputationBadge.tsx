import { Shield, ShieldCheck, ShieldHalf, Award, Crown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReputationTierKey } from "../../lib/reputationTiers";
import { FAMILY_STYLE, tierDisplayName, tierFamily } from "../../lib/reputationTiers";
import { useLocale } from "../../i18n/LocaleContext";

const FAMILY_ICON: Record<ReturnType<typeof tierFamily>, LucideIcon> = {
  newcomer: Shield,
  established: ShieldCheck,
  trusted: ShieldHalf,
  premier: Award,
  elite: Crown,
};

export function ReputationShieldIcon({ tier, size = 14 }: { tier: ReputationTierKey; size?: number }) {
  const family = tierFamily(tier);
  const Icon = FAMILY_ICON[family];
  return <Icon size={size} className={FAMILY_STYLE[family].iconClass} />;
}

interface ReputationBadgeProps {
  tier: ReputationTierKey;
  size?: "sm" | "md";
}

export function ReputationBadge({ tier, size = "md" }: ReputationBadgeProps) {
  const { t } = useLocale();
  const family = tierFamily(tier);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold whitespace-nowrap ${FAMILY_STYLE[family].badgeClass} ${size === "sm" ? "text-[11px]" : "text-xs"}`}
    >
      <ReputationShieldIcon tier={tier} size={size === "sm" ? 12 : 13} />
      {tierDisplayName(tier, t)}
    </span>
  );
}

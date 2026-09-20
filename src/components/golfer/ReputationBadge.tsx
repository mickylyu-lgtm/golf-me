import type { ReputationTierKey } from "../../lib/reputationTiers";
import { FAMILY_STYLE, tierDisplayName, tierFamily } from "../../lib/reputationTiers";
import { useLocale } from "../../i18n/LocaleContext";
import { ReputationEmblem } from "./ReputationEmblem";

// The approved custom crest (ReputationEmblem) replaces the old generic
// Lucide shield/check/half/award/crown icons here -- this is the single
// component every production Reputation surface renders through, so the
// swap needed no changes anywhere else. Sized ~20-24px per the approved
// artifact (was 12-13px under the old generic icon, which was too small
// for the flag+dimple detail to read).
export function ReputationShieldIcon({ tier, size = 20 }: { tier: ReputationTierKey; size?: number }) {
  return <ReputationEmblem tier={tier} size={size} />;
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
      <ReputationShieldIcon tier={tier} size={size === "sm" ? 20 : 22} />
      {tierDisplayName(tier, t)}
    </span>
  );
}

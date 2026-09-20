import type { ReputationTierKey } from "../../lib/reputationTiers";
import { FAMILY_STYLE, tierDisplayName, tierFamily } from "../../lib/reputationTiers";
import { useLocale } from "../../i18n/LocaleContext";
import { ReputationEmblem, ReputationEmblemSkeleton } from "./ReputationEmblem";

// The approved custom crest (ReputationEmblem) replaces the old generic
// Lucide shield/check/half/award/crown icons here -- this is the single
// component every production Reputation surface renders through, so the
// swap needed no changes anywhere else. Sized ~20-24px per the approved
// artifact (was 12-13px under the old generic icon, which was too small
// for the flag+dimple detail to read). tier is nullable so callers using
// useReputationState can pass its state straight through while the real
// tier is still loading (see that hook's own comment) -- renders the
// fixed-footprint skeleton instead of guessing.
export function ReputationShieldIcon({ tier, size = 20 }: { tier: ReputationTierKey | null; size?: number }) {
  if (!tier) return <ReputationEmblemSkeleton size={size} />;
  return <ReputationEmblem tier={tier} size={size} />;
}

interface ReputationBadgeProps {
  tier: ReputationTierKey | null;
  size?: "sm" | "md";
  /** When provided, the whole pill becomes a tap target that calls this instead of rendering inert. */
  onClick?: () => void;
}

export function ReputationBadge({ tier, size = "md", onClick }: ReputationBadgeProps) {
  const { t } = useLocale();
  const textSizeClass = size === "sm" ? "text-[11px]" : "text-xs";
  const iconSize = size === "sm" ? 20 : 22;

  if (!tier) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex animate-pulse items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-semibold whitespace-nowrap ${textSizeClass}`}
      >
        <ReputationEmblemSkeleton size={iconSize} />
        <span className="h-3 w-12 rounded-full bg-slate-200" />
      </span>
    );
  }

  const family = tierFamily(tier);
  const pill = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold whitespace-nowrap ${FAMILY_STYLE[family].badgeClass} ${textSizeClass}`}
    >
      <ReputationShieldIcon tier={tier} size={iconSize} />
      {tierDisplayName(tier, t)}
    </span>
  );

  if (!onClick) return pill;

  // Invisible p-2/-m-2 padding widens the tap target beyond the visible
  // pill without pushing surrounding flex siblings (handicap text, the
  // Coach Reviewer badge) apart -- the negative margin cancels the extra
  // box out of the layout, only the hit area grows. No chevron and no
  // button-like fill/border added -- stays a pill you can tap, not a CTA.
  // Same route as the existing GolfMe Reputation row under Social
  // (/profile/reputation via navigate), same useReputationState source of
  // truth -- this never computes or caches a second copy of the tier.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${tierDisplayName(tier, t)}, ${t("reputation.title")}`}
      className="-m-2 rounded-full p-2 transition-transform duration-150 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
    >
      {pill}
    </button>
  );
}

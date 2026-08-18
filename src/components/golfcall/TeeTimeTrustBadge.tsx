import { ShieldCheck } from "lucide-react";
import type { TeeTimeSource } from "../../types";
import { useLocale } from "../../i18n/LocaleContext";

interface TeeTimeTrustBadgeProps {
  source: TeeTimeSource;
  onClick?: () => void;
  className?: string;
}

// Only ever rendered for 'user_verified' — 'manual' deliberately shows no
// badge at all here (the brief: "simply avoid a verification badge" for a
// normal host-entered round; GolfCallDetail's existing teeTimeDisclaimer
// text already covers that case). 'provider_verified' has no UI yet on
// purpose — nothing in this codebase ever sets it.
export function TeeTimeTrustBadge({ source, onClick, className = "" }: TeeTimeTrustBadgeProps) {
  const { t } = useLocale();
  if (source !== "user_verified") return null;

  const content = (
    <span className={`inline-flex items-center gap-1 rounded-full bg-fairway-50 px-2.5 py-1 text-xs font-semibold text-fairway-700 ${className}`}>
      <ShieldCheck size={12} /> {t("golfCallDetail.bookingProofBadge")}
    </span>
  );

  if (!onClick) return content;
  return (
    <button onClick={onClick} className="text-left">
      {content}
    </button>
  );
}

import { Crown, ShieldCheck, Sparkles } from "lucide-react";
import type { GolferProfile } from "../../types";
import { isNewAccount } from "../../lib/format";
import { Badge } from "../ui/Badge";
import { useLocale } from "../../i18n/LocaleContext";

export function VerifiedBadge() {
  const { t } = useLocale();
  return (
    <Badge tone="fairway" icon={<ShieldCheck size={12} />}>
      {t("trust.verifiedGolfer")}
    </Badge>
  );
}

export function FounderBadge() {
  const { t } = useLocale();
  return (
    <Badge tone="fairway" icon={<Crown size={12} />}>
      {t("trust.founder")}
    </Badge>
  );
}

export function NewAccountBadge() {
  const { t } = useLocale();
  return (
    <Badge tone="sun" icon={<Sparkles size={12} />}>
      {t("trust.newToGolfMe")}
    </Badge>
  );
}

export function TrustBadgeRow({ golfer, className = "" }: { golfer: GolferProfile; className?: string }) {
  const isNew = isNewAccount(golfer.reputation.completedRounds);
  if (!golfer.verification.verifiedGolfer && !isNew) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {golfer.verification.verifiedGolfer && <VerifiedBadge />}
      {isNew && <NewAccountBadge />}
    </div>
  );
}

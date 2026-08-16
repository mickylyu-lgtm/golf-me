import { MapPin, Wallet, Footprints, Car } from "lucide-react";
import type { GolferProfile } from "../../types";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { formatBudgetRange, handicapLabel } from "../../lib/format";
import { vibeLabel, walkOrCartLabel } from "../../lib/enumLabels";
import { VIBE_TONE } from "../../lib/theme";
import { CompatibilityBadge } from "./CompatibilityBadge";
import { ReputationRow } from "./ReputationRow";
import { TrustBadgeRow } from "./TrustBadges";
import { CLICKABLE_CARD_CLASS } from "../ui/cardStyles";
import type { CompatibilityBreakdown } from "../../lib/compatibility";
import { useLocale } from "../../i18n/LocaleContext";

interface GolferCardProps {
  golfer: GolferProfile;
  compatibility: CompatibilityBreakdown;
  onClick?: () => void;
}

export function GolferCard({ golfer, compatibility, onClick }: GolferCardProps) {
  const { t } = useLocale();
  return (
    <button onClick={onClick} className={`flex w-full flex-col gap-3 p-4 text-left ${CLICKABLE_CARD_CLASS}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar golfer={golfer} size="lg" />
          <div>
            <p className="font-bold text-slate-900">
              {golfer.name} <span className="font-normal text-slate-400">· {golfer.ageRange}</span>
            </p>
            <p className="flex items-center gap-1 text-xs text-slate-500">
              <MapPin size={12} /> {t("golfCallCard.miAway", { miles: golfer.distanceMiles.toFixed(1) })} · {golfer.areaLabel}
            </p>
          </div>
        </div>
        <CompatibilityBadge score={compatibility.overall} size="sm" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge tone="outline">{handicapLabel(golfer.handicap, t)}</Badge>
        {golfer.vibes.slice(0, 2).map((v) => (
          <Badge key={v} tone={VIBE_TONE[v]}>
            {vibeLabel(v, t)}
          </Badge>
        ))}
      </div>

      <p className="line-clamp-2 text-sm text-slate-500">{golfer.bio}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Wallet size={12} /> {formatBudgetRange(golfer.budgetMin, golfer.budgetMax, golfer.noBudgetPreference, t)}
        </span>
        <span className="flex items-center gap-1">
          {golfer.walkOrCart === "Walking" ? <Footprints size={12} /> : <Car size={12} />}
          {walkOrCartLabel(golfer.walkOrCart, t)}
        </span>
      </div>

      <TrustBadgeRow golfer={golfer} />

      <div className="border-t border-slate-100 pt-2.5">
        <ReputationRow golfer={golfer} compact />
      </div>
    </button>
  );
}

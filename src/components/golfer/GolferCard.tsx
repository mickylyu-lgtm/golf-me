import { MapPin, Wallet, Footprints, Car } from "lucide-react";
import type { GolferProfile } from "../../types";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { handicapLabel } from "../../lib/format";
import { VIBE_TONE } from "../../lib/theme";
import { CompatibilityBadge } from "./CompatibilityBadge";
import { ReputationRow } from "./ReputationRow";
import { TrustBadgeRow } from "./TrustBadges";
import type { CompatibilityBreakdown } from "../../lib/compatibility";

interface GolferCardProps {
  golfer: GolferProfile;
  compatibility: CompatibilityBreakdown;
  onClick?: () => void;
}

export function GolferCard({ golfer, compatibility, onClick }: GolferCardProps) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm shadow-slate-900/[0.03] transition hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar golfer={golfer} size="lg" />
          <div>
            <p className="font-bold text-slate-900">
              {golfer.name} <span className="font-normal text-slate-400">· {golfer.ageRange}</span>
            </p>
            <p className="flex items-center gap-1 text-xs text-slate-500">
              <MapPin size={12} /> {golfer.distanceMiles.toFixed(1)} mi away · {golfer.areaLabel}
            </p>
          </div>
        </div>
        <CompatibilityBadge score={compatibility.overall} size="sm" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge tone="outline">{handicapLabel(golfer.handicap)}</Badge>
        {golfer.vibes.slice(0, 2).map((v) => (
          <Badge key={v} tone={VIBE_TONE[v]}>
            {v}
          </Badge>
        ))}
      </div>

      <p className="line-clamp-2 text-sm text-slate-500">{golfer.bio}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Wallet size={12} /> ${golfer.budgetMin}–${golfer.budgetMax}/round
        </span>
        <span className="flex items-center gap-1">
          {golfer.walkOrCart === "Walking" ? <Footprints size={12} /> : <Car size={12} />}
          {golfer.walkOrCart}
        </span>
      </div>

      <TrustBadgeRow golfer={golfer} />

      <div className="border-t border-slate-100 pt-2.5">
        <ReputationRow golfer={golfer} compact />
      </div>
    </button>
  );
}

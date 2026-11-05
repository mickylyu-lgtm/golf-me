import { MapPin, Send, UserRound } from "lucide-react";
import type { GolferProfile } from "../../types";
import type { CompatibilityBreakdown } from "../../lib/compatibility";
import { golferMatchReasons } from "../../lib/matchReasons";
import { golferDistanceLabel } from "../../lib/publicDirectory";
import { useLocale } from "../../i18n/LocaleContext";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { CompatibilityBadge } from "../golfer/CompatibilityBadge";
import { FoundingMark } from "../golfer/FoundingGolfer";
import { MatchReasons } from "../golfer/MatchReasons";

interface AutoMatchGolferCardProps {
  golfer: GolferProfile;
  compatibility: CompatibilityBreakdown;
  distanceMiles: number | undefined;
  // False when messaging isn't allowed (they blocked you): no Invite button.
  canInvite: boolean;
  onInvite: () => void;
  onViewProfile: () => void;
}

// A golfer suggested by Auto-Match: the same match tier and reasons as the
// golfer list and profile (lib/matchReasons), plus "Invite to play", which
// only prefills a DM (lib/useInviteToPlay) and never sends it.
export function AutoMatchGolferCard({ golfer, compatibility, distanceMiles, canInvite, onInvite, onViewProfile }: AutoMatchGolferCardProps) {
  const { t } = useLocale();
  // A server range ("5–10 mi") when the directory supplies one, else whole miles.
  const distance = golferDistanceLabel(golfer, distanceMiles, t);
  const reasons = golferMatchReasons(compatibility, t, distance).filter((r) => r.positive).slice(0, 2);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar golfer={golfer} size="md" />
          <div className="min-w-0">
            <p className="truncate font-bold text-slate-900">
              {golfer.name} <FoundingMark golfer={golfer} />
            </p>
            <p className="flex min-w-0 items-center gap-1 text-xs text-slate-500">
              <MapPin size={12} className="shrink-0" />
              <span className="truncate">{[distance, golfer.areaLabel].filter(Boolean).join(" · ")}</span>
            </p>
          </div>
        </div>
        <CompatibilityBadge score={compatibility.overall} size="sm" />
      </div>
      <MatchReasons reasons={reasons} />
      <div className="flex items-center gap-2">
        {canInvite && (
          <Button size="sm" className="min-h-11 flex-1" icon={<Send size={14} />} onClick={onInvite}>
            {t("golferProfile.inviteToPlay")}
          </Button>
        )}
        <Button size="sm" variant="outline" className="min-h-11 flex-1" icon={<UserRound size={14} />} onClick={onViewProfile}>
          {t("autoMatch.viewProfile")}
        </Button>
      </div>
    </div>
  );
}

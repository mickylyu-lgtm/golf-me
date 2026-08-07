import { ShieldCheck, Sparkles } from "lucide-react";
import type { GolferProfile } from "../../types";
import { isNewAccount } from "../../lib/format";
import { Badge } from "../ui/Badge";

export function VerifiedBadge() {
  return (
    <Badge tone="fairway" icon={<ShieldCheck size={12} />}>
      Verified Golfer
    </Badge>
  );
}

export function NewAccountBadge() {
  return (
    <Badge tone="sun" icon={<Sparkles size={12} />}>
      New to Golf Me
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

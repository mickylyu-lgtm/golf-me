import { ShieldCheck } from "lucide-react";
import type { GolferProfile } from "../../types";

const SIZE_CLASSES = {
  xs: "h-7 w-7 text-[10px]",
  sm: "h-9 w-9 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-16 w-16 text-lg",
  xl: "h-24 w-24 text-2xl",
} as const;

interface AvatarProps {
  golfer: Pick<GolferProfile, "avatarColor" | "avatarInitials" | "verification">;
  size?: keyof typeof SIZE_CLASSES;
  showVerified?: boolean;
}

export function Avatar({ golfer, size = "md", showVerified = true }: AvatarProps) {
  const badgeSize = size === "xl" ? 22 : size === "lg" ? 18 : size === "md" ? 14 : 11;
  return (
    <div className="relative inline-flex shrink-0">
      <div
        className={`flex items-center justify-center rounded-full bg-gradient-to-br font-bold text-white ${golfer.avatarColor} ${SIZE_CLASSES[size]}`}
      >
        {golfer.avatarInitials}
      </div>
      {showVerified && golfer.verification.verifiedGolfer && (
        <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-white p-0.5 shadow-sm">
          <ShieldCheck size={badgeSize} className="text-fairway-600" fill="currentColor" fillOpacity={0.15} />
        </span>
      )}
    </div>
  );
}

import { UserRoundCheck, UserRoundPlus } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import type { FriendSearchResult } from "../../lib/useFriendSearch";

interface GolferSearchResultRowProps {
  golfer: FriendSearchResult;
  following: boolean;
  onOpenProfile: () => void;
  onToggleFollow: () => void;
}

// Shared between FindFriends' typed-search results and its "Suggested for
// you" list — both return the exact same FriendSearchResult shape (the
// suggested_golfer_profiles() RPC mirrors search_golfer_profiles()'s field
// list on purpose), so one row renderer covers both instead of the two
// lists growing their own slightly-different markup.
export function GolferSearchResultRow({ golfer, following, onOpenProfile, onToggleFollow }: GolferSearchResultRowProps) {
  const { t } = useLocale();
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3">
      <button onClick={onOpenProfile} className="flex flex-1 items-center gap-3 text-left">
        <Avatar
          golfer={{
            avatarColor: golfer.avatarColor,
            avatarInitials: golfer.avatarInitials,
            photoUrl: golfer.photoUrl,
            verification: { phoneVerified: false, emailVerified: false, verifiedGolfer: false },
          }}
          size="sm"
          showVerified={false}
        />
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-800">{golfer.name}</p>
          <p className="text-xs text-slate-500">
            {golfer.username && <>@{golfer.username} · </>}
            {golfer.handicap !== null ? t("golfCallDetail.handicapValue", { handicap: golfer.handicap }) : t("golfCallDetail.noHandicapYet")}
            {golfer.areaLabel && <> · {golfer.areaLabel}</>}
          </p>
        </div>
      </button>
      <Button
        size="sm"
        variant={following ? "outline" : "primary"}
        icon={following ? <UserRoundCheck size={14} /> : <UserRoundPlus size={14} />}
        onClick={onToggleFollow}
      >
        {following ? t("common.following") : t("common.follow")}
      </Button>
    </div>
  );
}

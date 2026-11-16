import { FollowControl } from "../profile/FollowControl";
import { useLocale } from "../../i18n/LocaleContext";
import { Avatar } from "../ui/Avatar";
import { FoundingMark } from "./FoundingGolfer";
import type { FriendSearchResult } from "../../lib/useFriendSearch";

interface GolferSearchResultRowProps {
  golfer: FriendSearchResult;
  onOpenProfile: () => void;
}

// One row of Play > Golfers' name-search results (search_golfer_profiles()'s
// FriendSearchResult shape).
export function GolferSearchResultRow({ golfer, onOpenProfile }: GolferSearchResultRowProps) {
  const { t } = useLocale();
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3">
      <button onClick={onOpenProfile} className="flex min-w-0 flex-1 items-center gap-3 text-left">
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
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-slate-800">
            {golfer.name}{" "}<FoundingMark golfer={golfer} />
          </p>
          <p className="truncate text-xs text-slate-500">
            {golfer.username && <>@{golfer.username} · </>}
            {golfer.handicap !== null ? t("golfCallDetail.handicapValue", { handicap: golfer.handicap }) : t("golfCallDetail.noHandicapYet")}
            {golfer.areaLabel && <> · {golfer.areaLabel}</>}
          </p>
        </div>
      </button>
      <FollowControl profileId={golfer.id} name={golfer.name} />
    </div>
  );
}

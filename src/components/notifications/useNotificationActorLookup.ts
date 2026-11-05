import { useMemo } from "react";
import type { GolferProfile } from "../../types";
import { useData } from "../../context/DataContext";
import type { ActorLookup } from "../../lib/notificationInbox";

/**
 * Who a notification shows, from what this client already holds: the
 * profiles RealSocialContext batch-fetches for every notification actor on
 * each refetch (golfer_public_profiles, which drops anyone blocked either
 * way; one request per 200 missing ids), or the demo roster. New-round
 * alerts also need the host in the public directory (lib/notificationInbox).
 */
export function useNotificationActorLookup(): ActorLookup<GolferProfile> {
  const { currentUser, getGolfer, isBlockedEitherWay, visibleGolfers } = useData();
  const listed = useMemo(() => new Set(visibleGolfers(true).map((g) => g.id)), [visibleGolfers]);
  return useMemo(
    () => ({ selfId: currentUser.id, getProfile: getGolfer, isBlockedEitherWay, isListed: (id: string) => listed.has(id) }),
    [currentUser.id, getGolfer, isBlockedEitherWay, listed],
  );
}

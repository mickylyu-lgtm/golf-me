import { useCallback, useRef, useState } from "react";
import { UserRoundCheck, UserRoundPlus, Clock3 } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useLocale } from "../../i18n/LocaleContext";
import { useToast } from "../../context/ToastContext";
import { useSocialRead } from "../../lib/useSocialRead";
import { Button } from "../ui/Button";

export function FollowControl({ profileId, name }: { profileId: string; name: string }) {
  const { currentUser } = useData();
  return <FollowControlForViewer key={currentUser.id + ":" + profileId} profileId={profileId} name={name} />;
}
function FollowControlForViewer({ profileId, name }: { profileId: string; name: string }) {
  const { currentUser, getFollowState, followUser, unfollowUser, cancelFollowRequest, isBlockedEitherWay } = useData();
  const { t } = useLocale();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const permitted = currentUser.id !== profileId && !isBlockedEitherWay(profileId);
  const read = useCallback(() => getFollowState(profileId), [getFollowState, profileId]);
  const { value: state, failed, retry } = useSocialRead(read, permitted);
  if (!permitted) return null;
  if (failed) return <Button size="sm" variant="outline" onClick={retry} title={t("socialPrivacy.followUnavailable")}>{t("socialPrivacy.followRetry")}</Button>;
  return <Button size="sm" variant={state?.state === "none" ? "primary" : "outline"}
    icon={state?.state === "following" ? <UserRoundCheck size={14} /> : state?.state === "pending" ? <Clock3 size={14} /> : <UserRoundPlus size={14} />}
    disabled={!state || busy} title={state?.state === "pending" ? t("socialPrivacy.cancelRequest") : undefined}
    onClick={async () => {
      if (!state || lock.current) return;
      lock.current = true; setBusy(true);
      try {
        if (state.state === "pending" && state.requestId) {
          await cancelFollowRequest(state.requestId);
          showToast(t("socialPrivacy.cancelled"), "info");
        } else if (state.state === "following") {
          await unfollowUser(profileId);
          showToast(t("golferProfile.unfollowedToast", { name }), "info");
        } else {
          const next = await followUser(profileId);
          showToast(next.state === "pending" ? t("socialPrivacy.requestSent") : t("golferProfile.followingToast", { name }), "success");
        }
        retry();
      } catch { showToast(t("golferProfile.followFailed"), "warning"); retry(); }
      finally { lock.current = false; setBusy(false); }
    }}>
    {!state ? t("followers.loading") : state.state === "pending" ? <span>{t("socialPrivacy.requested")}<span className="block text-[10px] font-normal">{t("socialPrivacy.cancelRequest")}</span></span>
      : state.state === "following" ? t("common.following") : t("common.follow")}
  </Button>;
}

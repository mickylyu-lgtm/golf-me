import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useLocale } from "../i18n/LocaleContext";
import type { GolferProfile } from "../types";
import { dmDraftKey, loadChatDraft, saveChatDraft } from "./chatDraft";
import { firstName } from "./greeting";
import { inviteDraftToSeed } from "./inviteToPlay";

// "Invite to play" (golfer profile, Auto-Match golfer cards): opens the DM
// with a suggested first message in the composer (an unsent draft there
// wins). Nothing is sent until the golfer taps Send themselves
// (lib/inviteToPlay.ts).
export function useInviteToPlay(): (target: Pick<GolferProfile, "id" | "name">) => void {
  const navigate = useNavigate();
  const { t } = useLocale();
  return useCallback(
    (target) => {
      try {
        const seed = inviteDraftToSeed(loadChatDraft(dmDraftKey(target.id)), t("golferProfile.inviteDraft", { name: firstName(target.name) }));
        if (seed) saveChatDraft(dmDraftKey(target.id), seed);
      } catch {
        // Storage blocked: the thread still opens, just with an empty composer.
      }
      navigate(`/messages/${target.id}`);
    },
    [navigate, t],
  );
}

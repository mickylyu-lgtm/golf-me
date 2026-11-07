import { useRef } from "react";
import { useNavigate } from "react-router-dom";

const TAP_MAX_MS = 500;
const TAP_SLOP_PX = 10;
import { Avatar } from "../ui/Avatar";
import { useLocale } from "../../i18n/LocaleContext";
import type { GolferProfile } from "../../types";

// A message row's avatar in a chat (DM thread rows, round chat rows): tap
// opens that golfer's profile (/golfer/<id>), your own opens your profile
// (/profile), the same routes GroupChat used. A tap only: the avatar is not
// part of the bubble, so it never starts the hold menu, swipe-to-reply or an
// album deck drag; a long press magnifies the photo (Avatar swallows the
// click after it). `replyAvatar` keeps the data-reply-avatar hook that
// useSwipeToReply moves with the bubble on real message rows.
export function ChatAvatarButton({
  golfer,
  isMe,
  replyAvatar = false,
}: {
  golfer: Pick<GolferProfile, "id" | "name" | "avatarColor" | "avatarInitials" | "verification" | "photoUrl">;
  isMe: boolean;
  replyAvatar?: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useLocale();
  // A tap only: the click that ends a hold or a drag (swipe-to-reply moves
  // the avatar with the bubble) is ignored.
  const press = useRef<{ x: number; y: number; t: number } | null>(null);
  const label = isMe ? t("chat.viewYourProfile") : t("chat.viewProfileOf", { name: golfer.name });
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        press.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      }}
      onClick={(e) => {
        const p = press.current;
        press.current = null;
        if (p && e.detail > 0 && (Date.now() - p.t > TAP_MAX_MS || Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP_PX)) return;
        navigate(isMe ? "/profile" : `/golfer/${golfer.id}`);
      }}
      data-reply-avatar={replyAvatar ? "" : undefined}
      data-chat-avatar={isMe ? "me" : golfer.id}
      className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
    >
      <Avatar golfer={golfer} size="xs" showVerified={false} />
    </button>
  );
}

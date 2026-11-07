import type React from "react";
import {
  Bell,
  UserPlus,
  UserMinus,
  Users,
  Ban,
  MessageCircle,
  ShieldCheck,
  ShieldOff,
  Flag,
  Trophy,
  Clock,
  MapPin,
  Newspaper,
  TriangleAlert,
  FileCheck2,
  ThumbsUp,
  EyeOff,
} from "lucide-react";
import type { AppNotification, GolferProfile, NotificationType } from "../../types";
import { Avatar } from "../ui/Avatar";
import { GolfMeIcon } from "../brand/GolfMeIcon";
import { CaddieNavIcon } from "../icons/CaddieNavIcon";
import { notificationBadgeKind, resolveNotificationActor } from "../../lib/notificationInbox";
import type { ActorLookup, NotificationBadgeKind } from "../../lib/notificationInbox";

// Icon type is the common shape actually invoked below (just `size`), not
// `typeof Bell` — that would reject CaddieNavIcon, a hand-built SVG rather
// than a lucide-react ForwardRefExoticComponent (same reasoning as
// lib/nav.ts's NavIconComponent for the bottom nav's own Caddie icon).
type NotificationIconComponent = (props: { size?: number | string; strokeWidth?: number }) => React.ReactNode;

const ICONS: Record<NotificationType, NotificationIconComponent> = {
  post_reply: MessageCircle,
  comment_reply: MessageCircle,
  new_follower: UserPlus,
  round_created_from_post: Flag,
  post_became_round: Trophy,
  round_joined: Users,
  round_left: UserMinus,
  round_cancelled: Ban,
  new_message: MessageCircle,
  booking_proof_attached: ShieldCheck,
  tee_time_updated: Clock,
  booking_proof_removed: ShieldOff,
  caddie_analysis_complete: CaddieNavIcon,
  new_round_nearby: MapPin,
  circle_post: Newspaper,
  booking_status_changed: TriangleAlert,
  booking_evidence_reviewed: FileCheck2,
  // Same glyph as the post's like button.
  post_liked: ThumbsUp,
  // Migration 20261107270000: an admin removed your post / comment.
  post_removed: EyeOff,
  comment_removed: EyeOff,
};

const BADGE_CLASSES: Record<NotificationBadgeKind, string> = {
  message: "bg-sky-500 text-white",
  comment: "bg-indigo-500 text-white",
  like: "bg-fairway-500 text-white",
  round: "bg-fairway-600 text-white",
  roundAlert: "bg-emerald-500 text-white",
  follow: "bg-amber-500 text-white",
  caddie: "bg-white text-slate-800",
  post: "bg-violet-500 text-white",
  booking: "bg-teal-600 text-white",
  other: "bg-slate-500 text-white",
};

const SIZES = {
  sm: { box: "h-9 w-9", avatar: "sm", icon: 20, badge: "h-4 w-4", glyph: 9 },
  md: { box: "h-10 w-10", avatar: "md", icon: 22, badge: "h-4 w-4", glyph: 9 },
} as const;

/**
 * The actor's photo (initials when there's none, or when blocked either
 * way), else the GolfMe icon, with a small type badge on the corner.
 * Decorative: it sits inside the row/banner button, so tapping it does
 * what tapping the row does.
 */
export function NotificationAvatar({
  notification,
  lookup,
  size = "md",
}: {
  notification: Pick<AppNotification, "type" | "actorId">;
  lookup: ActorLookup<GolferProfile>;
  size?: keyof typeof SIZES;
}) {
  const actor = resolveNotificationActor(notification, lookup);
  const s = SIZES[size];
  const Glyph = ICONS[notification.type] ?? Bell;
  const kind = notificationBadgeKind(notification.type);
  return (
    <span className={`relative inline-flex shrink-0 ${s.box}`} aria-hidden="true" data-notification-avatar={actor.kind}>
      {actor.kind === "person" ? (
        <Avatar golfer={actor.showPhoto ? actor.profile : { ...actor.profile, photoUrl: undefined }} size={s.avatar} showVerified={false} />
      ) : (
        // The flat mark on the app icon's forest green (same colours as
        // Welcome's hero); the gradient variant's square doesn't crop to a
        // circle cleanly and its hole sits under the badge.
        <span className={`flex items-center justify-center rounded-full bg-[#14532d] shadow-sm ${s.box}`}>
          <GolfMeIcon size={s.icon} dotColor="#f8faf8" flagColor="#86efac" holeColor="#14532d" />
        </span>
      )}
      <span
        className={`absolute -bottom-1 -right-1 flex items-center justify-center rounded-full ring-2 ring-white ${s.badge} ${BADGE_CLASSES[kind]}`}
      >
        <Glyph size={kind === "caddie" ? s.glyph + 3 : s.glyph} strokeWidth={2.5} />
      </span>
    </span>
  );
}

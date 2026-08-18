import { useNavigate } from "react-router-dom";
import { Bell, UserPlus, UserMinus, Users, Ban, MessageCircle, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import type { AppNotification, NotificationType } from "../../types";
import { useData } from "../../context/DataContext";
import { Modal } from "../ui/Modal";
import { EmptyState } from "../ui/EmptyState";
import { formatRelativeTime } from "../../lib/format";
import { useLocale } from "../../i18n/LocaleContext";

const ICONS: Record<NotificationType, typeof Bell> = {
  post_reply: MessageCircle,
  comment_reply: MessageCircle,
  new_follower: UserPlus,
  round_created_from_post: Sparkles,
  post_became_round: Trophy,
  round_joined: Users,
  round_left: UserMinus,
  round_cancelled: Ban,
  new_message: MessageCircle,
  booking_proof_attached: ShieldCheck,
};

export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { notifications, markNotificationRead, markAllNotificationsRead } = useData();
  const navigate = useNavigate();
  const { t, locale } = useLocale();

  function open(n: AppNotification) {
    markNotificationRead(n.id);
    onClose();
    navigate(n.linkTo);
  }

  return (
    <Modal title={t("notifications.title")} onClose={onClose}>
      {notifications.length === 0 ? (
        <EmptyState icon={<Bell size={20} />} title={t("notifications.empty")} description={t("notifications.emptyDescription")} />
      ) : (
        <div className="flex flex-col gap-1">
          <div className="mb-1 flex justify-end">
            <button onClick={markAllNotificationsRead} className="text-xs font-semibold text-fairway-700 hover:underline">
              {t("notifications.markAllRead")}
            </button>
          </div>
          {notifications.map((n) => {
            const Icon = ICONS[n.type];
            return (
              <button
                key={n.id}
                onClick={() => open(n)}
                className={`flex items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-150 ${
                  n.read ? "hover:bg-slate-50" : "bg-fairway-50/70 hover:bg-fairway-50"
                }`}
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-fairway-600 shadow-sm">
                  <Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${n.read ? "text-slate-600" : "font-semibold text-slate-900"}`}>{n.text}</p>
                  <p className="text-xs text-slate-400">{formatRelativeTime(n.createdAt, locale, t)}</p>
                </div>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-fairway-600" aria-label="Unread" />}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

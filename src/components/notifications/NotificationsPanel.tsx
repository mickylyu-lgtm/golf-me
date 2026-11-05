import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, ChevronDown } from "lucide-react";
import type { AppNotification, GolferProfile } from "../../types";
import { useData } from "../../context/DataContext";
import { Modal } from "../ui/Modal";
import { EmptyState } from "../ui/EmptyState";
import { formatRelativeTime } from "../../lib/format";
import { useLocale } from "../../i18n/LocaleContext";
import { groupNotifications } from "../../lib/notificationInbox";
import type { ActorLookup } from "../../lib/notificationInbox";
import { NotificationAvatar } from "./NotificationAvatar";
import { useNotificationActorLookup } from "./useNotificationActorLookup";

// Unread notifications are the list; once read (tapped here, "Mark all
// read", or by opening what they point at, see NotificationRouteClearer)
// they move into a collapsed "Earlier" section, so the bell never stacks up.
export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { notifications, markNotificationRead, markAllNotificationsRead } = useData();
  const navigate = useNavigate();
  const { t } = useLocale();
  const lookup = useNotificationActorLookup();
  const [showEarlier, setShowEarlier] = useState(false);
  const { unread, earlier } = groupNotifications(notifications);

  function open(n: AppNotification) {
    if (!n.read) markNotificationRead(n.id);
    onClose();
    navigate(n.linkTo);
  }

  return (
    <Modal title={t("notifications.title")} onClose={onClose}>
      {notifications.length === 0 ? (
        <EmptyState icon={<Bell size={20} />} title={t("notifications.empty")} description={t("notifications.emptyDescription")} />
      ) : (
        <div className="flex flex-col gap-1">
          {unread.length > 0 ? (
            <>
              <div className="mb-1 flex justify-end">
                <button onClick={markAllNotificationsRead} className="text-xs font-semibold text-fairway-700 hover:underline">
                  {t("notifications.markAllRead")}
                </button>
              </div>
              {unread.map((n) => (
                <NotificationRow key={n.id} n={n} lookup={lookup} onOpen={open} />
              ))}
            </>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-fairway-50/70 px-3 py-3 text-sm font-medium text-fairway-800">
              <CheckCheck size={16} className="shrink-0 text-fairway-600" />
              {t("notifications.caughtUp")}
            </div>
          )}

          {earlier.length > 0 && (
            <div className="mt-2 border-t border-slate-100 pt-2">
              <button
                onClick={() => setShowEarlier((v) => !v)}
                aria-expanded={showEarlier}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-50"
              >
                <span>
                  {t("notifications.earlier")} <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{earlier.length}</span>
                </span>
                <ChevronDown size={16} className={`transition-transform duration-200 motion-reduce:transition-none ${showEarlier ? "rotate-180" : ""}`} />
              </button>
              {showEarlier && (
                <div className="mt-1 flex flex-col gap-1">
                  {earlier.map((n) => (
                    <NotificationRow key={n.id} n={n} lookup={lookup} onOpen={open} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function NotificationRow({
  n,
  lookup,
  onOpen,
}: {
  n: AppNotification;
  lookup: ActorLookup<GolferProfile>;
  onOpen: (n: AppNotification) => void;
}) {
  const { t, locale } = useLocale();
  return (
    <button
      onClick={() => onOpen(n)}
      data-notification-row={n.read ? "read" : "unread"}
      className={`flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-150 ${
        n.read ? "hover:bg-slate-50" : "bg-fairway-50/70 hover:bg-fairway-50"
      }`}
    >
      <NotificationAvatar notification={n} lookup={lookup} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${n.read ? "text-slate-500" : "font-semibold text-slate-900"}`}>{n.text}</p>
        <p className="text-xs text-slate-400">{formatRelativeTime(n.createdAt, locale, t)}</p>
      </div>
      {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-fairway-500" aria-label={t("notifications.unread")} />}
    </button>
  );
}

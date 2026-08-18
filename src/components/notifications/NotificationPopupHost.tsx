import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, X } from "lucide-react";
import { useData } from "../../context/DataContext";
import { Avatar } from "../ui/Avatar";
import type { AppNotification, NotificationType } from "../../types";

// Only these types are worth interrupting the user for while they're
// actively in the app — explicitly NOT every notification type (upvotes,
// profile views, etc. never existed as notification rows anyway, but this
// still excludes round_left/round_created_from_post/post_became_round,
// which the brief's own examples didn't ask for).
const POPUP_TYPES = new Set<NotificationType>(["new_message", "round_joined", "round_cancelled", "post_reply", "comment_reply", "booking_proof_attached"]);

const AUTO_DISMISS_MS = 4500;
// Real accounts' `notifications` starts as an empty array before
// RealSocialContext's async fetch resolves — locking the "already seen"
// baseline in immediately (on the very first render) meant a returning
// user's entire existing history looked "new" the instant it actually
// loaded a beat later, re-popping already-read notifications on every
// login. Waiting this long before capturing the baseline gives the real
// fetch time to land first in virtually every case.
const BASELINE_GRACE_MS = 1200;

// Deliberately driven by useData().notifications (already branched demo/
// real, already the thing RealSocialContext's own realtime subscription
// keeps in sync) rather than a second, separate Supabase subscription —
// diffing this array for ids not seen before correctly catches only
// genuinely new rows regardless of whether the underlying refetch was
// triggered by an INSERT or an unrelated UPDATE (e.g. mark-as-read), and
// gets demo-mode parity for free since demo notifications flow through
// the same field. Never invents an event the backend didn't produce.
export function NotificationPopupHost() {
  const { notifications, getGolfer } = useData();
  const navigate = useNavigate();
  const seenIds = useRef<Set<string> | null>(null);
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;
  const [queue, setQueue] = useState<AppNotification[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Capture the baseline once, after a grace period, from whatever
    // notifications looks like AT THAT TIME (via the ref, so this doesn't
    // close over the empty array present on mount) — not immediately on
    // mount, when the real fetch hasn't resolved yet.
    const timer = setTimeout(() => {
      seenIds.current = new Set(notificationsRef.current.map((n) => n.id));
    }, BASELINE_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (seenIds.current === null) {
      // Still within the grace period — don't treat the real fetch landing
      // as a burst of "new" notifications.
      return;
    }
    const fresh = notifications.filter((n) => !seenIds.current!.has(n.id));
    for (const n of fresh) seenIds.current!.add(n.id);
    const poppable = fresh.filter((n) => POPUP_TYPES.has(n.type));
    if (poppable.length > 0) {
      // Oldest-first so a burst of simultaneous events (e.g. several
      // replies while away from the phone for a minute) plays back in the
      // order they happened, not reverse.
      setQueue((prev) => [...prev, ...[...poppable].sort((a, b) => a.createdAt.localeCompare(b.createdAt))]);
    }
  }, [notifications]);

  const current = queue[0];

  useEffect(() => {
    if (!current) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const dismissTimer = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    // Actually pop the queue entry shortly after the fade-out starts, so
    // the exit transition can play instead of an instant cut.
    const popTimer = setTimeout(() => setQueue((prev) => prev.slice(1)), AUTO_DISMISS_MS + 220);
    return () => {
      clearTimeout(dismissTimer);
      clearTimeout(popTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!current) return null;

  function dismissNow() {
    setVisible(false);
    setTimeout(() => setQueue((prev) => prev.slice(1)), 220);
  }

  function handleTap() {
    navigate(current.linkTo);
    dismissNow();
  }

  const actor = current.actorId ? getGolfer(current.actorId) : undefined;

  return (
    <div
      className="fixed inset-x-0 top-0 z-[110] flex justify-center px-3"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", pointerEvents: "none" }}
    >
      <div
        role="status"
        aria-live="polite"
        className={`w-full max-w-sm transition-all duration-200 ease-out ${visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"}`}
        style={{ pointerEvents: "auto" }}
      >
        <button
          onClick={handleTap}
          className="flex w-full items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3.5 text-left shadow-lg shadow-slate-900/10"
        >
          <span className="mt-0.5 shrink-0">
            {actor ? (
              <Avatar golfer={actor} size="sm" showVerified={false} />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-fairway-50 text-fairway-600">
                <Bell size={16} />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">{current.text}</span>
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismissNow();
            }}
            aria-label="Dismiss"
            className="mt-0.5 shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={14} />
          </button>
        </button>
      </div>
    </div>
  );
}

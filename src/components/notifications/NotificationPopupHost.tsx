import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, X } from "lucide-react";
import { useData } from "../../context/DataContext";
import { Avatar } from "../ui/Avatar";
import type { AppNotification, NotificationType } from "../../types";

// Only these types are worth interrupting the user for while they're
// actively in the app — explicitly NOT every notification type (upvotes,
// profile views, etc. never existed as notification rows anyway, but this
// still excludes round_left/round_created_from_post/post_became_round,
// which the brief's own examples didn't ask for).
const POPUP_TYPES = new Set<NotificationType>([
  "new_message",
  "round_joined",
  "round_cancelled",
  "post_reply",
  "comment_reply",
  "booking_proof_attached",
  "tee_time_updated",
  "booking_proof_removed",
]);

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
  const location = useLocation();
  const seenIds = useRef<Set<string> | null>(null);
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;
  // Read via a ref inside the notifications effect below (which only
  // depends on `notifications`) rather than adding location.pathname as a
  // dependency there — this only needs the CURRENT path at the moment a
  // fresh notification arrives, not a re-run of that effect on every
  // navigation.
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;
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
    // A new_message notification for the conversation you're actively
    // looking at needs no popup — the message already appears live in the
    // open thread via RealSocialContext's own realtime subscription, so a
    // popup on top of it would just be a redundant "new message from the
    // person you're already texting."
    const poppable = fresh.filter((n) => {
      if (!POPUP_TYPES.has(n.type)) return false;
      if (n.type === "new_message" && n.actorId && pathnameRef.current === `/messages/${n.actorId}`) return false;
      return true;
    });
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
          className="flex w-full items-center gap-2.5 rounded-2xl bg-slate-900/90 p-3 text-left shadow-lg shadow-black/30 backdrop-blur-md"
        >
          <span className="shrink-0">
            {actor ? (
              <Avatar golfer={actor} size="sm" showVerified={false} />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white">
                <Bell size={16} />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white">{current.text}</span>
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismissNow();
            }}
            aria-label="Dismiss"
            className="shrink-0 rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X size={14} />
          </button>
        </button>
      </div>
    </div>
  );
}

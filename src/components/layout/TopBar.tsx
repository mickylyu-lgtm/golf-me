import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronDown } from "lucide-react";
import { useData } from "../../context/DataContext";
import { Avatar } from "../ui/Avatar";
import { GolfMeLogo } from "../brand/GolfMeLogo";
import { NotificationsPanel } from "../notifications/NotificationsPanel";

export function TopBar() {
  const { currentUser, unreadNotificationCount } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // TopBar stays mounted across route changes (it lives above
  // RootTabCarousel), so without this the panel would stay open after
  // navigating away by any means other than tapping a notification itself.
  useEffect(() => {
    setNotificationsOpen(false);
  }, [location.pathname]);

  return (
    // No backdrop-blur-sm here (deliberately) — a backdrop-filter on this
    // header establishes a containing block for descendant `position:
    // fixed` elements in Chromium. bg-[#faf9f6]/95 makes up the visual
    // difference without that side effect. NotificationsPanel's Modal is
    // portaled straight to document.body (see Modal.tsx) rather than
    // rendered here in place — this header's own `position: sticky`
    // turned out to cause the same class of containing-block hijack on
    // iOS Safari specifically (reported live as the notification sheet
    // only showing its first couple rows), so the panel no longer lives
    // in this DOM subtree at all.
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200/70 bg-[#faf9f6]/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
      <div className="sm:hidden">
        <GolfMeLogo size={18} />
      </div>
      <div className="hidden sm:block" />
      <div className="flex items-center gap-2">
        <button
          // Open-only, not a toggle: now that the panel portals to
          // document.body (see Modal.tsx comment above), it's no longer a
          // sibling in this header's stacking context, so this button can't
          // reliably stay paintable above its backdrop to catch a "close"
          // tap. Modal already renders its own visible close (X) button,
          // plus backdrop-tap/Escape/route-change all close it too — a
          // second bell tap isn't the only way out.
          onClick={() => setNotificationsOpen(true)}
          aria-label="Notifications"
          aria-expanded={notificationsOpen}
          className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-all duration-200 ease-out hover:border-fairway-300 hover:text-fairway-700 hover:shadow active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
        >
          <Bell size={16} />
          {unreadNotificationCount > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-fairway-500" aria-label="Unread notifications" />}
        </button>
        <button
          onClick={() => navigate("/profile")}
          className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2.5 shadow-sm transition-all duration-200 ease-out hover:border-fairway-300 hover:shadow active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
        >
          <Avatar golfer={currentUser} size="xs" />
          <span className="hidden text-sm font-semibold text-slate-700 sm:inline">{currentUser.name}</span>
          <ChevronDown size={14} className="text-slate-400" />
        </button>
      </div>

      {notificationsOpen && <NotificationsPanel onClose={() => setNotificationsOpen(false)} />}
    </header>
  );
}

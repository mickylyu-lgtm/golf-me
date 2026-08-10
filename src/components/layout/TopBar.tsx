import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronDown, MessageCircle, Users } from "lucide-react";
import { useData } from "../../context/DataContext";
import { Avatar } from "../ui/Avatar";
import { GolfChatMark } from "../brand/GolfChatMark";
import { GolfMeWordmark } from "../brand/GolfMeWordmark";
import { NotificationsPanel } from "../notifications/NotificationsPanel";

export function TopBar() {
  const { currentUser, hasUnreadMessages, unreadNotificationCount } = useData();
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
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200/70 bg-[#faf8f2]/90 px-4 py-3 backdrop-blur-sm sm:px-6">
      <div className="flex items-center gap-2 sm:hidden">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fairway-600 text-white">
          <GolfChatMark size={18} />
        </span>
        <GolfMeWordmark className="text-lg font-extrabold tracking-tight" golfClassName="text-fairway-900" />
      </div>
      <div className="hidden sm:block" />
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate("/community")}
          aria-label="Community"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-all duration-200 ease-out hover:border-fairway-300 hover:text-fairway-700 hover:shadow active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
        >
          <Users size={16} />
        </button>
        <button
          onClick={() => setNotificationsOpen((v) => !v)}
          aria-label="Notifications"
          aria-expanded={notificationsOpen}
          className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-all duration-200 ease-out hover:border-fairway-300 hover:text-fairway-700 hover:shadow active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
        >
          <Bell size={16} />
          {unreadNotificationCount > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-fairway-600" aria-label="Unread notifications" />}
        </button>
        <button
          onClick={() => navigate("/messages")}
          aria-label="Messages"
          className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-all duration-200 ease-out hover:border-fairway-300 hover:text-fairway-700 hover:shadow active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
        >
          <MessageCircle size={16} />
          {hasUnreadMessages && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-fairway-600" aria-label="Unread messages" />}
        </button>
        <button
          onClick={() => navigate("/settings")}
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

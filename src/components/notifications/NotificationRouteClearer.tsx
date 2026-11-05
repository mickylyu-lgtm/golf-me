import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useData } from "../../context/DataContext";
import { notificationIdsClearedByRoute } from "../../lib/notificationInbox";

// Opening the thing a notification points at clears it from the bell,
// however it was opened (bell, banner, push, Inbox, a round card): a DM
// thread clears that golfer's message notifications, a round (or its chat)
// that round's, a post / analysis / profile the ones linking to it
// (lib/notificationInbox). Mounted once in AppShell, so no screen has to
// remember to do it. Also clears rows that arrive while the screen is open.
// Only while the page is visible: a background browser tab sitting on a
// thread hasn't been read. One batched mark-read per change.
export function NotificationRouteClearer() {
  const { notifications, markNotificationsRead } = useData();
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const ids = notificationIdsClearedByRoute(pathname, notifications);
    if (ids.length > 0) markNotificationsRead(ids);
  }, [visible, pathname, notifications, markNotificationsRead]);

  return null;
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Search, UserPlus } from "lucide-react";
import { Button } from "../components/ui/Button";
import { useLocale } from "../i18n/LocaleContext";
import { track } from "../lib/analytics";

// Shown once, right after first-time profile setup finishes — the
// spec's "first success moment": confirm they're set up, then get them
// straight to Find or Host rather than dropping them on Home with no
// direction. The notification-permission ask is folded in here too
// (shown at most once ever, tracked in localStorage) rather than at
// launch, since it should follow understanding the product, not precede it.
const NOTIF_SHOWN_KEY = "golfme:notifPermissionShown";

export function Ready() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  function go(path: string, eventName?: "first_find_clicked") {
    if (eventName) track(eventName);
    const alreadyShown = typeof window !== "undefined" && window.localStorage.getItem(NOTIF_SHOWN_KEY) === "1";
    if (alreadyShown) {
      navigate(path);
      return;
    }
    track("notifications_permission_shown");
    setPendingPath(path);
  }

  function resolveNotifPermission(enable: boolean) {
    window.localStorage.setItem(NOTIF_SHOWN_KEY, "1");
    if (enable && "Notification" in window) {
      Notification.requestPermission().then((result) => {
        if (result === "granted") track("notifications_permission_granted");
      });
    } else {
      track("notifications_permission_dismissed");
    }
    if (pendingPath) navigate(pendingPath);
  }

  if (pendingPath) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#faf8f2] px-6 py-12 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-fairway-50 text-fairway-600">
          <Bell size={26} />
        </span>
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">{t("notifPermission.title")}</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">{t("notifPermission.body")}</p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-3">
          <Button size="lg" fullWidth onClick={() => resolveNotifPermission(true)}>
            {t("notifPermission.enable")}
          </Button>
          <button
            onClick={() => resolveNotifPermission(false)}
            className="rounded-full px-4 py-2.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
          >
            {t("common.notNow")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[#faf8f2] px-6 py-12 text-center">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">{t("ready.title")}</h1>
        <p className="mt-1.5 text-sm text-slate-500">{t("ready.subtitle")}</p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <Button size="lg" fullWidth icon={<Search size={18} />} onClick={() => go("/find", "first_find_clicked")}>
          {t("home.findRound")}
        </Button>
        <Button size="lg" variant="outline" fullWidth icon={<UserPlus size={18} />} onClick={() => go("/golf-calls/new")}>
          {t("home.hostRound")}
        </Button>
      </div>
    </div>
  );
}

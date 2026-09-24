import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTutorial } from "../../context/TutorialContext";
import { useLocale } from "../../i18n/LocaleContext";
import { Button } from "../ui/Button";
import { checkPushPermission, registerPushNotifications } from "../../lib/push";

const ASKED_KEY = "golfme:pushPrePermissionAsked";

function alreadyAsked(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return true;
  }
}

function markAsked(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // Best-effort only — worst case this screen shows once more than
    // intended, never a crash.
  }
}

// GolfMe's own pre-permission screen, shown at most once ever per device.
// Apple's real system prompt only ever fires from the "Enable Notifications"
// tap below (via registerPushNotifications) — never automatically on login.
// A device that's already decided, either through this screen before or
// through iOS Settings directly, never sees this again; usePushRegistration
// in App.tsx separately keeps an already-granted device's token fresh on
// every app load without ever showing this UI.
export function PushPrePermissionPrompt() {
  const { isDemo, authUser, hasOnboarded } = useAuth();
  const { active: tutorialActive } = useTutorial();
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (isDemo || !authUser || !hasOnboarded || tutorialActive) return;
    if (checkedRef.current || alreadyAsked()) return;
    checkedRef.current = true;
    checkPushPermission().then((state) => {
      if (state === "prompt") {
        setVisible(true);
      } else if (state === "unavailable") {
        // The plugin call failed (e.g. an older native build without the
        // push plugin). Leave the one-time flag unset so a fixed build can
        // still show this screen.
        return;
      } else {
        // Already decided (granted on a previous install, or denied
        // directly in iOS Settings) — nothing for this screen to do.
        markAsked();
      }
    });
  }, [isDemo, authUser, hasOnboarded, tutorialActive]);

  if (!visible || !authUser) return null;

  function dismiss() {
    markAsked();
    setVisible(false);
  }

  function enable() {
    markAsked();
    setVisible(false);
    registerPushNotifications(authUser!.id);
  }

  return (
    <div
      className="fixed inset-0 z-[105] flex items-end justify-center bg-slate-900/40 px-4 pb-8 sm:items-center"
      style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-white p-6 text-center shadow-xl shadow-slate-900/20">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-fairway-50 text-fairway-600">
          <Bell size={26} />
        </span>
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">{t("pushPrePermission.title")}</h2>
          <p className="mt-1.5 text-sm text-slate-500">{t("pushPrePermission.body")}</p>
        </div>
        <div className="flex w-full flex-col gap-2.5">
          <Button size="lg" fullWidth onClick={enable}>
            {t("pushPrePermission.enable")}
          </Button>
          <button
            onClick={dismiss}
            className="rounded-full px-4 py-2.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
          >
            {t("common.notNow")}
          </button>
        </div>
      </div>
    </div>
  );
}

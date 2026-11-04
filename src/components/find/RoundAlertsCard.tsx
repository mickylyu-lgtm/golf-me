import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router-dom";
import { Bell, BellOff, Loader2, MapPin } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/locales/en";
import { checkPushPermission, registerPushNotifications } from "../../lib/push";
import { alertRadiusMiles, askForPushIfUndecided, deriveRoundAlertState, enableRoundAlerts } from "../../lib/roundAlerts";
import type { PushPermission, RoundAlertState } from "../../lib/roundAlerts";
import { Button } from "../ui/Button";

const STATUS_KEY: Record<RoundAlertState, TranslationKey> = {
  noHomeArea: "roundAlerts.noHomeArea",
  off: "roundAlerts.off",
  saving: "roundAlerts.saving",
  saveFailed: "roundAlerts.saveFailed",
  onDemo: "roundAlerts.onDemo",
  onWeb: "roundAlerts.onWeb",
  onChecking: "roundAlerts.onChecking",
  onPush: "roundAlerts.onPush",
  onPushOff: "roundAlerts.onPushOff",
  onPushDenied: "roundAlerts.onPushDenied",
  onPushPrompt: "roundAlerts.onPushPrompt",
  onInApp: "roundAlerts.onInApp",
};

// The honest "Notify me" for an empty round search: turns on (or shows) the
// existing "New rounds near me" alerts. See lib/roundAlerts.ts for what the
// server actually matches on. Demo keeps a local-only switch, same as
// Settings, and never asks for push.
export function RoundAlertsCard() {
  const { currentUser } = useData();
  const { isDemo, notifyNewRounds, pushEnabled: realPushEnabled, saveProfile } = useAuth();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const native = Capacitor.isNativePlatform();

  const [demoNotifyOn, setDemoNotifyOn] = useState(true);
  const notifyOn = isDemo ? demoNotifyOn : notifyNewRounds;
  const pushEnabled = isDemo ? false : realPushEnabled;
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [askingPush, setAskingPush] = useState(false);

  const readPermission = useCallback(() => {
    if (!native || isDemo) return;
    checkPushPermission().then(setPermission);
  }, [native, isDemo]);

  useEffect(() => {
    readPermission();
    // Coming back from iPhone Settings may have changed it.
    const onVisible = () => {
      if (document.visibilityState === "visible") readPermission();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [readPermission]);

  const state = deriveRoundAlertState({
    isDemo,
    hasHomeArea: Boolean(currentUser.playingAreaCoords),
    notifyOn,
    pushEnabled,
    native,
    permission,
    saving,
    saveFailed,
  });
  const radius = alertRadiusMiles(currentUser.travelRadiusMiles);
  const pushDeps = {
    isDemo,
    native,
    pushEnabled,
    checkPermission: checkPushPermission,
    requestPush: () => registerPushNotifications(currentUser.id),
  };

  async function turnOn() {
    if (saving) return;
    setSaving(true);
    setSaveFailed(false);
    const result = await enableRoundAlerts({
      ...pushDeps,
      save: isDemo ? async () => setDemoNotifyOn(true) : () => saveProfile({ notify_new_rounds: true }),
    });
    setSaving(false);
    if (!result.ok) {
      console.error("GolfMe: couldn't turn on new-round alerts.", result.error);
      setSaveFailed(true);
      return;
    }
    if (result.permission) setPermission(result.permission);
    showToast(t("roundAlerts.turnedOn"), "success");
  }

  async function allowPush() {
    if (askingPush) return;
    setAskingPush(true);
    try {
      const next = await askForPushIfUndecided(pushDeps);
      if (next) setPermission(next);
    } finally {
      setAskingPush(false);
    }
  }

  const isOn = state.startsWith("on");
  const icon = state === "saving" ? <Loader2 size={16} className="animate-spin" /> : isOn ? <Bell size={16} /> : state === "noHomeArea" ? <MapPin size={16} /> : <BellOff size={16} />;

  let action: ReactNode = null;
  if (state === "off") {
    action = (
      <Button size="sm" variant="outline" icon={<Bell size={14} />} onClick={turnOn}>
        {t("roundAlerts.turnOn")}
      </Button>
    );
  } else if (state === "saveFailed") {
    action = (
      <Button size="sm" variant="outline" onClick={turnOn}>
        {t("loading.retry")}
      </Button>
    );
  } else if (state === "noHomeArea") {
    action = (
      <Button size="sm" variant="outline" icon={<MapPin size={14} />} onClick={() => navigate("/profile/preferences")}>
        {t("roundAlerts.setHomeArea")}
      </Button>
    );
  } else if (state === "onPushPrompt") {
    action = (
      <Button size="sm" variant="outline" disabled={askingPush} onClick={allowPush}>
        {t("roundAlerts.allowPush")}
      </Button>
    );
  } else if (state === "onPushOff" || state === "onPushDenied") {
    action = (
      <Button size="sm" variant="ghost" onClick={() => navigate("/settings")}>
        {t("roundAlerts.openSettings")}
      </Button>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left" role="status" aria-live="polite">
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            isOn ? "bg-fairway-50 text-fairway-600" : state === "saveFailed" ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">{t(STATUS_KEY[state])}</p>
          {state !== "noHomeArea" && <p className="mt-0.5 text-xs text-slate-500">{t("roundAlerts.scope", { radius })}</p>}
        </div>
      </div>
      {action && <div className="flex justify-end">{action}</div>}
    </div>
  );
}

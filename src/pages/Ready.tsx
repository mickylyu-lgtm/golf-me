import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check } from "lucide-react";
import { Button } from "../components/ui/Button";
import { useLocale } from "../i18n/LocaleContext";
import { track } from "../lib/analytics";
import type { TranslationKey } from "../i18n/locales/en";

// Shown once, right after Quick Profile finishes — the one intent question
// from the shortened onboarding flow ("what are you looking for?"),
// reusing this existing screen rather than building a new one. Intent is
// kept client-side only (no DB column): stored in localStorage so it's
// available for later, lightweight personalization, never persisted server-
// side or required to proceed. The notification-permission ask is folded in
// here too (shown at most once ever, tracked separately in localStorage),
// right before landing on Home.
const NOTIF_SHOWN_KEY = "golfme:notifPermissionShown";
export const ONBOARDING_INTENT_KEY = "golfme:onboardingIntent";

export type OnboardingIntent = "find_people" | "join_round" | "host_round" | "improve_swing";

const INTENT_OPTIONS: { key: OnboardingIntent; labelKey: TranslationKey }[] = [
  { key: "find_people", labelKey: "ready.intentFindPeople" },
  { key: "join_round", labelKey: "ready.intentJoinRound" },
  { key: "host_round", labelKey: "ready.intentHostRound" },
  { key: "improve_swing", labelKey: "ready.intentImproveSwing" },
];

export function Ready() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const [intents, setIntents] = useState<OnboardingIntent[]>([]);
  const [showingNotifAsk, setShowingNotifAsk] = useState(false);

  function toggleIntent(key: OnboardingIntent) {
    setIntents((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function startGolfing() {
    track("onboarding_completed", { intents: intents.length > 0 ? intents.join(",") : "none" });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_INTENT_KEY, JSON.stringify(intents));
    }
    const alreadyShown = typeof window !== "undefined" && window.localStorage.getItem(NOTIF_SHOWN_KEY) === "1";
    if (alreadyShown) {
      navigate("/");
      return;
    }
    track("notifications_permission_shown");
    setShowingNotifAsk(true);
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
    navigate("/");
  }

  if (showingNotifAsk) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#faf9f6] px-6 py-12 text-center">
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[#faf9f6] px-6 py-12 text-center">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">{t("ready.title")}</h1>
        <p className="mt-1.5 text-sm text-slate-500">{t("ready.subtitle")}</p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2.5">
        {INTENT_OPTIONS.map((opt) => {
          const active = intents.includes(opt.key);
          return (
            <button
              key={opt.key}
              onClick={() => toggleIntent(opt.key)}
              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-left text-sm font-semibold transition-all duration-150 ${
                active ? "border-fairway-400 bg-fairway-50 text-fairway-700" : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {t(opt.labelKey)}
              {active && <Check size={16} className="shrink-0 text-fairway-600" />}
            </button>
          );
        })}
      </div>
      <div className="w-full max-w-xs">
        <Button size="lg" fullWidth onClick={startGolfing}>
          {t("profileSetup.startGolfing")}
        </Button>
      </div>
    </div>
  );
}

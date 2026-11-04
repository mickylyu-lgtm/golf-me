import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setOnboardingFinishing } from "../lib/onboardingHandoff";
import { Check } from "lucide-react";
import { Button } from "../components/ui/Button";
import { FoundingGolferReveal } from "../components/golfer/FoundingGolfer";
import { markFoundingRevealSeen } from "../components/golfer/FoundingRevealHost";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../i18n/LocaleContext";
import { track } from "../lib/analytics";
import type { TranslationKey } from "../i18n/locales/en";

// Shown once, right after Quick Profile finishes — the one intent question
// from the shortened onboarding flow ("what are you looking for?"),
// reusing this existing screen rather than building a new one. Intent is
// kept client-side only (no DB column): stored in localStorage so it's
// available for later, lightweight personalization, never persisted server-
// side or required to proceed. A golfer the server just made a Founding
// Golfer sees the number reveal first (ProfileSetup's save refetches the
// profile after the award trigger, so the number is already there).
//
// No notification ask here any more: its "Enable" called the browser
// Notification API, which the iPhone app's web view doesn't have and the
// web never uses (there is no web push), so it did nothing, and iPhone users
// were then asked again by PushPrePermissionPrompt on Home, the real one.
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
  const { isDemo, profile, authUser } = useAuth();
  const [revealDone, setRevealDone] = useState(false);
  useEffect(() => setOnboardingFinishing(false), []);
  // Dev-server only: /ready?previewFounding=8 replays the reveal with that
  // number (stripped from production builds by import.meta.env.DEV).
  const previewNumber = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get("previewFounding")) || undefined : undefined;
  const foundingNumber = previewNumber ?? (isDemo ? undefined : profile?.foundingMemberNumber);

  function toggleIntent(key: OnboardingIntent) {
    setIntents((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function startGolfing() {
    track("onboarding_completed", { intents: intents.length > 0 ? intents.join(",") : "none" });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_INTENT_KEY, JSON.stringify(intents));
    }
    navigate("/");
  }

  if (foundingNumber != null && !revealDone) {
    return (
      <FoundingGolferReveal
        number={foundingNumber}
        onContinue={() => {
          // Seen here, so FoundingRevealHost doesn't replay it on Home.
          if (authUser && previewNumber == null) markFoundingRevealSeen(authUser.id, foundingNumber);
          setRevealDone(true);
        }}
      />
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

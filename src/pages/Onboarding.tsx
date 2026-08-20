import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Compass, ShieldCheck, Users } from "lucide-react";
import { Button } from "../components/ui/Button";
import { GolfMeIcon } from "../components/brand/GolfMeIcon";
import { GolfMeWordmark } from "../components/brand/GolfMeWordmark";
import { useLocale } from "../i18n/LocaleContext";
import { track } from "../lib/analytics";
import type { TranslationKey } from "../i18n/locales/en";

const SCREENS = [
  { icon: Compass, titleKey: "onboarding.screen1Title", bodyKey: "onboarding.screen1Body" },
  { icon: Users, titleKey: "onboarding.screen2Title", bodyKey: "onboarding.screen2Body" },
  { icon: ShieldCheck, titleKey: "onboarding.screen3Title", bodyKey: "onboarding.screen3Body", credibilityNote: true },
] as const satisfies readonly { icon: typeof Compass; titleKey: TranslationKey; bodyKey: TranslationKey; credibilityNote?: boolean }[];

export function Onboarding() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const [step, setStep] = useState(0);
  const screen = SCREENS[step];
  const isLast = step === SCREENS.length - 1;
  const Icon = screen.icon;

  function goToSignup() {
    track("onboarding_completed");
    navigate("/signup");
  }

  function next() {
    if (step === 0) track("onboarding_started");
    if (isLast) goToSignup();
    else setStep((s) => s + 1);
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#faf9f6] px-6 py-8">
      <div className="mb-5 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-fairway-600">
          <GolfMeIcon size={15} dotColor="#f8faf8" flagColor="#4ade80" holeColor="#14532d" />
        </span>
        <GolfMeWordmark className="text-sm font-extrabold tracking-tight" />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {SCREENS.map((_, i) => (
            <span key={i} className={`h-1.5 w-8 rounded-full transition-colors duration-300 ${i === step ? "bg-fairway-600" : "bg-slate-200"}`} />
          ))}
        </div>
        <button onClick={goToSignup} className="text-sm font-semibold text-slate-400 transition-colors duration-200 hover:text-slate-600">
          {t("common.skip")}
        </button>
      </div>

      {/* key={step} forces a remount on every step change, so the entrance
          replays each time instead of only ever playing once on the first
          screen. Mobile only (see .onboarding-enter in index.css) — desktop
          rendering was reading as an abrupt pop instead of a fade for
          reasons that resisted a couple of real fix attempts, so it's off
          there for now rather than keep guessing without a way to test on
          an actual desktop browser. */}
      <div key={step} className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <span
          className="onboarding-enter flex h-16 w-16 items-center justify-center rounded-2xl bg-fairway-50 text-fairway-600"
          style={{ "--onboarding-delay": "60ms" } as React.CSSProperties}
        >
          <Icon size={30} />
        </span>
        <div className="onboarding-enter" style={{ "--onboarding-delay": "360ms" } as React.CSSProperties}>
          <h1 className="text-2xl font-extrabold text-slate-900">{t(screen.titleKey)}</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">{t(screen.bodyKey)}</p>
        </div>

        {"credibilityNote" in screen && screen.credibilityNote && (
          <div
            className="onboarding-enter mx-auto max-w-xs rounded-2xl border border-slate-100 bg-white p-4 text-left"
            style={{ "--onboarding-delay": "660ms" } as React.CSSProperties}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("onboarding.credibilityNoteTitle")}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{t("onboarding.credibilityNoteBody")}</p>
          </div>
        )}
      </div>

      <Button size="lg" fullWidth onClick={next}>
        {isLast ? t("onboarding.createProfile") : t("onboarding.next")}
      </Button>
    </div>
  );
}

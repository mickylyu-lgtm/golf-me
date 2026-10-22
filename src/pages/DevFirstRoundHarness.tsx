import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Pencil, Share2, X } from "lucide-react";
import { useLocale } from "../i18n/LocaleContext";
import type { Locale } from "../i18n/LocaleContext";
import { FirstRoundPromptDialog } from "../components/onboarding/FirstRoundPromptDialog";
import { HostReminderCard } from "../components/onboarding/HostReminderCard";
import { Button } from "../components/ui/Button";
import { useShareActions } from "../lib/useShareActions";

// DEV-ONLY visual harness for First Round Hosting Onboarding. Registered in
// App.tsx only when import.meta.env.DEV, so the route and this whole module
// are absent from production builds. Renders the real components with no
// account: /__dev/first-round?view=popup|card|share[&lang=zh-CN][&fallback=1]

const SAMPLE_ROUND = {
  id: "00000000-0000-4000-8000-000000000001",
  course: "Dyker Beach Golf Course",
  dateISO: new Date(Date.now() + 3 * 86400000).toISOString(),
  timeLabel: "8:30 AM",
};

export function DevFirstRoundHarness() {
  const [params] = useSearchParams();
  const view = params.get("view") ?? "popup";
  const lang = params.get("lang") as Locale | null;
  const { t, locale, setLocale } = useLocale();
  const { shareRound } = useShareActions();
  const ranFallback = useRef(false);

  useEffect(() => {
    if (lang && lang !== locale) setLocale(lang);
  }, [lang, locale, setLocale]);

  // Exercises shareOrCopy's real fallback branch: no Web Share API, clipboard
  // stubbed (headless screenshots have no user gesture to grant it).
  useEffect(() => {
    if (view !== "share" || params.get("fallback") !== "1" || params.get("frame") === "1" || ranFallback.current) return;
    ranFallback.current = true;
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => undefined }, configurable: true });
    void shareRound(SAMPLE_ROUND);
  }, [view, params, shareRound]);

  // frame=1: the same view inside an exact 390x844 iframe. Headless Chrome on
  // Windows won't lay a window out narrower than ~500px, so phone-width
  // screenshots need a real 390px viewport.
  if (params.get("frame") === "1") {
    const inner = new URLSearchParams(params);
    inner.delete("frame");
    return (
      <iframe
        title="harness"
        src={`/__dev/first-round?${inner.toString()}`}
        style={{ border: 0, width: 390, height: 844, display: "block" }}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 bg-[#faf9f6] px-4 py-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Dev harness · {view} · {locale}</p>
      {view === "card" && <HostReminderCard onHost={() => {}} />}
      {view === "share" && (
        <>
          <h1 className="text-2xl font-extrabold text-slate-900">{SAMPLE_ROUND.course}</h1>
          <div className="flex items-center gap-3 rounded-2xl border border-fairway-100 bg-fairway-50/70 p-4">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-slate-900">{t("share.justHostedTitle")}</span>
              <span className="block text-xs text-slate-500">{t("share.justHostedBody")}</span>
            </span>
            <Button size="sm" icon={<Share2 size={13} />} onClick={() => void shareRound(SAMPLE_ROUND)}>
              {t("share.shareRoundButton")}
            </Button>
            <button type="button" aria-label={t("share.dismiss")} className="shrink-0 rounded-full p-1.5 text-slate-400">
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" icon={<Share2 size={13} />} onClick={() => void shareRound(SAMPLE_ROUND)}>
              {t("share.shareRound")}
            </Button>
            <Button size="sm" variant="outline" icon={<Pencil size={13} />}>
              {t("golfCallDetail.editTeeTime")}
            </Button>
          </div>
        </>
      )}
      {view === "popup" && <FirstRoundPromptDialog onHost={() => {}} onLater={() => {}} onInvite={() => {}} />}
    </div>
  );
}

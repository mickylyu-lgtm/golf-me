import { useEffect, useState } from "react";
import { CaddieLoadingRotator } from "./CaddieLoadingScenes";
import { useLocale } from "../../i18n/LocaleContext";

const THINKING_KEYS = ["caddie.thinking1", "caddie.thinking2", "caddie.thinking3", "caddie.thinking4"] as const;
const CYCLE_MS = 2800;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReduced(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

// Something to look at during the Roboflow+Gemini pipeline, which can now
// run well past what a spinner alone comfortably covers (30-90s+, up from
// the old Gemini-only ~10-20s) — Caddie's own mascot rotating through four
// decorative golfer scenes (tee-up, practice swing, putt line-up, putt),
// with the status line cycling through what's actually happening in rough
// pipeline order, not generic filler. The two cycle on fully independent
// timers (see CaddieLoadingScenes.tsx) — neither is bound to the other,
// and neither is bound to real analysis progress; this whole component
// only ever answers "are we in the processing state," never "how far
// along," which it doesn't know and doesn't pretend to.
export function CaddieThinking() {
  const { t } = useLocale();
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % THINKING_KEYS.length), CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-3">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-fairway-50 text-fairway-800">
        <CaddieLoadingRotator size={54} reducedMotion={reducedMotion} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-700">{t("swingAnalysis.processingTitle")}</p>
        <p key={index} className={`text-xs text-slate-500 ${reducedMotion ? "" : "animate-fade-in"}`}>
          {t(THINKING_KEYS[index])}
        </p>
      </div>
    </div>
  );
}

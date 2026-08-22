import { useEffect, useState } from "react";
import { CaddiePracticeSwingIcon } from "./CaddiePracticeSwingIcon";
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
// the old Gemini-only ~10-20s) — Caddie's own mascot "thinking," with the
// status line cycling through what's actually happening in rough pipeline
// order, not generic filler.
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
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-fairway-50 text-fairway-800">
        <CaddiePracticeSwingIcon size={40} animated={!reducedMotion} />
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

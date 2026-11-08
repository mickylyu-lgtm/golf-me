import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { CaddieLoadingRotator } from "./CaddieLoadingScenes";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/locales/en";
import { Button } from "../ui/Button";
import { caddieProgress, formatElapsed } from "../../lib/caddieProgress";
import type { CaddieProgressStep } from "../../lib/caddieProgress";

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
//
// 2026-11-08: given the job row (`job`), the status line is the step the
// server last PERSISTED (caddieProgress), with the attempt's elapsed time,
// and after a long wait it says so plainly ("taking longer than usual",
// "retrying automatically" only when the server is known to be on a retry,
// then "checking on it" with a Check again button). It still never says
// "failed": only the row's status does. Without `job` (no row yet) it keeps
// the old decorative rotation.
const STEP_KEYS: Record<CaddieProgressStep, TranslationKey> = {
  preparing: "caddie.progress.preparing",
  pose: "caddie.progress.pose",
  sending: "caddie.progress.sending",
  writing: "caddie.progress.writing",
  saving: "caddie.progress.saving",
};

export function CaddieThinking({ job, onCheckAgain }: { job?: Parameters<typeof caddieProgress>[0]; onCheckAgain?: () => Promise<void> }) {
  const { t } = useLocale();
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (job) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % THINKING_KEYS.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [job]);
  // A 1 s clock for the elapsed time; the row itself arrives via realtime /
  // the context's poll.
  useEffect(() => {
    if (!job) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [job]);

  const progress = job ? caddieProgress(job, now) : undefined;

  async function checkAgain() {
    if (!onCheckAgain || checking) return;
    setChecking(true);
    try {
      await onCheckAgain();
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-fairway-50 text-fairway-800">
          <CaddieLoadingRotator size={54} reducedMotion={reducedMotion} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-700">{t("swingAnalysis.processingTitle")}</p>
          {progress ? (
            <p className="text-xs text-slate-500" aria-live="polite">
              {t(STEP_KEYS[progress.step])} <span className="tabular-nums text-slate-400">· {formatElapsed(progress.elapsedSeconds)}</span>
            </p>
          ) : (
            <p key={index} className={`text-xs text-slate-500 ${reducedMotion ? "" : "animate-fade-in"}`}>
              {t(THINKING_KEYS[index])}
            </p>
          )}
        </div>
      </div>
      {progress && progress.phase !== "working" && (
        <div className="flex flex-col items-start gap-2 rounded-xl bg-white/80 px-3 py-2.5" role="status">
          <p className="text-xs text-slate-600">
            {progress.phase === "checking"
              ? t("caddie.progress.checking")
              : progress.retrying
                ? t("caddie.progress.slowRetrying")
                : t("caddie.progress.slow")}
          </p>
          {progress.phase === "checking" && onCheckAgain && (
            <Button variant="outline" size="sm" onClick={checkAgain} disabled={checking} icon={checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}>
              {t("caddie.progress.checkAgain")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

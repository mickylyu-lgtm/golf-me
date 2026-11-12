import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { CaddieWaitScene } from "./CaddieWaitScene";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/locales/en";
import { Button } from "../ui/Button";
import { caddieProgress, formatElapsed } from "../../lib/caddieProgress";
import type { CaddieProgressStep } from "../../lib/caddieProgress";

const THINKING_KEYS = ["caddie.thinking1", "caddie.thinking2", "caddie.thinking3", "caddie.thinking4"] as const;
const CYCLE_MS = 2800;

// General, well-established fundamentals in plain words: no stats, nothing
// about the golfer's own swing (that is what the analysis is for).
const TIP_KEYS = [
  "caddie.wait.tip1",
  "caddie.wait.tip2",
  "caddie.wait.tip3",
  "caddie.wait.tip4",
  "caddie.wait.tip5",
  "caddie.wait.tip6",
  "caddie.wait.tip7",
  "caddie.wait.tip8",
] as const;
const TIP_MS = 10_000;

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

// The Caddie processing card, for the Roboflow+Gemini pipeline's 60-130 s.
// The picture (CaddieWaitScene) is a face-on swing drawn like Caddie's pose
// overlay, with a quiet overlay for whichever step the server last saved;
// under it, a short golf tip that changes every ten seconds.
//
// 2026-11-08: given the job row (`job`), the status line is the step the
// server last PERSISTED (caddieProgress), with the attempt's elapsed time,
// and after a long wait it says so plainly ("taking longer than usual",
// "retrying automatically" only when the server is known to be on a retry,
// then "checking on it" with a Check again button). It still never says
// "failed": only the row's status does. Without `job` (no row yet, or the
// demo account) it keeps the old decorative rotation and the scene shows no
// step. Nothing here estimates how far along a run is: the step rail is the
// persisted step's place in the pipeline's fixed order, not a percentage.
const STEP_KEYS: Record<CaddieProgressStep, TranslationKey> = {
  preparing: "caddie.progress.preparing",
  pose: "caddie.progress.pose",
  sending: "caddie.progress.sending",
  writing: "caddie.progress.writing",
  saving: "caddie.progress.saving",
};
const STEP_ORDER: CaddieProgressStep[] = ["preparing", "pose", "sending", "writing", "saving"];

function StepRail({ step, reducedMotion }: { step: CaddieProgressStep; reducedMotion: boolean }) {
  const at = STEP_ORDER.indexOf(step);
  return (
    <div className="mt-2 flex gap-1" aria-hidden="true">
      {STEP_ORDER.map((s, i) => (
        <span
          key={s}
          className={`h-1 flex-1 rounded-full ${
            i < at ? "bg-fairway-600" : i === at ? `bg-sun-400 ${reducedMotion ? "" : "animate-pulse"}` : "bg-slate-200"
          }`}
        />
      ))}
    </div>
  );
}

export function CaddieThinking({ job, onCheckAgain }: { job?: Parameters<typeof caddieProgress>[0]; onCheckAgain?: () => Promise<void> }) {
  const { t } = useLocale();
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIP_KEYS.length));
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
  useEffect(() => {
    const id = setInterval(() => setTip((i) => (i + 1) % TIP_KEYS.length), TIP_MS);
    return () => clearInterval(id);
  }, []);

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
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl bg-brand-forest-deep shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <CaddieWaitScene stage={progress?.step} reducedMotion={reducedMotion} />
      </div>
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
        {progress && <StepRail step={progress.step} reducedMotion={reducedMotion} />}
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
      <div className="border-t border-slate-200 pt-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sun-700">{t("caddie.wait.tipLabel")}</p>
        <p key={tip} className={`mt-0.5 min-h-[2.5rem] text-xs leading-relaxed text-slate-600 ${reducedMotion ? "" : "gm-wait-tip"}`}>
          {t(TIP_KEYS[tip])}
        </p>
      </div>
    </div>
  );
}

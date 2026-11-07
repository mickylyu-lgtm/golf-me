import { useEffect, useRef } from "react";
import { Flag } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { tapHaptic } from "../../lib/tapFeedback";
import { CONFETTI_MS, confettiAlpha, makeConfetti, stepPiece } from "../../lib/roundCelebration";

// The moment a round is completed: a success haptic, a confetti burst and a
// short "Round complete" card. Never blocks the page (pointer-events: none
// on the confetti; the card dismisses on tap or by itself). With
// prefers-reduced-motion the confetti is skipped and the card simply fades.

const CARD_MS = 2800;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function RoundCompleteCelebration({ onDone }: { onDone: () => void }) {
  const { t } = useLocale();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    tapHaptic("success");
    const timer = window.setTimeout(() => doneRef.current(), CARD_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || prefersReducedMotion()) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.scale(dpr, dpr);
    const pieces = makeConfetti(w < 500 ? 90 : 140, w, h);
    let raf = 0;
    let start = 0;
    let last = 0;
    const frame = (ts: number) => {
      if (!start) start = last = ts;
      const dt = Math.min(34, ts - last);
      last = ts;
      const elapsed = ts - start;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = confettiAlpha(elapsed);
      for (const p of pieces) {
        stepPiece(p, dt);
        if (p.y > h + 20) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(Math.cos(p.flip), 1);
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      if (elapsed < CONFETTI_MS) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-6" data-testid="round-complete-celebration">
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      <button
        type="button"
        data-haptic="none"
        onClick={() => doneRef.current()}
        className="gm-round-complete-card relative flex w-full max-w-xs flex-col items-center rounded-3xl bg-white px-6 py-7 text-center shadow-2xl ring-1 ring-slate-900/5"
        role="status"
        aria-live="polite"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-forest text-brand-gold shadow-inner">
          <Flag className="h-7 w-7" strokeWidth={2.2} aria-hidden="true" />
        </span>
        <span className="mt-4 text-lg font-bold text-slate-900">{t("golfCallDetail.celebrateTitle")}</span>
        <span className="mt-1 text-sm text-slate-500">{t("golfCallDetail.celebrateBody")}</span>
      </button>
    </div>
  );
}

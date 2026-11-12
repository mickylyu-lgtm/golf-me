import { useEffect, useRef } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import { CONFETTI_MS, confettiAlpha, makeConfetti, stepPiece } from "../../lib/roundCelebration";

// The moment a round is completed: a confetti burst and a
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
        <HoledOut />
        <span className="mt-4 text-lg font-bold text-slate-900">{t("golfCallDetail.celebrateTitle")}</span>
        <span className="mt-1 text-sm text-slate-500">{t("golfCallDetail.celebrateBody")}</span>
      </button>
    </div>
  );
}

// A drawn green with the pin and a ball rolling into the cup: a golf moment,
// not a stock icon in a circle. The ball rolls in and drops (CSS
// .gm-holed-ball); with reduced motion it simply sits in the cup.
function HoledOut() {
  return (
    <svg viewBox="0 0 120 84" className="h-20 w-28" aria-hidden="true">
      <defs>
        <radialGradient id="gm-green" cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#4fae74" />
          <stop offset="100%" stopColor="#24683f" />
        </radialGradient>
        <radialGradient id="gm-ball" cx="38%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#d9dee3" />
        </radialGradient>
      </defs>
      <ellipse cx="60" cy="66" rx="56" ry="15" fill="url(#gm-green)" />
      <path d="M12 64 Q60 54 108 64" fill="none" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="5" />
      <ellipse cx="70" cy="66" rx="8.5" ry="3.2" fill="#0e2717" />
      <path d="M61.6 65.6 Q70 63.2 78.4 65.6" fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="0.8" />
      <line x1="70" y1="65" x2="70" y2="8" stroke="#f4f4f2" strokeWidth="2.2" strokeLinecap="round" />
      <path className="gm-holed-flag" d="M71 9 Q82 10.5 92 15 Q82 18.5 71 21 Z" fill="#f0b93f" />
      <ellipse cx="40" cy="69" rx="5" ry="1.4" fill="#0e2717" opacity="0.25" className="gm-holed-shadow" />
      <circle className="gm-holed-ball" cx="40" cy="64" r="4.6" fill="url(#gm-ball)" stroke="#c8ced4" strokeWidth="0.5" />
    </svg>
  );
}

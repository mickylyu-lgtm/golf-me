import { useId } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import "./AutoMatchScene.css";

const BALLS = [
  { x: 76, y: 82, delay: "0ms" },
  { x: 151, y: 65, delay: "1000ms" },
  { x: 162, y: 125, delay: "2000ms" },
];

/** The selected fairway-radar concept: a decorative search sweep, never a
 * match count or progress meter. The header is still; only a real wait loops.
 * CSS-only motion keeps results independent of animation timing. */
export function AutoMatchScene({ searching = false, compact = false }: { searching?: boolean; compact?: boolean }) {
  // Header and loading scene coexist. Each gradient needs its own identity.
  const sweepId = useId();
  return (
    <svg
      viewBox="0 0 240 168"
      width={compact ? 72 : 240}
      height={compact ? 50 : 168}
      className={`gm-automatch-scene ${searching ? "gm-automatch-searching" : "gm-automatch-mark"} ${compact ? "shrink-0" : "w-full max-w-60"}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={sweepId}>
          <stop stopColor="#c8e5cf" stopOpacity=".08" />
          <stop offset="1" stopColor="#4c9b66" stopOpacity=".32" />
        </linearGradient>
      </defs>
      <path d="M31 104C31 55 77 32 117 42C153 22 209 63 211 105C209 145 158 159 121 148C72 167 27 143 31 104Z"
        fill="#e5f2e8" className="dark:fill-[#172b20]" />
      <path d="M47 104C47 66 83 48 117 58C146 40 194 70 195 105C195 134 155 143 123 133C81 149 44 132 47 104Z"
        fill="#c8e5cf" className="dark:fill-[#234632]" />
      <circle cx="120" cy="100" r="57" fill="none" stroke="#83b592" strokeWidth="1" opacity=".5" />
      <circle cx="120" cy="100" r="34" fill="none" stroke="#83b592" strokeWidth="1" opacity=".5" />
      <g className="gm-automatch-sweep">
        <path d="M120 100L120 43A57 57 0 0 1 177 100Z" fill={`url(#${sweepId})`} />
        <path d="M120 100H177" stroke="#4d9361" strokeWidth="1.5" opacity=".55" />
      </g>
      {BALLS.map(({ x, y, delay }) => (
        <g key={x} transform={`translate(${x} ${y})`}>
          <g className="gm-automatch-ball" style={{ animationDelay: delay }}>
            <ellipse cy="6" rx="7" ry="2" fill="#315e3e" opacity=".18" />
            <circle r="6" fill="#fff" stroke="#b9cec0" />
            <path d="M-2-2h.1 M2-2h.1 M0 1h.1 M-2 3h.1 M3 2h.1" stroke="#afc3b5" strokeWidth="1.3" strokeLinecap="round" />
          </g>
        </g>
      ))}
      <ellipse cx="120" cy="102" rx="6" ry="2.5" fill="#315e3e" />
      <path d="M120 100V52" stroke="#315e3e" strokeWidth="2.5" strokeLinecap="round" className="dark:stroke-[#b6d4be]" />
      <path d="M122 52Q134 47 148 55L144 70Q133 63 122 68Z" fill="#f4b942" />
    </svg>
  );
}

export function AutoMatchLoader() {
  const { t } = useLocale();
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <AutoMatchScene searching />
      <p className="max-w-xs text-sm font-semibold text-slate-600">{t("autoMatch.searching")}</p>
    </div>
  );
}

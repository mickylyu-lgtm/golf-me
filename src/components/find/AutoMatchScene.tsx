import type { CSSProperties } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import "./AutoMatchScene.css";

const BALLS = [
  { x: 95, y: 108, fromX: -49, fromY: -32, delay: "0ms" },
  { x: 122, y: 121, fromX: -20, fromY: 28, delay: "100ms" },
  { x: 147, y: 104, fromX: 48, fromY: 13, delay: "200ms" },
];

/** A decorative group coming together on the green, never a match count or
 * progress meter. The header settles once; only a real wait loops. CSS-only
 * motion keeps results independent of animation timing and needs no cleanup. */
export function AutoMatchScene({ searching = false, compact = false }: { searching?: boolean; compact?: boolean }) {
  return (
    <svg
      viewBox="0 0 240 168"
      width={compact ? 72 : 240}
      height={compact ? 50 : 168}
      className={`gm-automatch-scene ${searching ? "gm-automatch-searching" : "gm-automatch-arrival"} ${compact ? "shrink-0" : "w-full max-w-60"}`}
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="120" cy="109" rx="100" ry="47" fill="#e5f2e8" className="dark:fill-[#172b20]" />
      <ellipse cx="120" cy="109" rx="83" ry="36" fill="#c8e5cf" className="dark:fill-[#234632]" />
      <ellipse cx="120" cy="109" rx="65" ry="27" fill="#aad4b5" className="dark:fill-[#2b563b]" />
      <path d="M49 82 Q63 99 95 108 M102 148 Q109 134 122 121 M195 117 Q173 114 147 104"
        fill="none" stroke="#5d956c" strokeWidth="1.5" strokeDasharray="2 5" strokeLinecap="round" opacity=".5" />
      <ellipse cx="128" cy="90" rx="8" ry="3" fill="#315e3e" />
      <path d="M128 89V35" stroke="#315e3e" strokeWidth="2.5" strokeLinecap="round" className="dark:stroke-[#b6d4be]" />
      <path d="M130 36 Q142 30 155 39 L151 56 Q141 48 130 53Z" fill="#f4b942" />
      <path d="M130 36V53" stroke="#c88f2e" strokeWidth="1.5" />
      {BALLS.map(({ x, y, fromX, fromY, delay }) => (
        <g key={x} transform={`translate(${x} ${y})`}>
          <g className="gm-automatch-ball" style={{
            "--gm-match-from-x": `${fromX}px`,
            "--gm-match-from-y": `${fromY}px`,
            animationDelay: delay,
          } as CSSProperties}>
            <ellipse cy="6" rx="8" ry="2.6" fill="#315e3e" opacity=".2" />
            <circle r="7" fill="#fff" stroke="#c8d8cd" strokeWidth="1" />
            <path d="M-3-2h.1 M2-3h.1 M0 1h.1 M3 2h.1 M-3 3h.1" stroke="#adc0b2" strokeWidth="1.6" strokeLinecap="round" />
          </g>
        </g>
      ))}
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

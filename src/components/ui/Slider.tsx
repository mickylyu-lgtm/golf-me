import { useState } from "react";
import { labelClass } from "./FormControls";

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
  presets?: number[];
  disabled?: boolean;
}

// Single-handle slider — native <input type="range"> so it's automatically
// excluded from RootTabCarousel's swipe-gesture capture (see
// isInteractiveTarget there), plus free keyboard support. Track/fill/bubble
// are drawn by sibling divs; index.css's .gm-slider handles thumb styling
// (vendor pseudo-elements Tailwind utilities can't reach directly).
export function Slider({ label, min, max, step, value, onChange, formatValue, presets, disabled }: SliderProps) {
  const [dragging, setDragging] = useState(false);
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className="mb-2 flex items-center justify-between">
        <label className={labelClass + " mb-0"}>{label}</label>
        <span className="text-xs font-bold text-fairway-700">{formatValue(value)}</span>
      </div>
      <div className="relative flex h-5 items-center" data-no-swipe>
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-slate-200" />
        <div className="absolute h-1.5 rounded-full bg-fairway-500" style={{ width: `${pct}%` }} />
        {dragging && (
          <div
            className="pointer-events-none absolute bottom-6 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white shadow"
            style={{ left: `${pct}%` }}
          >
            {formatValue(value)}
          </div>
        )}
        <input
          type="range"
          className="gm-slider absolute inset-x-0 w-full"
          style={{ height: 20 }}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          aria-label={label}
        />
      </div>
      {presets && presets.length > 0 && (
        <div className="mt-2 flex gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              disabled={disabled}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
                value === p
                  ? "border-transparent bg-fairway-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-fairway-300 hover:text-fairway-700"
              }`}
            >
              {formatValue(p)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

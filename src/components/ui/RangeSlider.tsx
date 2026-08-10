import { useState } from "react";
import { labelClass } from "./FormControls";

interface RangeSliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  valueMin: number;
  valueMax: number;
  onChangeMin: (value: number) => void;
  onChangeMax: (value: number) => void;
  formatValue: (value: number) => string;
  disabled?: boolean;
}

// Dual-handle slider — two overlapping native <input type="range"> on the
// same track (index.css's .gm-slider-overlay makes only each thumb, not the
// full-width input body, actually clickable, so the handles don't fight
// each other for touch/click priority). onChangeMin/Max each clamp against
// the other handle so the two can never cross.
export function RangeSlider({ label, min, max, step, valueMin, valueMax, onChangeMin, onChangeMax, formatValue, disabled }: RangeSliderProps) {
  const [dragging, setDragging] = useState<"min" | "max" | null>(null);
  const pctMin = ((valueMin - min) / (max - min)) * 100;
  const pctMax = ((valueMax - min) / (max - min)) * 100;

  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className="mb-2 flex items-center justify-between">
        <label className={labelClass + " mb-0"}>{label}</label>
        <span className="text-xs font-bold text-fairway-700">
          {formatValue(valueMin)} – {formatValue(valueMax)}
        </span>
      </div>
      <div className="relative flex h-5 items-center" data-no-swipe>
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-slate-200" />
        <div className="absolute h-1.5 rounded-full bg-fairway-500" style={{ left: `${pctMin}%`, width: `${Math.max(0, pctMax - pctMin)}%` }} />
        {dragging === "min" && (
          <div
            className="pointer-events-none absolute bottom-6 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white shadow"
            style={{ left: `${pctMin}%` }}
          >
            {formatValue(valueMin)}
          </div>
        )}
        {dragging === "max" && (
          <div
            className="pointer-events-none absolute bottom-6 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white shadow"
            style={{ left: `${pctMax}%` }}
          >
            {formatValue(valueMax)}
          </div>
        )}
        <input
          type="range"
          className="gm-slider gm-slider-overlay absolute inset-x-0 w-full"
          style={{ height: 20, zIndex: dragging === "min" ? 3 : 2 }}
          min={min}
          max={max}
          step={step}
          value={valueMin}
          disabled={disabled}
          onChange={(e) => onChangeMin(Math.min(Number(e.target.value), valueMax - step))}
          onPointerDown={() => setDragging("min")}
          onPointerUp={() => setDragging(null)}
          aria-label={`${label} minimum`}
        />
        <input
          type="range"
          className="gm-slider gm-slider-overlay absolute inset-x-0 w-full"
          style={{ height: 20, zIndex: dragging === "max" ? 3 : 2 }}
          min={min}
          max={max}
          step={step}
          value={valueMax}
          disabled={disabled}
          onChange={(e) => onChangeMax(Math.max(Number(e.target.value), valueMin + step))}
          onPointerDown={() => setDragging("max")}
          onPointerUp={() => setDragging(null)}
          aria-label={`${label} maximum`}
        />
      </div>
    </div>
  );
}

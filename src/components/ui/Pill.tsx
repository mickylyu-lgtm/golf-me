import type { ReactNode } from "react";

interface PillProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

// Shared toggle-chip used for vibe/skill/walk/availability selectors across
// Discover, Golf Calls, Create Golf Call, the Find wizard, and Profile —
// one place to keep hover/active/focus behavior consistent.
export function Pill({ active, onClick, children, disabled, className = "" }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none ${
        active
          ? "border-transparent bg-fairway-600 text-white hover:bg-fairway-700 active:bg-fairway-800"
          : "border-slate-200 bg-white text-slate-600 hover:border-fairway-300 hover:text-fairway-700 active:bg-slate-50"
      } ${className}`}
    >
      {children}
    </button>
  );
}

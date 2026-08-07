import type { ReactNode } from "react";

type Tone = "fairway" | "sun" | "slate" | "sky" | "rose" | "outline";

interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<Tone, string> = {
  fairway: "bg-fairway-50 text-fairway-700",
  sun: "bg-sun-100 text-sun-700",
  slate: "bg-slate-100 text-slate-600",
  sky: "bg-sky-50 text-sky-700",
  rose: "bg-rose-50 text-rose-600",
  outline: "bg-white text-slate-600 border border-slate-200",
};

export function Badge({ children, tone = "slate", icon, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

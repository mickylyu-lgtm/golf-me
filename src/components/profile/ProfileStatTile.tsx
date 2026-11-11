import type { ReactNode } from "react";

/** Shared visual treatment only; callers retain ownership of data and access. */
export function ProfileStatCell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-20 min-w-0 items-stretch justify-center rounded-xl border border-slate-100 bg-slate-50/70">{children}</div>;
}

export function ProfileStatTile({ value, label, valueClassName = "" }: { value: ReactNode; label: string; valueClassName?: string }) {
  return <ProfileStatCell>
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-2 py-3 text-center">
      <span className={"max-w-full break-words font-bold tabular-nums text-slate-900 " + (valueClassName || "text-xl leading-tight")}>{value}</span>
      <span className="max-w-full break-words text-xs leading-snug text-slate-500">{label}</span>
    </div>
  </ProfileStatCell>;
}

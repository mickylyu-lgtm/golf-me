import { useLocale } from "../../i18n/LocaleContext";
import { useFoundingCohortStatus } from "../../lib/useFoundingCohortStatus";
import { FoundingFlagIcon } from "../golfer/FoundingGolfer";

// Live "X of 250 claimed" progress for the landing page. Reads the same
// anon-callable get_founding_cohort_status() RPC as FoundingSpotsNote; the
// count is always the server's, never incremented client-side. Renders
// nothing until the RPC answers (and nothing at all if it fails), so the
// static prerender simply omits it — the pitch copy around it stands alone.
export function FoundingCounter({ className = "" }: { className?: string }) {
  const { t } = useLocale();
  const status = useFoundingCohortStatus(true);
  if (!status) return null;
  const claimed = Math.min(status.awardedCount, status.cap);
  const pct = Math.max(2, Math.round((claimed / status.cap) * 100));
  const full = claimed >= status.cap;
  return (
    <div className={`rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-bold text-white">
          <FoundingFlagIcon size={16} className="text-sun-300" />
          {t("landing.founding.counterLabel")}
        </span>
        <span className="text-sm font-extrabold tabular-nums text-sun-300">
          {full ? t("founding.spotsClaimed", { cap: status.cap }) : t("landing.founding.counterValue", { claimed, cap: status.cap })}
        </span>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={status.cap} aria-valuenow={claimed}>
        <div className="h-full rounded-full bg-gradient-to-r from-sun-300 to-sun-500 transition-[width] duration-1000 ease-out" style={{ width: `${pct}%` }} />
      </div>
      {!full && status.isOpen && <p className="mt-2 text-xs text-fairway-100">{t("landing.founding.counterHint", { remaining: status.remaining })}</p>}
    </div>
  );
}

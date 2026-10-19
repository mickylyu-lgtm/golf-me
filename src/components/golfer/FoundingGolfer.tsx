import { useState } from "react";
import { Flag } from "lucide-react";
import { Modal } from "../ui/Modal";
import { useLocale } from "../../i18n/LocaleContext";
import { formatFoundingNumber, isFounder } from "../../lib/founder";
import { useFoundingCohortStatus } from "../../lib/useFoundingCohortStatus";

// Founding Golfer identity (20261006120000). The number is awarded
// server-side only; these components just render what the profile row
// says. Micky's own account is the founder: it shows "Founder" instead of a
// number and never holds a founding slot.

interface FoundingIdentity {
  id: string;
  foundingMemberNumber?: number;
  foundingAwardedAt?: string;
}

function hasFoundingIdentity(golfer: FoundingIdentity): boolean {
  return isFounder(golfer.id) || golfer.foundingMemberNumber != null;
}

// Small gold flag next to a name in lists (round participants, search,
// following, discovery). Decorative, so it's never a second tap target
// inside a row that already opens the profile.
export function FoundingMark({ golfer, className = "" }: { golfer: FoundingIdentity; className?: string }) {
  const { t } = useLocale();
  if (!hasFoundingIdentity(golfer)) return null;
  const label =
    golfer.foundingMemberNumber != null
      ? t("founding.numberLabel", { number: formatFoundingNumber(golfer.foundingMemberNumber) })
      : t("trust.founder");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sun-50 align-[-2px] ring-1 ring-sun-300/80 ${className}`}
    >
      <Flag size={9} strokeWidth={2.5} className="text-sun-600" />
    </span>
  );
}

// Profile-header pill; tapping it opens the info sheet.
export function FoundingGolferBadge({ golfer, className = "" }: { golfer: FoundingIdentity; className?: string }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  if (!hasFoundingIdentity(golfer)) return null;

  const founder = isFounder(golfer.id);
  const number = golfer.foundingMemberNumber != null ? formatFoundingNumber(golfer.foundingMemberNumber) : null;
  const year = golfer.foundingAwardedAt ? new Date(golfer.foundingAwardedAt).getFullYear() : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-full border border-sun-300/70 bg-sun-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-sun-700 transition-colors duration-200 hover:bg-sun-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sun-400 focus-visible:ring-offset-2 ${className}`}
      >
        <Flag size={11} strokeWidth={2.5} className="text-sun-600" />
        {founder ? t("trust.founder") : t("founding.title")}
        {number && <span className="tabular-nums text-sun-600">{number}</span>}
      </button>
      {open && (
        <Modal title={founder ? t("trust.founder") : t("founding.title")} onClose={() => setOpen(false)}>
          <div className="flex flex-col items-center gap-3 px-2 pb-4 pt-2 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-forest ring-2 ring-brand-gold/70 ring-offset-2">
              <Flag size={22} strokeWidth={2.25} className="text-brand-gold" />
            </span>
            <p className="text-sm text-slate-600">{founder ? t("founding.founderBody") : t("founding.body")}</p>
            {number && (
              <p className="text-base font-semibold tabular-nums tracking-wide text-sun-700">
                {year ? t("founding.numberWithYear", { number, year }) : t("founding.numberLabel", { number })}
              </p>
            )}
            {!founder && <p className="text-xs leading-relaxed text-slate-500">{t("founding.footer")}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}

// Onboarding line: spots left while the cohort is open, a "claimed" note
// once all of them are gone, nothing otherwise (demo, loading, cohort not
// opened yet, or closed early by an admin).
export function FoundingSpotsNote({ enabled, className = "" }: { enabled: boolean; className?: string }) {
  const { t } = useLocale();
  const status = useFoundingCohortStatus(enabled);
  if (!status) return null;
  const claimed = status.awardedCount >= status.cap;
  if (!claimed && !(status.isOpen && status.remaining > 0)) return null;
  return (
    <p className={`flex items-center gap-2 text-xs text-slate-500 ${className}`}>
      <Flag size={12} strokeWidth={2.5} className="shrink-0 text-sun-600" />
      <span>
        {claimed ? t("founding.spotsClaimed", { cap: status.cap }) : t("founding.spotsRemaining", { remaining: status.remaining, cap: status.cap })}
      </span>
    </p>
  );
}

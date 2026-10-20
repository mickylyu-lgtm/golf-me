import { useState } from "react";
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

// The Founding Golfer mark: a hole flag. Course flags carry the hole
// number; this one carries the golfer's founding number. "full" is the
// drawn version for dark brand surfaces (white pole, cup shadow, number on
// the cloth); "glyph" is a one-color silhouette in currentColor for the
// small inline sizes (12-16px) where detail can't be read. Colors are the
// brand-forest-deep / brand-gold token values (src/index.css).
const FLAG_CLOTH_FULL = "M22.4 7 C32 4.5 38 10 52 7.5 L52 32 C38 34.5 32 29 22.4 31.5 Z";
const FLAG_CLOTH_GLYPH = "M19 6 C32 4.5 38 10 56 7.5 L56 36 C38 34.5 32 29 19 35 Z";

export function FoundingFlagIcon({
  size = 16,
  variant = "glyph",
  label,
  className = "",
}: {
  size?: number;
  variant?: "full" | "glyph";
  /** "full" only: text printed on the flag, e.g. "#008". */
  label?: string;
  className?: string;
}) {
  if (variant === "glyph") {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={`shrink-0 ${className}`}>
        <rect x="14" y="4" width="5" height="56" rx="1.5" fill="currentColor" />
        <path d={FLAG_CLOTH_GLYPH} fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={`shrink-0 ${className}`}>
      <ellipse cx="21" cy="57.5" rx="11" ry="2.8" fill="#0e2717" opacity="0.9" />
      <rect x="19.4" y="5" width="3" height="52.5" rx="1.5" fill="#fdfcf8" />
      <path d={FLAG_CLOTH_FULL} fill="#f0b93f" />
      {label && (
        <text
          x="37.3"
          y="23.2"
          textAnchor="middle"
          fontWeight={800}
          fontSize={label.length > 3 ? 9.5 : 12}
          fill="#1b4a2d"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {label}
        </text>
      )}
    </svg>
  );
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
      className={`inline-flex shrink-0 align-[-2px] text-sun-500 ${className}`}
    >
      <FoundingFlagIcon size={15} />
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
        <FoundingFlagIcon size={12} className="text-sun-600" />
        {founder ? t("trust.founder") : t("founding.title")}
        {number && <span className="tabular-nums text-sun-600">{number}</span>}
      </button>
      {open && (
        <Modal title={founder ? t("trust.founder") : t("founding.title")} onClose={() => setOpen(false)}>
          <div className="flex flex-col items-center gap-3 px-2 pb-4 pt-2 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-forest">
              <FoundingFlagIcon size={48} variant="full" label={number ?? undefined} />
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

// Onboarding / landing line: spots left while the cohort is open, a
// "claimed" note once all of them are gone, nothing otherwise (demo,
// loading, cohort not opened yet, or closed early by an admin). `onDark`
// is the landing hero's light-on-green variant.
export function FoundingSpotsNote({
  enabled,
  onDark = false,
  className = "",
}: {
  enabled: boolean;
  onDark?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const status = useFoundingCohortStatus(enabled);
  if (!status) return null;
  const claimed = status.awardedCount >= status.cap;
  if (!claimed && !(status.isOpen && status.remaining > 0)) return null;
  return (
    <p className={`flex items-center gap-2 text-xs ${onDark ? "text-fairway-100" : "text-slate-500"} ${className}`}>
      <FoundingFlagIcon size={13} className={onDark ? "text-sun-300" : "text-sun-600"} />
      <span>
        {claimed ? t("founding.spotsClaimed", { cap: status.cap }) : t("founding.spotsRemaining", { remaining: status.remaining, cap: status.cap })}
      </span>
    </p>
  );
}

// Full-screen moment right after onboarding (Ready) for a golfer the
// server just awarded a number. Reuses the entry-animation keyframes:
// the flag (number on the cloth) drops in first, then the copy and button. The
// global prefers-reduced-motion rule collapses all of it to a plain screen.
export function FoundingGolferReveal({ number, onContinue }: { number: number; onContinue: () => void }) {
  const { t } = useLocale();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-br from-brand-forest via-fairway-900 to-brand-forest-deep px-6 py-12 text-center text-white">
      <FoundingFlagIcon size={168} variant="full" label={formatFoundingNumber(number)} className="animate-entry-ball" />
      <div className="flex flex-col items-center gap-2">
        <p className="animate-entry-fade text-xs font-semibold uppercase tracking-[0.18em] text-fairway-200" style={{ animationDelay: "500ms" }}>
          {t("founding.revealEyebrow")}
        </p>
        <h1 className="animate-entry-fade text-3xl font-extrabold tracking-tight" style={{ animationDelay: "650ms" }}>
          {t("founding.title")}
        </h1>
        <p className="sr-only">{formatFoundingNumber(number)}</p>
      </div>
      <p className="max-w-xs animate-entry-fade text-sm leading-relaxed text-fairway-100/90" style={{ animationDelay: "1300ms" }}>
        {t("founding.revealBody")}
      </p>
      <div className="w-full max-w-xs animate-entry-fade" style={{ animationDelay: "1500ms" }}>
        <button
          onClick={onContinue}
          className="flex w-full items-center justify-center rounded-full bg-sun-400 px-6 py-3.5 text-base font-bold text-fairway-950 shadow-md shadow-black/20 transition hover:-translate-y-px hover:bg-sun-300"
        >
          {t("common.continue")}
        </button>
      </div>
    </div>
  );
}

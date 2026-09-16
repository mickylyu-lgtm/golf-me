import { CalendarClock, ExternalLink } from "lucide-react";
import { Button } from "../ui/Button";
import { useLocale } from "../../i18n/LocaleContext";

interface ExternalBookingCardProps {
  courseName: string;
  bookingUrl: string;
}

// Replaces the old dashed-border EmptyState treatment for a course GolfMe
// doesn't have live availability for -- a normal, confident booking card
// (real elevation/radius/CTA, per GolfMe's existing design language) that
// reads as a deliberate handoff to the course's own official site, not a
// missing/broken feature. Never claims live availability; never exposes
// missing-API/backend language.
export function ExternalBookingCard({ courseName, bookingUrl }: ExternalBookingCardProps) {
  const { t } = useLocale();

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm shadow-slate-900/[0.03]">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-fairway-50 text-fairway-600">
        <CalendarClock size={20} />
      </div>
      <p className="mt-3 text-base font-bold text-slate-900">{t("teeTimes.bookAt", { name: courseName })}</p>
      <p className="mt-1 text-sm text-slate-500">{t("teeTimes.externalBookingBody", { name: courseName })}</p>
      <Button
        fullWidth
        className="mt-4"
        icon={<ExternalLink size={15} />}
        onClick={() => window.open(bookingUrl, "_blank", "noopener,noreferrer")}
      >
        {t("teeTimes.checkTeeTimes")}
      </Button>
      <p className="mt-3 text-center text-xs text-slate-400">{t("teeTimes.continueToOfficialSite", { name: courseName })}</p>
      <p className="mt-1 text-center text-[11px] text-slate-400">{t("teeTimes.managedByNote", { name: courseName })}</p>
    </div>
  );
}

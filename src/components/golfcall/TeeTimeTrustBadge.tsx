import { ClipboardList, FileCheck2, TriangleAlert } from "lucide-react";
import type { GolfCall } from "../../types";
import { useLocale } from "../../i18n/LocaleContext";
import { bookingStatusView } from "../../lib/bookingStatus";

interface TeeTimeTrustBadgeProps {
  call: Parameters<typeof bookingStatusView>[0] & Pick<GolfCall, "id">;
  onClick?: () => void;
  className?: string;
}

// The round's booking status as one chip ("Booked · Host reported",
// "Booking evidence reviewed", "Booking changed · …", …), from
// lib/bookingStatus.ts. Its words carry the meaning (colour is only a hint);
// renders nothing when the host said nothing, and nothing for cancelled,
// completed or past rounds. Never claims course confirmation.
export function TeeTimeTrustBadge({ call, onClick, className = "" }: TeeTimeTrustBadgeProps) {
  const { t } = useLocale();
  const view = bookingStatusView(call);
  if (!view.showClaim) return null;

  const warn = view.state === "changed" || view.state === "cancelled";
  const reviewed = view.evidence === "reviewed";
  const tone = warn ? "bg-sun-100 text-sun-700" : reviewed ? "bg-fairway-50 text-fairway-800" : "bg-slate-100 text-slate-700";
  const Icon = warn ? TriangleAlert : reviewed ? FileCheck2 : ClipboardList;

  const content = (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tone} ${className}`}>
      <Icon size={12} aria-hidden /> {t(view.labelKey)}
    </span>
  );

  if (!onClick) return content;
  return (
    <button type="button" onClick={onClick} className="text-left" aria-haspopup="dialog">
      {content}
    </button>
  );
}

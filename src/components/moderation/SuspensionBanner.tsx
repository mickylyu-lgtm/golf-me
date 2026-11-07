import { Link, useLocation } from "react-router-dom";
import { Ban } from "lucide-react";
import { useModeration } from "../../context/ModerationContext";
import { useLocale } from "../../i18n/LocaleContext";

// Shown to a suspended user above every screen except the open chat
// threads (their keyboard/viewport layout is device-tuned and must not
// shift; a send there fails server-side with the normal "not sent" state).
export function SuspensionBanner() {
  const { suspended, suspendedUntil } = useModeration();
  const { t, locale } = useLocale();
  const { pathname } = useLocation();
  if (!suspended || pathname.startsWith("/messages/")) return null;
  const date = suspendedUntil
    ? new Date(suspendedUntil).toLocaleString(locale, { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  return (
    <div role="status" className="mx-auto mt-3 flex w-full max-w-3xl px-4 sm:px-6">
      <div className="flex w-full items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
        <Ban size={16} className="mt-0.5 shrink-0" aria-hidden />
        <p className="min-w-0">
          {date ? t("moderation.suspendedUntil", { date }) : t("moderation.suspendedIndefinite")}{" "}
          <Link to="/support" className="font-semibold underline underline-offset-2">
            {t("moderation.contactSupport")}
          </Link>
        </p>
      </div>
    </div>
  );
}

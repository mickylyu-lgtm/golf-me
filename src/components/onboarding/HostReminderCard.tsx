import { ArrowRight, Flag } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { CLICKABLE_CARD_CLASS } from "../ui/cardStyles";

// Small Home card shown after the first-round popup was closed, until the
// golfer's first round is created. Deliberately not dismissible (product
// decision): it goes away by hosting. Same card treatment as Home's other
// action rows.
export function HostReminderCard({ onHost }: { onHost: () => void }) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      onClick={onHost}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left ${CLICKABLE_CARD_CLASS}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">
        <Flag size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-900">{t("firstRound.reminderTitle")}</span>
        <span className="block text-xs text-slate-500">{t("firstRound.reminderBody")}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-fairway-700">
        {t("firstRound.host")}
        <ArrowRight size={13} />
      </span>
    </button>
  );
}

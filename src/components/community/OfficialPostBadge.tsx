import { ShieldCheck } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";

export function OfficialPostBadge() {
  const { t } = useLocale();
  return (
    <p data-testid="official-post-badge" className="flex w-fit max-w-full items-center gap-1.5 rounded-full bg-fairway-700 px-2.5 py-1 text-xs font-semibold text-white">
      <ShieldCheck size={13} className="shrink-0" aria-hidden />{t("community.officialPostBadge")}
    </p>
  );
}

import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { goBack } from "../lib/goBack";
import { useLocale } from "../i18n/LocaleContext";
import type { TranslationKey } from "../i18n/locales/en";

const GUIDELINES = [
  "guidelines.respect",
  "guidelines.unwantedContact",
  "guidelines.scams",
  "guidelines.impersonation",
  "guidelines.privacy",
  "guidelines.hate",
  "guidelines.spam",
  "guidelines.safety",
] as const satisfies readonly TranslationKey[];

export function CommunityGuidelines() {
  const navigate = useNavigate();
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        type="button"
        onClick={() => goBack(navigate)}
        className="-my-2.5 flex items-center gap-1.5 self-start rounded-full py-2.5 pr-3 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
      >
        <ArrowLeft size={16} aria-hidden="true" /> {t("common.back")}
      </button>

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <ShieldCheck size={20} className="shrink-0 text-fairway-600" aria-hidden="true" /> {t("settings.communityGuidelines")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("guidelines.intro")}</p>
      </div>

      <ul className="flex flex-col gap-2.5 rounded-2xl border border-slate-100 bg-white p-4">
        {GUIDELINES.map((key) => (
          <li key={key} className="flex items-start gap-2.5 text-sm text-slate-700">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-fairway-600" aria-hidden="true" />
            {t(key)}
          </li>
        ))}
      </ul>

      <p className="text-sm leading-relaxed text-slate-600">{t("guidelines.reporting")}</p>
    </div>
  );
}

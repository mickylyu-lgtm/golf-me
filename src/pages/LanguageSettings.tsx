import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check } from "lucide-react";
import { useLocale, LOCALES } from "../i18n/LocaleContext";

export function LanguageSettings() {
  const navigate = useNavigate();
  const { locale, setLocale, t } = useLocale();

  return (
    <div className="flex flex-col gap-6 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("language.title")}</h1>
        <p className="text-sm text-slate-500">{t("language.subtitle")}</p>
      </div>

      <div className="flex flex-col gap-2">
        {LOCALES.map((l) => (
          <button
            key={l.value}
            onClick={() => setLocale(l.value)}
            className={`flex items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 ${
              locale === l.value ? "border-fairway-400 bg-fairway-50" : "border-slate-100 bg-white hover:border-slate-200"
            }`}
          >
            <span className="text-sm font-semibold text-slate-800">{l.nativeName}</span>
            {locale === l.value && <Check size={16} className="text-fairway-700" />}
          </button>
        ))}
      </div>
    </div>
  );
}

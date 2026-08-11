import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "../i18n/LocaleContext";
import { GolfMeLogo } from "../components/brand/GolfMeLogo";

export function About() {
  const navigate = useNavigate();
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-6 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div className="flex flex-col items-start gap-4">
        <GolfMeLogo interactive={false} size={22} />
        <p className="text-sm text-slate-600">{t("about.description")}</p>
        <p className="text-xs text-slate-400">{t("about.version")}</p>
      </div>
    </div>
  );
}

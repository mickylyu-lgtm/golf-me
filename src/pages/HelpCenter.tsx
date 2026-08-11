import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "../i18n/LocaleContext";

const FAQS = [
  {
    q: "How do I find a round?",
    a: "From Home, tap Find a Round, or use the Find tab. Browse open rounds near you, or tap Filters to narrow by date, distance, budget, and more.",
  },
  {
    q: "How does Auto-Match work?",
    a: "Auto-Match uses your saved Match Preferences (Profile → Match Preferences) to recommend the best open round for you — no need to browse manually.",
  },
  {
    q: "What's the difference between Golf Circle and Following?",
    a: "Golf Circle is golfers you've actually played with and would play with again. Following just means you want to keep up with someone.",
  },
  {
    q: "How is my location shared?",
    a: "Your exact location is never shown to other golfers — only an approximate distance and general area.",
  },
  {
    q: "How do I report or block someone?",
    a: "Open their profile and use the report or block option in the menu. Blocked golfers can be managed in Settings.",
  },
];

export function HelpCenter() {
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

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("help.title")}</h1>
        <p className="text-sm text-slate-500">{t("help.subtitle")}</p>
      </div>

      <div className="flex flex-col gap-3">
        {FAQS.map((item) => (
          <div key={item.q} className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="text-sm font-semibold text-slate-800">{item.q}</p>
            <p className="mt-1 text-sm text-slate-500">{item.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

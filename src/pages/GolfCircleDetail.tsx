import { useNavigate } from "react-router-dom";
import { ArrowLeft, Users } from "lucide-react";
import { useData } from "../context/DataContext";
import { useLocale } from "../i18n/LocaleContext";
import { Avatar } from "../components/ui/Avatar";
import { EmptyState } from "../components/ui/EmptyState";

export function GolfCircleDetail() {
  const { circleGolfers } = useData();
  const { t } = useLocale();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-6 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("circle.title")}</h1>
        <p className="text-sm text-slate-500">{t("circle.subtitle")}</p>
      </div>

      {circleGolfers.length === 0 ? (
        <EmptyState icon={<Users size={20} />} title={t("circle.empty")} description={t("circle.emptyDesc")} />
      ) : (
        <div className="flex flex-col gap-2">
          {circleGolfers.map((g) => (
            <button
              key={g.id}
              onClick={() => navigate(`/golfer/${g.id}`)}
              className="flex items-center gap-3 rounded-xl px-1 py-1 text-left transition hover:bg-slate-50"
            >
              <Avatar golfer={g} size="sm" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-800">{g.name}</p>
                <p className="text-xs text-slate-500">{g.handicap !== null ? `${g.handicap} handicap` : "No handicap yet"}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

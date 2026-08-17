import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import { GolfCalls } from "./GolfCalls";
import { Discover } from "./Discover";
import { useLocale } from "../i18n/LocaleContext";
import { CLICKABLE_CARD_CLASS } from "../components/ui/cardStyles";

type Tab = "rounds" | "golfers";

export function Find() {
  const [tab, setTab] = useState<Tab>("rounds");
  const { t } = useLocale();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("find.title")}</h1>
        <p className="text-sm text-slate-500">{t("find.subtitle")}</p>
      </div>

      <button
        onClick={() => navigate("/tee-times")}
        className={`flex w-full items-center gap-3 p-3.5 text-left ${CLICKABLE_CARD_CLASS}`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">
          <CalendarClock size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900">{t("teeTimes.title")}</span>
          <span className="block text-xs text-slate-500">{t("teeTimes.subtitle")}</span>
        </span>
      </button>

      <div className="flex rounded-full border border-slate-200 bg-white p-1">
        <button
          onClick={() => setTab("rounds")}
          className={`flex-1 rounded-full py-2 text-sm font-semibold transition ${
            tab === "rounds" ? "bg-fairway-600 text-white" : "text-slate-500"
          }`}
        >
          {t("find.tabRounds")}
        </button>
        <button
          onClick={() => setTab("golfers")}
          className={`flex-1 rounded-full py-2 text-sm font-semibold transition ${
            tab === "golfers" ? "bg-fairway-600 text-white" : "text-slate-500"
          }`}
        >
          {t("find.tabGolfers")}
        </button>
      </div>

      {tab === "rounds" ? <GolfCalls embedded /> : <Discover embedded />}
    </div>
  );
}

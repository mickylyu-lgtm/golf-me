import { useState } from "react";
import { GolfCalls } from "./GolfCalls";
import { Discover } from "./Discover";
import { useLocale } from "../i18n/LocaleContext";

type Tab = "rounds" | "golfers";

export function Find() {
  const [tab, setTab] = useState<Tab>("rounds");
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("find.title")}</h1>
        <p className="text-sm text-slate-500">{t("find.subtitle")}</p>
      </div>

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

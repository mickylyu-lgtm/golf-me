import { useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CalendarClock, ChevronRight } from "lucide-react";
import { GolfCalls } from "./GolfCalls";
import { Discover } from "./Discover";
import { useLocale } from "../i18n/LocaleContext";
import { useSessionState } from "../lib/useSessionState";
import { FIND_TAB_PARAM, FIND_TAB_STORAGE_KEY, isFindTab, resolveFindTab } from "../lib/findTab";
import type { FindTab } from "../lib/findTab";
import { TEE_TIMES_VISIBLE } from "../services/teeTimes/types";

export function Find() {
  const [rememberedTab, setTab] = useSessionState<FindTab>(FIND_TAB_STORAGE_KEY, "rounds", isFindTab);
  const { t } = useLocale();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // RootTabCarousel keeps Find mounted under every root tab, so only read
  // ?tab= while Play itself is showing.
  const requestedTab = pathname === "/find" ? searchParams.get(FIND_TAB_PARAM) : null;
  // Derived during render (not only in the effect below) so an explicit
  // request never flashes the remembered tab for a frame first.
  const tab = resolveFindTab(requestedTab, rememberedTab);

  // Adopt the request as the remembered tab, then drop it from the URL
  // (replace, no new history entry). Left in place, Back from a golfer
  // opened on Golfers would land on /find?tab=rounds and undo the switch.
  useEffect(() => {
    if (requestedTab === null) return;
    if (isFindTab(requestedTab)) setTab(requestedTab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(FIND_TAB_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [requestedTab, setTab, setSearchParams]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("find.title")}</h1>
        <p className="text-sm text-slate-500">{t("find.subtitle")}</p>
      </div>

      <div className="flex rounded-full border border-slate-200 bg-white p-1 lg:w-full lg:max-w-md lg:self-start">
        {/* Same gradient as the shared Button/app icon -- the flat
            fairway-600 fill here read as inconsistent once the primary
            buttons around it (Host, right below this) already had the
            gradient treatment (reported live). */}
        <button
          onClick={() => setTab("rounds")}
          data-haptic="selection"
          aria-pressed={tab === "rounds"}
          className={`flex-1 rounded-full py-2 text-sm font-semibold transition ${
            tab === "rounds" ? "bg-gradient-to-br from-brand-forest to-brand-forest-deep text-white" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {t("find.tabRounds")}
        </button>
        <button
          onClick={() => setTab("golfers")}
          data-haptic="selection"
          aria-pressed={tab === "golfers"}
          className={`flex-1 rounded-full py-2 text-sm font-semibold transition ${
            tab === "golfers" ? "bg-gradient-to-br from-brand-forest to-brand-forest-deep text-white" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {t("find.tabGolfers")}
        </button>
      </div>

      {/* Secondary now that Home has its own primary Tee Times entry point
          (see Home.tsx) — a plain small link, not a card, so it never
          competes with the Rounds/Golfers tab content below it. Still
          visible on both tabs since it's a general utility, not specific
          to either. */}
      {TEE_TIMES_VISIBLE && (
        <button
          onClick={() => navigate("/tee-times")}
          className="flex items-center gap-1.5 self-start text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800"
        >
          <CalendarClock size={14} />
          {t("teeTimes.title")}
          <ChevronRight size={14} />
        </button>
      )}

      {tab === "rounds" ? <GolfCalls embedded /> : <Discover embedded />}
    </div>
  );
}

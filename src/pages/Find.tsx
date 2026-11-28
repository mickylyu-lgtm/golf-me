import { SimulatorMembershipRecovery } from "../components/find/SimulatorMembershipRecovery";
import { useAuth } from "../context/AuthContext";
import { useSimulatorApi, useSimulatorDiscoveryVisible } from "../lib/simulatorApiContext";
import { useData } from "../context/DataContext";
import { effectiveLocation, locationParams } from "../lib/travelLocation";
import { SimulatorPilot } from "../components/find/SimulatorPilot";
import { useEffect } from "react";
import { useLocation, useSearchParams, useNavigate } from "react-router-dom";
import { GolfCalls } from "./GolfCalls";
import { Discover } from "./Discover";
import { NearbyCourses } from "./NearbyCourses";
import { useLocale } from "../i18n/LocaleContext";
import { useSessionState } from "../lib/useSessionState";
import { FIND_TAB_PARAM, FIND_TAB_STORAGE_KEY, isFindTab, resolveFindTab } from "../lib/findTab";
import type { FindTab } from "../lib/findTab";

export function Find() {
  const [rememberedTab, setTab] = useSessionState<FindTab>(FIND_TAB_STORAGE_KEY, "rounds", isFindTab);
  const { t } = useLocale();
  const { currentUser } = useData();
  const { authUser } = useAuth();
  const showSimulators = useSimulatorDiscoveryVisible();
  const recoveryApi = useSimulatorApi("recovery");
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // RootTabCarousel keeps Find mounted under every root tab, so only read
  // ?tab= while Play itself is showing.
  const requestedTab = pathname === "/find" ? searchParams.get(FIND_TAB_PARAM) : null;
  // Derived during render (not only in the effect below) so an explicit
  // request never flashes the remembered tab for a frame first.
  const resolvedTab = resolveFindTab(requestedTab, rememberedTab);
  const tab = !showSimulators && resolvedTab === "simulators" ? "rounds" : resolvedTab;
  const area = effectiveLocation(currentUser, searchParams);

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
        <button
          onClick={() => setTab("courses")}
          data-haptic="selection"
          aria-pressed={tab === "courses"}
          className={`flex-1 rounded-full py-2 text-sm font-semibold transition ${
            tab === "courses" ? "bg-gradient-to-br from-brand-forest to-brand-forest-deep text-white" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {t("find.tabCourses")}
        </button>
        {showSimulators && <button onClick={() => setTab("simulators")} aria-pressed={tab === "simulators"} className={`flex-1 rounded-full py-2 text-sm font-semibold ${tab === "simulators" ? "bg-brand-forest text-white" : "text-slate-500"}`}>{t("simulator.title")}</button>}
      </div>

      {pathname === "/find" && recoveryApi && <SimulatorMembershipRecovery key={authUser?.id ?? "fixture"} api={recoveryApi} discoveryAvailable={showSimulators} />}
      {tab === "simulators" ? <SimulatorPilot key={JSON.stringify([authUser?.id, area.label])} locationLabel={area.label} onHost={() => navigate("/golf-calls/new?" + new URLSearchParams({session: "simulator", ...locationParams(area)}).toString())} /> : tab === "rounds" ? <GolfCalls embedded /> : tab === "golfers" ? <Discover /> : <NearbyCourses embedded />}
    </div>
  );
}

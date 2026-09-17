import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LocateFixed, MapPin } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useLocale } from "../../i18n/LocaleContext";
import { Button } from "../ui/Button";
import { LocationPicker } from "../location/LocationPicker";
import { useNearbyCourses } from "../../lib/useCourseSearch";
import { resolveTravelRadiusMiles } from "../../lib/matchPreferences";
import { formatDistanceMiles } from "../../lib/geo";
import type { PlayingArea } from "../../lib/geo";

const HOME_PREVIEW_COUNT = 2;

// Home's entry point into the standalone /courses/nearby screen — reuses
// the exact same nearby-course source (useNearbyCourses), never a second
// search implementation. Two distinct states, matching the brief's own
// "Golf Courses Near You" / [Use My Location] copy for a golfer with no
// saved area yet, and a quiet preview + "View nearby courses" link for one
// who already has one (skips re-asking for location it already has).
export function NearbyCoursesHomeCard() {
  const { currentUser } = useData();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);

  const area: PlayingArea | undefined = currentUser.playingAreaCoords
    ? { label: currentUser.areaLabel, coords: currentUser.playingAreaCoords }
    : undefined;
  const radiusMiles = resolveTravelRadiusMiles(currentUser);
  const { results, loading, error } = useNearbyCourses(area, radiusMiles);

  function handleLocationSelected(picked: PlayingArea) {
    setLocationPickerOpen(false);
    // This one-off pick isn't saved back to the profile here — that's a
    // separate, explicit decision (Profile/Match Preferences own that) —
    // it's just handed straight to the full screen so it doesn't have to
    // be asked for a second time one tap later.
    navigate("/courses/nearby", { state: { area: picked } });
  }

  if (!area) {
    return (
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4">
        <div>
          <p className="text-sm font-bold text-slate-900">{t("nearbyCourses.homeCardTitle")}</p>
          <p className="mt-0.5 text-xs text-slate-500">{t("nearbyCourses.promptBody")}</p>
        </div>
        <Button size="sm" icon={<LocateFixed size={14} />} onClick={() => setLocationPickerOpen(true)}>
          {t("nearbyCourses.useMyLocation")}
        </Button>
        {locationPickerOpen && (
          <LocationPicker title={t("nearbyCourses.title")} autoRequestLocation onSelect={handleLocationSelected} onClose={() => setLocationPickerOpen(false)} />
        )}
      </section>
    );
  }

  // A saved area is known — quietly fetch a small preview. Never surfaces
  // its own loading/error UI on Home (the full screen owns that); this
  // section simply doesn't render until there's something real to show,
  // same "only appear once there's content" precedent as nearbyRounds/
  // latestCaddieAnalysis elsewhere on this page.
  if (loading || error || results.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">{t("nearbyCourses.homeCardTitle")}</h2>
        <button
          onClick={() => navigate("/courses/nearby")}
          className="text-sm font-semibold text-fairway-700 transition-colors duration-200 hover:text-fairway-800 hover:underline"
        >
          {t("nearbyCourses.viewNearbyCourses")}
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        {results.slice(0, HOME_PREVIEW_COUNT).map((r) => (
          <div key={r.id ?? r.name} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fairway-50 text-fairway-600">
              <MapPin size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-800">{r.name}</span>
              {r.area && <span className="block truncate text-xs text-slate-500">{r.area}</span>}
            </span>
            <span className="shrink-0 text-xs font-semibold text-fairway-700">
              {r.distanceMiles != null ? formatDistanceMiles(r.distanceMiles) : t("nearbyCourses.distanceUnknown")}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

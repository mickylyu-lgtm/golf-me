import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, LocateFixed, MapPin, Search } from "lucide-react";
import { useData } from "../context/DataContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { CourseSearchStatus } from "../components/ui/CourseSearchStatus";
import { LocationPicker } from "../components/location/LocationPicker";
import { useNearbyCourses } from "../lib/useCourseSearch";
import { resolveTravelRadiusMiles } from "../lib/matchPreferences";
import { formatDistanceMiles } from "../lib/geo";
import type { PlayingArea } from "../lib/geo";
import { matchSupportedTeeTimeCourse } from "../services/teeTimes/types";

// Standalone "Golf Courses Near You" results screen — reuses the existing
// nearby-course source end to end (Geoapify via useNearbyCourses, the same
// hook CoursePicker/CourseAutocomplete already use), never a second search
// system. Reachable from Home's own preview card (which passes a
// freshly-picked location via router state when the golfer doesn't have
// one saved yet) or directly, in which case it falls back to the golfer's
// saved playing area, or its own copy of the same "Use My Location" prompt.
export function NearbyCourses() {
  const { currentUser } = useData();
  const { t } = useLocale();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const passedArea = (routerLocation.state as { area?: PlayingArea } | null)?.area;

  const [area, setArea] = useState<PlayingArea | undefined>(
    passedArea ?? (currentUser.playingAreaCoords ? { label: currentUser.areaLabel, coords: currentUser.playingAreaCoords } : undefined),
  );
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);

  // V1: no radius picker — always the golfer's own saved travel-radius
  // preference (already exists, already defaults to 25mi), per explicit
  // instruction. Shown read-only below so it's clear why a course just
  // outside it wouldn't appear.
  const radiusMiles = resolveTravelRadiusMiles(currentUser);
  const { results, loading, error, retry } = useNearbyCourses(area, radiusMiles);

  function handleLocationSelected(picked: PlayingArea) {
    setArea(picked);
    setLocationPickerOpen(false);
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("nearbyCourses.title")}</h1>
        <p className="text-sm text-slate-500">{t("nearbyCourses.subtitle")}</p>
      </div>

      {!area ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-white p-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fairway-50 text-fairway-600">
            <Search size={22} />
          </span>
          <p className="text-sm text-slate-500">{t("nearbyCourses.promptBody")}</p>
          <Button icon={<LocateFixed size={16} />} onClick={() => setLocationPickerOpen(true)}>
            {t("nearbyCourses.useMyLocation")}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-3.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <MapPin size={16} className="shrink-0 text-fairway-600" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{area.label}</p>
                <p className="text-xs text-slate-400">{t("nearbyCourses.radiusLabel", { radius: radiusMiles })}</p>
              </div>
            </div>
            <button onClick={() => setLocationPickerOpen(true)} className="shrink-0 text-xs font-semibold text-fairway-700 hover:underline">
              {t("common.change")}
            </button>
          </div>

          <CourseSearchStatus loading={loading} error={error} onRetry={retry} />

          {!loading && !error && results.length === 0 && (
            <EmptyState icon={<Search size={20} />} title={t("nearbyCourses.emptyTitle")} description={t("nearbyCourses.emptyDescription")} />
          )}

          {!loading && !error && results.length > 0 && (
            <div className="flex flex-col gap-3">
              {results.map((r) => {
                const supported = matchSupportedTeeTimeCourse(r.name);
                const content = (
                  <>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-fairway-50 text-fairway-600">
                      {supported?.heroImageUrl ? (
                        <img src={supported.heroImageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <MapPin size={18} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-bold text-slate-900">{r.name}</span>
                        {supported && <Badge tone="fairway">{t("nearbyCourses.teeTimesAvailable")}</Badge>}
                      </span>
                      {r.area && <span className="block truncate text-xs text-slate-500">{r.area}</span>}
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-slate-500">
                      {r.distanceMiles != null ? formatDistanceMiles(r.distanceMiles) : t("nearbyCourses.distanceUnknown")}
                    </span>
                  </>
                );
                // Only courses GolfMe can actually help book are tappable —
                // every other real nearby course stays plainly informational
                // (name/distance/area), never implying live booking it
                // doesn't have (same truthfulness rule as Phase 8).
                return supported ? (
                  <button
                    key={r.id ?? r.name}
                    onClick={() => navigate(`/tee-times/${supported.id}`)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3.5 text-left transition-colors duration-150 hover:border-fairway-300"
                  >
                    {content}
                  </button>
                ) : (
                  <div key={r.id ?? r.name} className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3.5">
                    {content}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {locationPickerOpen && (
        <LocationPicker
          title={t("nearbyCourses.title")}
          autoRequestLocation={!area}
          onSelect={handleLocationSelected}
          onClose={() => setLocationPickerOpen(false)}
        />
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import type { DisplayCourseResult } from "../../lib/useCourseSearch";
import { aerialCredit, courseSatelliteImageUrl, courseTileSource } from "../../lib/courseImagery";
import { useBestCoursePhoto, type CoursePhoto } from "../../lib/courseImageryClient";
import { courseMediaTabs, overviewAvailable, pickCourseMediaTab, type MediaTab } from "../../lib/courseImageSelect";
import { POINT_HERO_ZOOM } from "../../../supabase/functions/_shared/courseBounds.ts";
import { matchSupportedTeeTimeCourse } from "../../services/teeTimes/types";
import { CourseOverviewMap } from "./CourseOverviewMap";
import { supportsWebGL } from "../../lib/webgl";
import { FittedSatelliteTiles } from "./SatelliteTiles";
import { naipExportFor } from "../../lib/naipExport";
import { GenericCourseIllustration } from "./CourseHero";

// The picture block at the top of a course page (and the course map's
// sheet): one box, its size reserved up front, with a small switch over it
// when there's more than one view.
//   Overview    the live "drone" satellite view (CourseOverviewMap), framed
//               on the course's OpenStreetMap outline
//   Photo       the best real photo of the course itself: hand-picked,
//               Google Places, Wikimedia
//   Satellite   a still satellite view, only when the overview can't run
// The first available one leads. Credits sit on one reserved line below.

interface ShownPhoto {
  url: string;
  credit: ReactNode;
}

function linkOrText(text: string, href?: string | null): ReactNode {
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
      {text}
    </a>
  ) : (
    text
  );
}

function photoCredit(photo: CoursePhoto, photoLabel: string): ReactNode {
  if (photo.source === "google") {
    const authors = photo.authors ?? [];
    return (
      <>
        {authors.length > 0 && (
          <>
            {photoLabel}{" "}
            {authors.map((a, i) => (
              <span key={a.name + i}>
                {i > 0 && ", "}
                {linkOrText(a.name, a.uri)}
              </span>
            ))}
            {" · "}
          </>
        )}
        {/* "Google Maps" exactly, never translated (Google's attribution rules). */}
        {linkOrText("Google Maps", photo.mapsUri)}
      </>
    );
  }
  return linkOrText(photo.credit ?? "Wikimedia Commons", photo.pageUrl);
}

export function CourseMedia({ course }: { course: DisplayCourseResult }) {
  const { t } = useLocale();
  // USGS NAIP for US courses (no key), MapTiler when keyed, else none.
  const source = courseTileSource(course);
  const hasCoords = course.lat != null && course.lng != null && Number.isFinite(course.lat) && Number.isFinite(course.lng);
  const webgl = useMemo(() => supportsWebGL(), []);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  // MapTiler tiles refused (bad/blocked key, outage): no still tiles either.
  const [tilesFailed, setTilesFailed] = useState(false);
  const [chosen, setChosen] = useState<MediaTab | null>(null);

  const handpicked = matchSupportedTeeTimeCourse(course.name);
  const handpickedUrl = handpicked?.heroImageUrl;
  const { photo, settled, bounds } = useBestCoursePhoto(course, "hero", !handpickedUrl);

  const shownPhoto: ShownPhoto | null = photoFailed
    ? null
    : handpickedUrl
      ? { url: handpickedUrl, credit: handpicked?.heroImageCredit ?? null }
      : photo
        ? { url: photo.url, credit: photoCredit(photo, t("courseMedia.photoLabel")) }
        : null;
  const mapboxUrl = courseSatelliteImageUrl(course.lat, course.lng);
  const canOverview = overviewAvailable({ hasSource: Boolean(source), hasCoords, webgl }) && !overviewFailed;
  const useTiles = Boolean(source) && hasCoords && !tilesFailed;
  const tabs = courseMediaTabs({ overviewAvailable: canOverview, hasPhoto: Boolean(shownPhoto), hasStaticSatellite: useTiles || Boolean(mapboxUrl) });
  const tab = pickCourseMediaTab(tabs, chosen);
  // The one sharp NAIP picture, for the still view (the overview asks for
  // the same URL itself). USGS only; only once that tab shows.
  const stillDetail = useMemo(
    () => (tab === "satellite" && source?.id === "usgs" ? naipExportFor(bounds, { devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1 }) : null),
    [tab, source?.id, bounds],
  );
  const label = [course.name, course.area].filter(Boolean).join(", ");
  const tabLabel: Record<MediaTab, string> = {
    overview: t("courseMedia.overview"),
    photo: t("courseImage.photo"),
    satellite: t("courseImage.satellite"),
  };

  let credit: ReactNode = null;
  if (tab === "photo" && shownPhoto) credit = shownPhoto.credit;
  else if (tab === "satellite" && useTiles && source) credit = aerialCredit(source);

  return (
    <div>
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-fairway-50">
        {tab === "overview" && hasCoords && source && (
          <CourseOverviewMap
            key={`${course.lat},${course.lng},${source.id}`}
            lat={course.lat!}
            lng={course.lng!}
            bounds={bounds}
            name={course.name}
            source={source}
            onFail={() => setOverviewFailed(true)}
          />
        )}
        {tab === "photo" && shownPhoto && (
          <img key={shownPhoto.url} src={shownPhoto.url} alt={label} decoding="async" className="h-full w-full animate-fade-in object-cover motion-reduce:animate-none" onError={() => setPhotoFailed(true)} />
        )}
        {tab === "satellite" &&
          (useTiles && source ? (
            <FittedSatelliteTiles source={source} lat={course.lat!} lng={course.lng!} bounds={bounds} fallbackZoom={POINT_HERO_ZOOM} onError={() => setTilesFailed(true)} detail={stillDetail} />
          ) : mapboxUrl ? (
            <img src={mapboxUrl} alt={label} decoding="async" className="h-full w-full object-cover" />
          ) : null)}
        {tab === null && (settled || handpickedUrl ? <GenericCourseIllustration /> : <div className="h-full w-full animate-pulse bg-fairway-50 motion-reduce:animate-none" />)}

        {tabs.length > 1 && tab && (
          <div role="tablist" aria-label={t("courseMedia.views")} className="absolute left-2.5 top-2.5 z-[1] inline-flex rounded-full bg-slate-900/55 p-0.5 backdrop-blur-sm">
            {tabs.map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={tab === m}
                onClick={() => setChosen(m)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150 ${
                  tab === m ? "bg-white text-slate-900" : "text-white/90 hover:text-white"
                }`}
              >
                {tabLabel[m]}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-1 min-h-[15px] truncate text-right text-[10px] leading-[15px] text-slate-400">{credit}</p>
    </div>
  );
}

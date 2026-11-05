import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { courseSatelliteThumbUrl, courseTileSource, mapboxEnabled, maptilerKey } from "../../lib/courseImagery";
import { setCourseImageMode, useCourseImageMode, type CourseImageMode } from "../../lib/coursePhotos";
import { useBestCoursePhoto, useGooglePhotosShown } from "../../lib/courseImageryClient";
import { TILES_FAILED_KEY, chooseThumbSource } from "../../lib/courseImageSelect";
import { POINT_THUMB_ZOOM, type CourseBounds } from "../../../supabase/functions/_shared/courseBounds.ts";
import { SatelliteTiles } from "./SatelliteTiles";
import { useLocale } from "../../i18n/LocaleContext";

interface CourseThumbProps {
  name: string;
  /** courses.id for real courses: their photo comes from course-photos. */
  courseId?: string;
  /** Hand-picked course photo (SUPPORTED_TEE_TIME_COURSES), preferred. */
  imageUrl?: string;
  lat?: number;
  lng?: number;
  /** The course's OSM outline, when the caller already has it (demo
   * fixtures); real courses get it from course-photos. */
  bounds?: CourseBounds | null;
  /** The course's country (real courses), for the US-only aerial source. */
  country?: string | null;
  /** Square size in CSS px (matches the h-/w- classes in className). */
  sizePx: number;
  className: string;
  /** What the square is showing right now (after any load failure), so a
   * credit line next to it can name the right source. */
  onShown?: (shown: ThumbShown) => void;
}

export type ThumbShown = "handpicked" | "google" | "wikimedia" | "tiles" | "static" | "none" | "waiting";

// Square course thumbnail for list rows and the map card. In "Photo" mode
// (the default): the hand-picked photo, else the course's real photo
// (Google Places, else Wikimedia; see courseImageryClient), else satellite
// (MapTiler tiles, else the Mapbox image), else the pin. In "Satellite"
// mode: satellite for every course. The square is always reserved, so
// nothing shifts when the picture arrives. Never a live map in a list.
export function CourseThumb({ name, courseId, imageUrl, lat, lng, bounds, country, sizePx, className, onShown }: CourseThumbProps) {
  const mode = useCourseImageMode();
  const hasCoords = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
  const source = courseTileSource({ lat, lng, country });
  const { photo, settled, bounds: outline } = useBestCoursePhoto({ id: courseId, name, lat, lng, bounds }, "thumb", mode === "photo" && !imageUrl);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => setFailed(new Set()), [mode, courseId, name]);
  const markFailed = (key: string) => setFailed((f) => (f.has(key) ? f : new Set([...f, key])));

  // While the photo lookup is running, show the plain square (not the
  // satellite), so a row doesn't flash satellite and then swap to a photo.
  const waiting = mode === "photo" && !imageUrl && !settled;
  const choice = waiting
    ? { kind: "none" as const }
    : chooseThumbSource({
        mode,
        handpickedUrl: imageUrl,
        photo,
        tilesAvailable: Boolean(source) && hasCoords,
        staticUrl: courseSatelliteThumbUrl(lat, lng),
        failed,
      });
  const shown: ThumbShown = waiting ? "waiting" : choice.kind === "photo" ? choice.source : choice.kind;
  useEffect(() => onShown?.(shown), [shown, onShown]);

  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-fairway-50 text-fairway-600 ${className}`}>
      {choice.kind === "photo" || choice.kind === "static" ? (
        <img
          key={choice.url}
          src={choice.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full animate-fade-in object-cover motion-reduce:animate-none"
          onError={() => markFailed(choice.url)}
        />
      ) : choice.kind === "tiles" && hasCoords && source ? (
        <SatelliteTiles
          source={source}
          lat={lat!}
          lng={lng!}
          bounds={outline}
          fallbackZoom={POINT_THUMB_ZOOM}
          width={sizePx}
          height={sizePx}
          onError={() => markFailed(TILES_FAILED_KEY)}
        />
      ) : waiting ? null : (
        <MapPin size={18} />
      )}
    </span>
  );
}

// Aerial credits for thumbnails drawn without them: the active tile source
// (USGS NAIP by default, MapTiler when keyed), OpenStreetMap (course
// outlines), and Mapbox when its image can stand in (non-US, no MapTiler).
export function SatelliteAttribution() {
  const link = "hover:underline";
  const keyed = Boolean(maptilerKey());
  return (
    <p className="text-right text-[10px] text-slate-400">
      {keyed ? (
        <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener noreferrer" className={link}>
          © MapTiler
        </a>
      ) : (
        <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener noreferrer" className={link}>
          USGS The National Map: Orthoimagery
        </a>
      )}{" "}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className={link}>
        © OpenStreetMap contributors
      </a>
      {!keyed && mapboxEnabled() && (
        <>
          {" "}
          <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener noreferrer" className={link}>
            © Mapbox
          </a>{" "}
          <a href="https://www.maxar.com/" target="_blank" rel="noopener noreferrer" className={link}>
            © Maxar
          </a>
        </>
      )}
    </p>
  );
}

// Credit line for photos in a list. Google allows thumbnails without the
// author when the full-size photo (on the course page) carries it, but
// "Google Maps" must stay visible wherever its content is shown.
export function PhotoAttribution() {
  const { t } = useLocale();
  const google = useGooglePhotosShown();
  return <p className="text-right text-[10px] text-slate-400">{t(google ? "courseImage.photosCreditWithGoogle" : "courseImage.photosCredit")}</p>;
}

// "Photo | Satellite" switch for list thumbnails (remembered on this
// device).
export function CourseImageModeToggle() {
  const { t } = useLocale();
  const mode = useCourseImageMode();
  const options: { value: CourseImageMode; label: string }[] = [
    { value: "photo", label: t("courseImage.photo") },
    { value: "satellite", label: t("courseImage.satellite") },
  ];
  return (
    <div role="radiogroup" aria-label={t("courseImage.viewLabel")} className="inline-flex shrink-0 rounded-full bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={mode === o.value}
          onClick={() => setCourseImageMode(o.value)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors duration-150 ${
            mode === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

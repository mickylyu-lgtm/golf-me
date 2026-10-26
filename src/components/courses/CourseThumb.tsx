import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { courseSatelliteThumbUrl } from "../../lib/courseImagery";
import { setCourseImageMode, useCourseImageMode, useCoursePhoto, type CourseImageMode } from "../../lib/coursePhotos";
import { useLocale } from "../../i18n/LocaleContext";

interface CourseThumbProps {
  name: string;
  /** Hand-picked course photo (SUPPORTED_TEE_TIME_COURSES), preferred. */
  imageUrl?: string;
  lat?: number;
  lng?: number;
  className: string;
}

// Square course thumbnail for list rows. In "Photo" mode (the default): the
// hand-picked photo, else a Wikimedia photo of the course (coursePhotos.ts),
// else the satellite view. In "Satellite" mode: the satellite view for every
// course. The pin icon when there's nothing (no token, no coordinates, or
// the image failed to load). Micky, 2026-10-23: a picture on every row
// shows golfers each course opens; 2026-10-25: a real look at the course,
// with the satellite view one switch away.
export function CourseThumb({ name, imageUrl, lat, lng, className }: CourseThumbProps) {
  const mode = useCourseImageMode();
  const photo = useCoursePhoto(name, lat, lng, mode === "photo" && !imageUrl);
  const satellite = courseSatelliteThumbUrl(lat, lng);
  const src = mode === "satellite" ? satellite : (imageUrl ?? photo?.thumbUrl ?? satellite);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => setFailed(null), [mode]);

  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-fairway-50 text-fairway-600 ${className}`}>
      {src && failed !== src ? (
        <img key={src} src={src} alt="" loading="lazy" className="h-full w-full animate-fade-in object-cover motion-reduce:animate-none" onError={() => setFailed(src)} />
      ) : (
        <MapPin size={18} />
      )}
    </span>
  );
}

// Mapbox attribution for thumbnails drawn without it (see courseImagery.ts).
export function SatelliteAttribution() {
  return (
    <p className="text-right text-[10px] text-slate-400">
      <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener noreferrer" className="hover:underline">
        © Mapbox
      </a>{" "}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="hover:underline">
        © OpenStreetMap
      </a>{" "}
      <a href="https://www.maxar.com/" target="_blank" rel="noopener noreferrer" className="hover:underline">
        © Maxar
      </a>
    </p>
  );
}

// Credit line for Wikimedia photos in a list: each photo's author and
// license are on its course page (CourseHero), as Commons' licenses allow.
export function PhotoAttribution() {
  const { t } = useLocale();
  return <p className="text-right text-[10px] text-slate-400">{t("courseImage.photosCredit")}</p>;
}

// "Photo | Satellite" switch for every course image (remembered on this
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

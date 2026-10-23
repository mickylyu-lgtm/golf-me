import { useState } from "react";
import { MapPin } from "lucide-react";
import { courseSatelliteThumbUrl } from "../../lib/courseImagery";

interface CourseThumbProps {
  /** Hand-picked course photo (SUPPORTED_TEE_TIME_COURSES), preferred. */
  imageUrl?: string;
  lat?: number;
  lng?: number;
  className: string;
}

// Square course thumbnail for list rows: the course's own photo when it has
// one, otherwise a satellite view from its coordinates, otherwise the pin
// icon (no token, no coordinates, or the image failed to load). Micky,
// 2026-10-23: a picture on every row shows golfers each course opens.
export function CourseThumb({ imageUrl, lat, lng, className }: CourseThumbProps) {
  const [failed, setFailed] = useState(false);
  const src = imageUrl ?? courseSatelliteThumbUrl(lat, lng);

  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-fairway-50 text-fairway-600 ${className}`}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(true)} />
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

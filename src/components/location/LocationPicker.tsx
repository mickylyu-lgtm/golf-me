import { useState } from "react";
import { LocateFixed, MapPin, Search } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { inputClass } from "../ui/FormControls";
import { REGIONS, searchRegions } from "../../data/regions";
import type { Region } from "../../data/regions";
import { haversineMiles } from "../../lib/geo";
import type { PlayingArea } from "../../lib/geo";

// How close a real geolocation fix needs to be to one of our curated
// region centroids before we're willing to label it with that city name —
// beyond this, still use the real coordinates (course distance/recommend
// still works), just without pretending to know which city it is.
const NEAREST_REGION_LABEL_RADIUS_MILES = 60;

interface LocationPickerProps {
  title?: string;
  onSelect: (area: PlayingArea) => void;
  onClose: () => void;
}

type GeoStatus = "idle" | "requesting" | "denied" | "unsupported";

function nearestRegion(lat: number, lng: number): Region | undefined {
  let best: Region | undefined;
  let bestDist = Infinity;
  for (const r of REGIONS) {
    const d = haversineMiles({ lat, lng }, r.coords);
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  return best && bestDist <= NEAREST_REGION_LABEL_RADIUS_MILES ? best : undefined;
}

// General area only — city/region granularity, never an exact address.
// Real navigator.geolocation permission flow (no mock), with a graceful,
// non-blocking fallback to manual search when denied/unsupported. Reuses
// the shared Modal, which is already a full-screen sheet on mobile and a
// centered dialog on desktop.
export function LocationPicker({ title = "Where do you usually play?", onSelect, onClose }: LocationPickerProps) {
  const [query, setQuery] = useState("");
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");

  const results = searchRegions(query);
  const trimmedQuery = query.trim();
  const exactMatch = results.some((r) => r.label.toLowerCase() === trimmedQuery.toLowerCase());

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setGeoStatus("unsupported");
      return;
    }
    setGeoStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const region = nearestRegion(latitude, longitude);
        onSelect({ label: region?.label ?? "Current Location", coords: { lat: latitude, lng: longitude } });
      },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  function selectRegion(region: Region) {
    onSelect({ label: region.label, coords: region.coords });
  }

  function useFreeTextLabel() {
    if (!trimmedQuery) return;
    onSelect({ label: trimmedQuery });
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Button variant="outline" fullWidth icon={<LocateFixed size={16} />} onClick={useCurrentLocation} disabled={geoStatus === "requesting"}>
          {geoStatus === "requesting" ? "Getting your location..." : "Use My Current Location"}
        </Button>
        {geoStatus === "denied" && (
          <p className="text-xs text-slate-500">
            Location permission was denied — no problem, choose your area below instead. You can allow location later from your browser settings.
          </p>
        )}
        {geoStatus === "unsupported" && <p className="text-xs text-slate-500">Location isn't available on this device — choose your area below.</p>}

        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <span className="h-px flex-1 bg-slate-100" /> or choose manually <span className="h-px flex-1 bg-slate-100" />
        </div>

        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search city or region..."
            className={`${inputClass} pl-9`}
          />
        </div>

        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => selectRegion(r)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-fairway-50"
            >
              <MapPin size={15} className="shrink-0 text-fairway-600" />
              <span className="flex-1">{r.label}</span>
              {!r.hasCourseCoverage && <span className="shrink-0 text-[11px] font-normal text-slate-400">Limited course data</span>}
            </button>
          ))}
          {trimmedQuery && !exactMatch && (
            <button
              onClick={useFreeTextLabel}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-fairway-700 transition-colors duration-150 hover:bg-fairway-50"
            >
              <MapPin size={15} className="shrink-0" />
              Use "{trimmedQuery}" as my area
            </button>
          )}
          {results.length === 0 && !trimmedQuery && <p className="px-3 py-2.5 text-sm text-slate-400">Start typing to search.</p>}
        </div>
      </div>
    </Modal>
  );
}

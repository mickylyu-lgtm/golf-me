import { useEffect, useState } from "react";
import type { GolferProfile } from "../types";
import { fetchGolferDirectoryFrom } from "./publicProfilesFetch";
import { snapToDirectoryCell } from "./publicDirectory";
import type { TravelDirectoryStatus } from "./travelGolfers";

// The directory measured from a temporary search area, for Auto-Match
// (lib/travelGolfers). Keyed on the area's ~5 km cell, so moving the pin
// inside one cell doesn't refetch. `enabled` false (no temporary area, or
// demo) -> "idle", no request. Read-only: never touches the saved area.
export function useTravelGolferDirectory(area: { lat: number; lng: number } | undefined, enabled: boolean) {
  const cell = enabled ? snapToDirectoryCell(area) : null;
  const key = cell ? `${cell.lat},${cell.lng}` : null;
  const [state, setState] = useState<{ key: string | null; status: TravelDirectoryStatus; profiles: GolferProfile[] }>({
    key: null,
    status: "idle",
    profiles: [],
  });

  useEffect(() => {
    if (!key || !cell) return;
    let cancelled = false;
    setState({ key, status: "loading", profiles: [] });
    void fetchGolferDirectoryFrom(cell).then((r) => {
      if (cancelled) return;
      if (r.unsupported) setState({ key, status: "unsupported", profiles: [] });
      else if (r.error) setState({ key, status: "error", profiles: [] });
      else setState({ key, status: "ready", profiles: r.profiles });
    });
    return () => {
      cancelled = true;
    };
    // cell is derived from key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return { status: "idle" as TravelDirectoryStatus, profiles: [] as GolferProfile[] };
  // A result for a previous area never shows for this one.
  if (state.key !== key) return { status: "loading" as TravelDirectoryStatus, profiles: [] as GolferProfile[] };
  return { status: state.status, profiles: state.profiles };
}

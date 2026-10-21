import type { PlayingAreaPlace } from "../../lib/geo";
import { useLocalizedAreaLabel } from "../../lib/usePlaceNames";

// A golfer's playing area in the VIEWER's app language (falls back to the
// stored English/as-typed label). See src/lib/placeNames.ts.
export function AreaLabel({ areaLabel, place }: { areaLabel: string; place?: PlayingAreaPlace }) {
  return <>{useLocalizedAreaLabel(areaLabel, place)}</>;
}

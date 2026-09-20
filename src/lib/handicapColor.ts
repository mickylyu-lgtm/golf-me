// Subtle color progression for the handicap NUMBER only, on profile
// identity lines — golf-ability signal, deliberately separate from GolfMe
// Reputation (community trust/reliability). Never touch reputation scoring,
// matching, or reviews from here — this is presentation only, reading the
// same already-stored `handicap: number | null` GolferProfile field
// everything else already reads, never a second calculation of it.
//
// A negative stored value is a plus handicap (standard golf convention —
// e.g. a "+2" player's index is stored as -2) and belongs in the same
// restrained-gold band as scratch (0), never its own separate treatment.
// null (unknown/unset) is always neutral -- never inferred, never gold.
const BANDS = [
  { max: 0, className: "text-brand-gold" }, // scratch (0) and plus (negative) handicaps
  { max: 5, className: "text-violet-600" }, // 0.1-4.9
  { max: 10, className: "text-teal-600" }, // 5.0-9.9
  { max: 20, className: "text-brand-forest" }, // 10.0-19.9 -- the GolfMe brand green anchor
  { max: 30, className: "text-fairway-400" }, // 20.0-29.9 -- muted/light green
] as const;
const NEUTRAL_CLASS = "text-slate-500"; // 30.0+, and unknown/unset

export function handicapColorClass(handicap: number | null): string {
  if (handicap === null) return NEUTRAL_CLASS;
  for (const band of BANDS) {
    if (handicap < band.max || (band.max === 0 && handicap <= 0)) return band.className;
  }
  return NEUTRAL_CLASS;
}

// Renders the sign correctly for a plus handicap (stored as negative --
// see above) and preserves whatever decimal precision is already stored,
// same as every other handicap display in the app -- never rounds, never
// invents a value. Returns "--" for null so callers can drop it straight
// into existing "{count} rounds · Handicap {number}"-shaped layouts
// unchanged.
export function formatHandicapNumber(handicap: number | null): string {
  if (handicap === null) return "--";
  if (handicap < 0) return `+${Math.abs(handicap)}`;
  return String(handicap);
}

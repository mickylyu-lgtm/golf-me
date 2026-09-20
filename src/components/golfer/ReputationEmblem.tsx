import type { ReputationFamily, ReputationTierKey } from "../../lib/reputationTiers";
import { TIER_DEFS, tierDisplayName, tierFamily } from "../../lib/reputationTiers";
import { useLocale } from "../../i18n/LocaleContext";

// GolfMe Reputation crests -- ported 1:1 from the approved artifact
// (reputation-emblems.html, round 5) as the frozen visual source of truth.
// One shield DNA shared by all five families: SHIELD_BASE for
// Newcomer/Established, SHIELD_WIDE (shoulders pushed out) for
// Trusted/Premier, SHIELD_ELITE (WIDE plus a small top peak) for Elite.
// Tiers differ only in inset-border count, ornament, and dimple count --
// never a different shape family. Do not hand-edit this geometry; any
// further visual change goes back through the artifact for approval first.
const SHIELD_BASE = "M32,6 C45,6 54,11.5 54,11.5 L54,33 C54,50 45,62 32,66 C19,62 10,50 10,33 L10,11.5 C10,11.5 19,6 32,6 Z";
const SHIELD_WIDE = "M32,5 C47,5 57,10.5 57,10.5 L57,32 C57,51 47,63 32,67 C17,63 7,51 7,32 L7,10.5 C7,10.5 17,5 32,5 Z";
const SHIELD_ELITE = "M32,2 L37,5 C47,5 57,10.5 57,10.5 L57,32 C57,52 47,64.5 32,68.5 C17,64.5 7,52 7,32 L7,10.5 C7,10.5 17,5 27,5 L32,2 Z";

// Flag/pole + dimple-row geometry, unchanged from the approved artifact.
const FLAG_X = 30;
const DIMPLE_X = 32;
const SYMBOL_Y = 19.5;
const SYMBOL_WHITE = "#fdfcf8";
const DIMPLE_RADIUS = 3.1;
const DIMPLE_POSITIONS: [number, number][] = [
  [DIMPLE_X - 8.5, SYMBOL_Y + 29],
  [DIMPLE_X, SYMBOL_Y + 32],
  [DIMPLE_X + 8.5, SYMBOL_Y + 29],
];

type Ornament = "notch" | "fin" | "laurel" | null;

interface FamilyGeometry {
  shield: string;
  insetLevel: 0 | 1 | 2;
  ornament: Ornament;
  color: string;
  colorDeep: string;
}

// Colors: established (#1b4a2d/#0e2717) and elite (#f0b93f) are the exact
// same hex as the --color-brand-forest / --color-brand-forest-deep /
// --color-brand-gold design tokens (src/index.css) -- reused, not
// reinvented. Newcomer/trusted/premier match the Tailwind slate-400/
// teal-600/violet-600 shades FAMILY_STYLE already uses for the badge pill
// text/icon color, so the crest and the pill it sits in always agree. The
// "-deep" shades (border/inset stroke) have no existing named token in
// production, so they're hardcoded to the exact hex approved in the
// artifact -- same pattern FAMILY_STYLE already uses for elite's pill.
const FAMILY_GEOMETRY: Record<ReputationFamily, FamilyGeometry> = {
  newcomer: { shield: SHIELD_BASE, insetLevel: 0, ornament: null, color: "#94a3b8", colorDeep: "#748296" },
  established: { shield: SHIELD_BASE, insetLevel: 1, ornament: null, color: "#1b4a2d", colorDeep: "#0e2717" },
  trusted: { shield: SHIELD_WIDE, insetLevel: 1, ornament: "notch", color: "#0d9488", colorDeep: "#0a6e65" },
  premier: { shield: SHIELD_WIDE, insetLevel: 1, ornament: "fin", color: "#7c3aed", colorDeep: "#5b21b6" },
  elite: { shield: SHIELD_ELITE, insetLevel: 2, ornament: "laurel", color: "#f0b93f", colorDeep: "#c8931f" },
};

function OrnamentPaths({ kind, color, deep }: { kind: Ornament; color: string; deep: string }) {
  if (kind === "notch") {
    return (
      <>
        <path d="M10.5,17 L14,19.5 L10.5,22" fill="none" stroke={deep} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />
        <path d="M53.5,17 L50,19.5 L53.5,22" fill="none" stroke={deep} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />
      </>
    );
  }
  if (kind === "fin") {
    return (
      <>
        <path d="M5,15 C1,17 -0.5,21.5 1,26 C3.5,23 5.5,19.5 8,17.5 Z" fill={color} opacity={0.9} />
        <path d="M59,15 C63,17 64.5,21.5 63,26 C60.5,23 58.5,19.5 56,17.5 Z" fill={color} opacity={0.9} />
      </>
    );
  }
  if (kind === "laurel") {
    return (
      <>
        <path d="M5,14 C-1,16 -3.5,23 -1,30 C2,33 5,32.5 6,29 C2.5,25 2,19 6.5,16.5 Z" fill={color} opacity={0.92} />
        <path d="M59,14 C65,16 67.5,23 65,30 C61,33 58,32.5 57,29 C60.5,25 61,19 56.5,16.5 Z" fill={color} opacity={0.92} />
        <path d="M2,24 C-2,27 -3,32 -0.5,36.5 C2,35 4,32 4.5,28.5 Z" fill={color} opacity={0.75} />
        <path d="M62,24 C66,27 67,32 64.5,36.5 C62,35 60,32 59.5,28.5 Z" fill={color} opacity={0.75} />
      </>
    );
  }
  return null;
}

function InsetPaths({ geometry, small }: { geometry: FamilyGeometry; small: boolean }) {
  if (!geometry.insetLevel || small) return null;
  // Same outline, scaled around the shield's own visual center (32,36).
  // insetLevel 2 (Elite) nests two, the "strongest inner border."
  const scales = geometry.insetLevel === 2 ? [0.9, 0.76] : [0.86];
  return (
    <>
      {scales.map((s) => (
        <path
          key={s}
          d={geometry.shield}
          fill="none"
          stroke={geometry.colorDeep}
          strokeWidth={1}
          opacity={0.55}
          transform={`translate(32,36) scale(${s}) translate(-32,-36)`}
        />
      ))}
    </>
  );
}

function FlagGlyph() {
  return (
    <>
      <line x1={FLAG_X} y1={SYMBOL_Y} x2={FLAG_X} y2={SYMBOL_Y + 22} stroke={SYMBOL_WHITE} strokeWidth={2} strokeLinecap="round" opacity={0.92} />
      <path d={`M${FLAG_X},${SYMBOL_Y} L${FLAG_X + 10},${SYMBOL_Y + 5.5} L${FLAG_X},${SYMBOL_Y + 11} Z`} fill={SYMBOL_WHITE} />
    </>
  );
}

function Dimples({ count, small }: { count: number; small: boolean }) {
  return (
    <>
      {DIMPLE_POSITIONS.map(([cx, cy], i) =>
        i < count ? (
          <circle key={i} cx={cx} cy={cy} r={DIMPLE_RADIUS} fill={SYMBOL_WHITE} />
        ) : !small ? (
          <circle key={i} cx={cx} cy={cy} r={DIMPLE_RADIUS} fill="none" stroke={SYMBOL_WHITE} strokeWidth={1} opacity={0.3} />
        ) : null,
      )}
    </>
  );
}

// Fixed-footprint placeholder for the brief window (real accounts, first
// fetch of a session only -- see useReputationState's cache) before the
// real tier is known. Same width/height math as the real crest so nothing
// shifts when the real artwork replaces it; aria-hidden since it carries
// no meaningful content of its own for VoiceOver to announce.
export function ReputationEmblemSkeleton({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 animate-pulse rounded-[22%] bg-slate-200 ${className ?? ""}`}
      style={{ width: size, height: size * (74 / 64) }}
    />
  );
}

export interface ReputationEmblemProps {
  tier: ReputationTierKey;
  /** Pixel width. Height follows the crest's fixed aspect ratio. */
  size?: number;
  className?: string;
}

// The one production entry point for the approved crest artwork. Tier
// controls silhouette family (via FAMILY_GEOMETRY) and dimple count (via
// TIER_DEFS' subtier); size controls scale only -- one SVG viewBox scaled
// uniformly, so optical centering holds at every size, not just the ones
// spot-checked. Elite has no live subtier yet (TIER_DEFS.elite.subtier is
// null) -- renders as the full/III crest (3 dimples), matching the single
// live Elite tier being the "you've arrived" capstone, not a partial one.
export function ReputationEmblem({ tier, size = 24, className }: ReputationEmblemProps) {
  const { t } = useLocale();
  const family = tierFamily(tier);
  const geometry = FAMILY_GEOMETRY[family];
  const subtier = TIER_DEFS[tier].subtier ?? 3;
  const small = size < 32;
  const showOrnament = Boolean(geometry.ornament) && size >= 32;

  return (
    <svg
      width={size}
      height={size * (74 / 64)}
      viewBox="-8 -5 78 84"
      role="img"
      aria-label={t("reputation.crestAriaLabel", { tier: tierDisplayName(tier, t) })}
      className={className}
    >
      {showOrnament && <OrnamentPaths kind={geometry.ornament} color={geometry.color} deep={geometry.colorDeep} />}
      <path d={geometry.shield} fill={geometry.color} />
      <path d={geometry.shield} fill="none" stroke={geometry.colorDeep} strokeWidth={small ? 1 : 1.4} opacity={0.55} />
      <InsetPaths geometry={geometry} small={small} />
      <FlagGlyph />
      <Dimples count={subtier} small={small} />
    </svg>
  );
}

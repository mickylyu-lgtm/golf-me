// Club head illustrations for Caddie's club picker (ClubPicker.tsx).
// Detailed vector art, not icons (Micky, 2026-11-06: "realistic ... premium,
// not AI"): each head at a 3/4 address angle with its hosel and a short
// piece of shaft, layered metal gradients, a brushed texture on the irons,
// a contact shadow and a thin rim light. One light, from the top left, for
// all five. No brand names, logos or text.
//
// Shared paint lives ONCE in <ClubArtDefs /> (gradients, the brushed-metal
// filter, the head outlines and their clip paths), which ClubPicker renders
// a single time; each club only references it. Dark mode changes the
// shadow and the rim through CSS variables set on the picker
// (--club-shadow, --club-rim), it doesn't invert anything.
//
// Animation hooks: `shine` mounts one specular sweep (animate-club-shine,
// src/index.css), clipped to the head. Decorative only (aria-hidden): the
// card's label names the club.
import type { ReactNode } from "react";

export type ClubArtKind = "driver" | "wood" | "hybrid" | "iron" | "wedge";

// ---- Head outlines (also the clip paths). viewBox 0 0 120 84, ground ~y 76.
const OUTLINE: Record<ClubArtKind, string> = {
  // 460cc pear: deep crown, toe left, heel and hosel right.
  driver:
    "M90 49C91 37 79 22 56 19.5C34 17 9 24 6 41C4.5 53 9 63 17 68.5C30 76 64 76.5 81 71.5C90 68.5 93 59 90 49Z",
  // Smaller and much shallower than the driver.
  wood: "M86 56.5C86.5 47 74 38 54 37C34 36 17 41.5 15.5 53.5C14.5 61 18.5 68.5 25.5 71.5C36 75.5 63 75.5 77 72C85 70 89 64 86 56.5Z",
  // Compact and round, with a deep back and a taller, iron-like face.
  hybrid:
    "M84.5 56C85.5 48 74 42 56 41.5C38 41 24 47 23.5 57.5C23.2 65 25.5 72 31 75C40 78.5 62 78.5 76 74.5C84 72 88 64 84.5 56Z",
  // Cavity-back iron from behind: toe high on the left, top line falling
  // to the heel, a wide sole flange.
  iron: "M24 27C18 28 15 38 15.5 50C16 62 19 71 27 75C33 77.5 42 77.5 50 76.5L82 74.5C87 74 90 70 90 64L90 54C90 51 88.5 49.5 86 49L30 28.5C28 27.6 26 27 24 27Z",
  // Wedge face: tall rounded toe, curved leading edge, high top line.
  wedge:
    "M27.5 33C18 34 12.5 47 14 59.5C15.5 68.5 22 73.8 32.5 74.3L80 72.6C85 72.4 88 69.8 88 65.6L88 58C88 55 86.5 53.4 84 52.8L36 34.6C33 33.4 30.3 32.8 27.5 33Z",
};

// The driver's, wood's and hybrid's face band (the crown is the outline
// above it), the iron's cavity and badge, the wedge's sole.
// Crown/face seams ("top lines"), shared by the face and its highlight.
const DRIVER_TOP = "M6.2 46C18 60 62 63 90.2 51.5";
const WOOD_TOP = "M15.6 54.5C27 64 64 66 86.2 57";
const HYBRID_TOP = "M23.6 55C35 61.5 64 62.5 84.6 55.5";
const DRIVER_FACE = `${DRIVER_TOP}C93 60 90 68.5 81 71.5C64 76.5 30 76 17 68.5C9 63 5 53 6.2 46Z`;
const WOOD_FACE = `${WOOD_TOP}C89 64.5 85 70 77 72C63 75.5 36 75.5 25.5 71.5C18.5 68.5 14.5 61 15.6 54.5Z`;
const HYBRID_FACE = `${HYBRID_TOP}C88 64 84 72 76 74.5C62 78.5 40 78.5 31 75C25.5 72 23.2 65 23.6 55Z`;
const IRON_CAVITY = "M26 36C21.5 42 21.5 57 25.5 63.5C29.5 68 39 69 49 68.5L80 66.6C83 66.3 84.3 63.8 84.3 60.5L84.3 56.5L32.5 36.3C30.3 35.3 28 35.2 26 36Z";
const IRON_BADGE = "M38.5 51.5C38.5 49.3 40.5 48.3 42.8 49L70 56.8C72 57.4 73.3 59 73.3 61L73.3 61.8C73.3 63.6 71.8 64.6 70 64.4L43 62.2C40.5 62 38.5 60.4 38.5 58.2Z";
const WEDGE_SOLE = "M32.5 74.3L80 72.6C85 72.4 88 69.8 88 65.6L89 69C89.3 74.5 86 77.6 80 78L34 79.4C25.5 79.6 18.8 76 16 69.5C20 73 25.5 74.6 32.5 74.3Z";

// Shaft placement (hosel top) and kind per club.
const SHAFT: Record<ClubArtKind, { x: number; y: number; steel: boolean }> = {
  driver: { x: 95.5, y: 32.5, steel: false },
  wood: { x: 91.2, y: 43.2, steel: false },
  hybrid: { x: 90.4, y: 41.2, steel: false },
  iron: { x: 93.8, y: 34, steel: true },
  wedge: { x: 94.4, y: 39, steel: true },
};

const HOSEL: Record<ClubArtKind, string> = {
  driver: "M86.5 47.5L93 32L98 33.6L94.5 48.5C92.5 50.2 88.5 50 86.5 47.5Z",
  wood: "M82.5 56.5L88.8 42.4L93.6 44L89.6 57.5C87.8 59 84.3 58.8 82.5 56.5Z",
  hybrid: "M80 57.5L88 40.4L92.8 42L87 58.6C85 60.2 81.8 60 80 57.5Z",
  iron: "M85 50.5L91.2 33.2L96.4 34.8L92.6 54.4C91.4 56.2 88 56.4 86.2 54.6Z",
  wedge: "M83 53.6L91.8 38.2L97 39.8L92.6 57.4C91.4 59.4 88 59.6 86.4 57.8Z",
};

/** Rendered once per page by ClubPicker. Never display:none (gradients would stop painting in Safari). */
export function ClubArtDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute", overflow: "hidden" }}>
      <defs>
        {(Object.keys(OUTLINE) as ClubArtKind[]).map((k) => (
          <clipPath key={k} id={`ca-clip-${k}`}>
            <path d={OUTLINE[k]} />
          </clipPath>
        ))}
        {/* Contact shadow: colour from --club-shadow (darker in dark mode). */}
        <radialGradient id="ca-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0" style={{ stopColor: "var(--club-shadow)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--club-shadow)", stopOpacity: 0.45 }} />
          <stop offset="1" style={{ stopColor: "var(--club-shadow)", stopOpacity: 0 }} />
        </radialGradient>
        {/* Carbon crown: lit top-left, falling to near black. */}
        <radialGradient id="ca-carbon" cx="32%" cy="18%" r="85%">
          <stop offset="0" stopColor="#5b6472" />
          <stop offset="0.22" stopColor="#2b313b" />
          <stop offset="0.6" stopColor="#11151b" />
          <stop offset="1" stopColor="#050608" />
        </radialGradient>
        <radialGradient id="ca-gunmetal" cx="30%" cy="18%" r="85%">
          <stop offset="0" stopColor="#8b939e" />
          <stop offset="0.25" stopColor="#4a515b" />
          <stop offset="0.65" stopColor="#24282f" />
          <stop offset="1" stopColor="#0d0f12" />
        </radialGradient>
        {/* Crown sheen: a soft specular lobe near the top-left. */}
        <radialGradient id="ca-sheen" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        {/* Woven carbon, barely there. */}
        <pattern id="ca-weave" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
          <rect width="1.2" height="1.2" fill="#ffffff" opacity="0.05" />
          <rect x="1.2" y="1.2" width="1.2" height="1.2" fill="#ffffff" opacity="0.05" />
        </pattern>
        {/* Titanium face: bright at the top edge, darker at the leading edge. */}
        <linearGradient id="ca-titanium" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e6e9ed" />
          <stop offset="0.22" stopColor="#b3bac2" />
          <stop offset="0.6" stopColor="#737c86" />
          <stop offset="1" stopColor="#3f454d" />
        </linearGradient>
        {/* Crown edge falling into shadow away from the light. */}
        <radialGradient id="ca-vignette" cx="38%" cy="30%" r="72%">
          <stop offset="0.55" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.6" />
        </radialGradient>
        <clipPath id="ca-clip-driver-face">
          <path d={DRIVER_FACE} />
        </clipPath>
        <clipPath id="ca-clip-wood-face">
          <path d={WOOD_FACE} />
        </clipPath>
        <clipPath id="ca-clip-hybrid-face">
          <path d={HYBRID_FACE} />
        </clipPath>
        {/* Across a face: toe catches the light, heel falls off. */}
        <linearGradient id="ca-face-x" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.28" />
        </linearGradient>
        {/* Polished chrome (iron): hard specular bands. */}
        <linearGradient id="ca-chrome" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.16" stopColor="#dde2e8" />
          <stop offset="0.38" stopColor="#8f99a5" />
          <stop offset="0.52" stopColor="#f3f5f8" />
          <stop offset="0.7" stopColor="#7d8794" />
          <stop offset="1" stopColor="#3d4550" />
        </linearGradient>
        {/* Recess: darker, lit from below (the upper lip shades it). */}
        <linearGradient id="ca-cavity" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a525d" />
          <stop offset="0.35" stopColor="#7b8591" />
          <stop offset="1" stopColor="#c3c9d0" />
        </linearGradient>
        <linearGradient id="ca-badge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d9dee4" />
          <stop offset="0.5" stopColor="#9aa3ae" />
          <stop offset="1" stopColor="#5f6874" />
        </linearGradient>
        {/* Satin / raw chrome (wedge): softer, wider bands. */}
        <linearGradient id="ca-satin" x1="0" y1="0" x2="1" y2="0.9">
          <stop offset="0" stopColor="#eef0f2" />
          <stop offset="0.3" stopColor="#c4c9cf" />
          <stop offset="0.55" stopColor="#a3aab2" />
          <stop offset="0.75" stopColor="#c9ced3" />
          <stop offset="1" stopColor="#6e7680" />
        </linearGradient>
        <linearGradient id="ca-sole" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7c848e" />
          <stop offset="1" stopColor="#3a4048" />
        </linearGradient>
        {/* Shafts: gradient ACROSS the shaft (userSpaceOnUse in the shaft's own coordinates). */}
        <linearGradient id="ca-graphite" gradientUnits="userSpaceOnUse" x1="-1.5" y1="-0.8" x2="1.5" y2="0.8">
          <stop offset="0" stopColor="#6b7480" />
          <stop offset="0.35" stopColor="#2a3038" />
          <stop offset="1" stopColor="#0c0e11" />
        </linearGradient>
        <linearGradient id="ca-steel" gradientUnits="userSpaceOnUse" x1="-1.5" y1="-0.8" x2="1.5" y2="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.3" stopColor="#c7cdd4" />
          <stop offset="0.65" stopColor="#7a838e" />
          <stop offset="1" stopColor="#3b424b" />
        </linearGradient>
        {/* Shaft from its hosel end (0,0) up and to the right, slightly tapered. */}
        <path id="ca-shaft" d="M-1.06 -0.56L1.06 0.56L17.3 -29.3L14.7 -30.7Z" />
        {/* The specular sweep's band. */}
        <linearGradient id="ca-shine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        {/* Brushed metal: noise stretched along x, as fine streaks. */}
        <filter id="ca-brush" x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.015 1.1" numOctaves="2" seed="7" />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.6 -0.62" />
        </filter>
      </defs>
    </svg>
  );
}

function Art({ kind, width, shine, children }: { kind: ClubArtKind; width: number; shine: boolean; children: ReactNode }) {
  const shaft = SHAFT[kind];
  return (
    <svg width={width} height={(width * 84) / 120} viewBox="0 0 120 84" aria-hidden="true" focusable="false" className="overflow-visible">
      {/* contact shadow */}
      <ellipse cx="52" cy="77.5" rx="44" ry="4.2" fill="url(#ca-shadow)" />
      {/* shaft, then hosel, behind/at the heel */}
      <use href="#ca-shaft" transform={`translate(${shaft.x} ${shaft.y})`} fill={shaft.steel ? "url(#ca-steel)" : "url(#ca-graphite)"} />
      <path d={HOSEL[kind]} fill={shaft.steel ? "url(#ca-chrome)" : "#15181d"} />
      <path d={HOSEL[kind]} fill="none" stroke="#ffffff" strokeWidth="0.5" style={{ strokeOpacity: "calc(var(--club-rim) * 0.5)" }} />
      {children}
      {shine && (
        <g clipPath={`url(#ca-clip-${kind})`}>
          <g transform="skewX(-22)">
            <rect className="animate-club-shine" x="-30" y="0" width="26" height="90" fill="url(#ca-shine)" style={{ mixBlendMode: "screen" }} />
          </g>
        </g>
      )}
    </svg>
  );
}

// Thin rim light along the edge that faces the light (top-left).
function Rim({ d }: { d: string }) {
  return <path d={d} fill="none" stroke="#ffffff" strokeWidth="0.8" strokeLinecap="round" style={{ strokeOpacity: "var(--club-rim)" }} />;
}

function Grooves({ ys, x1, x2, curve = 0, light = "#ffffff", dark = "#2f3640", opacity = 0.55 }: { ys: number[]; x1: number; x2: number; curve?: number; light?: string; dark?: string; opacity?: number }) {
  return (
    <g opacity={opacity}>
      {ys.map((y) => (
        <g key={y}>
          <path d={`M${x1} ${y}Q${(x1 + x2) / 2} ${y + curve} ${x2} ${y - curve * 0.6}`} stroke={dark} strokeWidth="0.7" fill="none" />
          <path d={`M${x1} ${y + 0.7}Q${(x1 + x2) / 2} ${y + 0.7 + curve} ${x2} ${y + 0.7 - curve * 0.6}`} stroke={light} strokeWidth="0.35" fill="none" opacity="0.6" />
        </g>
      ))}
    </g>
  );
}

type ArtProps = { width?: number; shine?: boolean };

// Driver, fairway wood and hybrid share one construction: a painted crown
// (with its sheen and an edge falling into shadow), a metal face band below
// the top line, scoring lines or grooves, and the sole curving under the
// leading edge.
function MetalWood(props: {
  kind: "driver" | "wood" | "hybrid";
  width: number;
  shine: boolean;
  crown: string;
  weave: boolean;
  face: string;
  top: string;
  faceFill: string;
  brushedFace: boolean;
  sheen: { cx: number; cy: number; rx: number; ry: number };
  grooves: { ys: number[]; x1: number; x2: number; opacity: number };
  faceGlint: { cx: number; cy: number; rx: number; ry: number };
  sole: string;
  rim: string;
  backContour?: string;
}) {
  const { kind } = props;
  return (
    <Art kind={kind} width={props.width} shine={props.shine}>
      <path d={OUTLINE[kind]} fill={props.crown} />
      {props.weave && <path d={OUTLINE[kind]} fill="url(#ca-weave)" />}
      <path d={OUTLINE[kind]} fill="url(#ca-vignette)" />
      <ellipse
        cx={props.sheen.cx}
        cy={props.sheen.cy}
        rx={props.sheen.rx}
        ry={props.sheen.ry}
        transform={`rotate(-9 ${props.sheen.cx} ${props.sheen.cy})`}
        fill="url(#ca-sheen)"
      />
      {props.backContour && <path d={props.backContour} fill="none" stroke="#000000" strokeWidth="1.4" opacity="0.3" />}
      <path d={props.face} fill={props.faceFill} />
      <path d={props.face} fill="url(#ca-face-x)" />
      <g clipPath={`url(#ca-clip-${kind}-face)`}>
        {props.brushedFace && <rect width="120" height="84" filter="url(#ca-brush)" opacity="0.3" />}
        <ellipse cx={props.faceGlint.cx} cy={props.faceGlint.cy} rx={props.faceGlint.rx} ry={props.faceGlint.ry} fill="url(#ca-sheen)" opacity="0.8" />
        <Grooves ys={props.grooves.ys} x1={props.grooves.x1} x2={props.grooves.x2} curve={1.2} opacity={props.grooves.opacity} />
      </g>
      <g clipPath={`url(#ca-clip-${kind})`}>
        {/* the top line catches the light; just under it, a thin shadow */}
        <path d={props.top} fill="none" stroke="#ffffff" strokeWidth="0.9" opacity="0.75" transform="translate(0 0.3)" />
        <path d={props.top} fill="none" stroke="#000000" strokeWidth="0.6" opacity="0.35" transform="translate(0 1.4)" />
        <path d={props.sole} fill="#0b0d10" opacity="0.85" />
      </g>
      <path d={OUTLINE[kind]} fill="none" stroke="#000000" strokeWidth="0.6" opacity="0.55" />
      <Rim d={props.rim} />
    </Art>
  );
}

export function DriverArt({ width = 76, shine = false }: ArtProps) {
  return (
    <MetalWood
      kind="driver"
      width={width}
      shine={shine}
      crown="url(#ca-carbon)"
      weave
      face={DRIVER_FACE}
      top={DRIVER_TOP}
      faceFill="url(#ca-titanium)"
      brushedFace={false}
      sheen={{ cx: 36, cy: 29, rx: 23, ry: 7 }}
      grooves={{ ys: [63.5, 66.3, 69.1], x1: 30, x2: 66, opacity: 0.45 }}
      faceGlint={{ cx: 30, cy: 61, rx: 15, ry: 3.2 }}
      sole="M17 68.5C30 76 64 76.5 81 71.5C69 78 32 78.5 17 68.5Z"
      rim="M7.5 39C11 25 32 18.5 56 20.2C70 21.5 82 28 87.5 38"
    />
  );
}

export function WoodArt({ width = 76, shine = false }: ArtProps) {
  return (
    <MetalWood
      kind="wood"
      width={width}
      shine={shine}
      crown="url(#ca-carbon)"
      weave
      face={WOOD_FACE}
      top={WOOD_TOP}
      faceFill="url(#ca-titanium)"
      brushedFace={false}
      sheen={{ cx: 42, cy: 43.5, rx: 18, ry: 4.2 }}
      grooves={{ ys: [67.2, 69.6], x1: 34, x2: 66, opacity: 0.45 }}
      faceGlint={{ cx: 36, cy: 65, rx: 12, ry: 2.4 }}
      sole="M25.5 71.5C36 75.5 63 75.5 77 72C66 77 36 77.5 25.5 71.5Z"
      rim="M17 50C20 41.5 34 36.8 54 37.4C67 37.9 78 41.5 83.8 48"
    />
  );
}

export function HybridArt({ width = 76, shine = false }: ArtProps) {
  return (
    <MetalWood
      kind="hybrid"
      width={width}
      shine={shine}
      crown="url(#ca-gunmetal)"
      weave={false}
      face={HYBRID_FACE}
      top={HYBRID_TOP}
      faceFill="url(#ca-chrome)"
      brushedFace
      sheen={{ cx: 45, cy: 46, rx: 15, ry: 3.6 }}
      grooves={{ ys: [63.4, 66.2, 69, 71.8], x1: 33, x2: 74, opacity: 0.55 }}
      faceGlint={{ cx: 36, cy: 62, rx: 12, ry: 2.6 }}
      sole="M31 75C40 78.5 62 78.5 76 74.5C64 79.5 40 79.6 31 75Z"
      rim="M25 52.5C28 45.5 40 41.8 56 41.8C68 41.8 77 44.2 82.5 49.5"
      backContour="M27.5 54C31 48 42 45 56 45C67.5 45 76.5 47.3 81.5 51.5"
    />
  );
}

export function IronArt({ width = 76, shine = false }: ArtProps) {
  return (
    <Art kind="iron" width={width} shine={shine}>
      <path d={OUTLINE.iron} fill="url(#ca-chrome)" />
      <g clipPath="url(#ca-clip-iron)">
        <rect width="120" height="84" filter="url(#ca-brush)" opacity="0.4" />
        {/* cavity: recessed, its upper lip shading it */}
        <path d={IRON_CAVITY} fill="url(#ca-cavity)" />
        <path d="M26 36C21.5 42 21.5 57 25.5 63.5M32.5 36.3L84.3 56.5" fill="none" stroke="#1f252c" strokeWidth="1.1" opacity="0.6" />
        <path d="M25.6 64C29.5 68.4 39 69.4 49 68.9L80 67C83 66.7 84.6 64.2 84.6 60.9" fill="none" stroke="#ffffff" strokeWidth="0.8" opacity="0.75" />
        {/* blank badge */}
        <path d={IRON_BADGE} fill="url(#ca-badge)" />
        <path d={IRON_BADGE} fill="none" stroke="#ffffff" strokeWidth="0.5" opacity="0.6" />
        {/* thin top line, lit */}
        <path d="M24.4 28.6L85.6 50.6" stroke="#ffffff" strokeWidth="1" opacity="0.85" />
        {/* sole flange underside */}
        <path d="M27 75C33 77.5 42 77.5 50 76.5L82 74.5C87 74 90 70 90 64L88.4 66.6C86.6 70.4 84.4 71.4 80.4 71.8L50 73.6C42 74.2 32.6 73.4 27 75Z" fill="#20262d" opacity="0.4" />
      </g>
      <path d={OUTLINE.iron} fill="none" stroke="#1b2026" strokeWidth="0.6" opacity="0.6" />
      <Rim d="M17 44C17 35 19.5 28.6 24 27.6" />
    </Art>
  );
}

export function WedgeArt({ width = 76, shine = false }: ArtProps) {
  return (
    <Art kind="wedge" width={width} shine={shine}>
      {/* bounce: the sole, seen below the curved leading edge */}
      <path d={WEDGE_SOLE} fill="url(#ca-sole)" />
      {/* the blade's back thickness, showing above a face laid open by loft */}
      <path d="M27.5 33L84 52.8L85.2 50.6L30 30.6C29 30.4 28 31 27.5 33Z" fill="url(#ca-sole)" />
      <path d={OUTLINE.wedge} fill="url(#ca-satin)" />
      <g clipPath="url(#ca-clip-wedge)">
        <rect width="120" height="84" filter="url(#ca-brush)" opacity="0.3" />
        {/* full-face grooves, following the leading edge */}
        <Grooves ys={[44, 47.2, 50.4, 53.6, 56.8, 60, 63.2, 66.4, 69.6]} x1={10} x2={90} curve={0.9} opacity={0.6} />
        {/* heavy top line of a lofted blade */}
        <path d="M27.8 34.4L84 54.4" stroke="#ffffff" strokeWidth="1.3" opacity="0.8" />
        <path d="M28.6 36.2L83.6 56" stroke="#404750" strokeWidth="0.6" opacity="0.45" />
        {/* the leading edge, polished by wear */}
        <path d="M15.5 63C18 70 24 73.6 32.5 74L80 72.3C84 72.1 86.6 70.6 87.6 67.6" fill="none" stroke="#ffffff" strokeWidth="0.8" opacity="0.65" />
      </g>
      <path d={OUTLINE.wedge} fill="none" stroke="#2a3038" strokeWidth="0.6" opacity="0.55" />
      <Rim d="M15 53C16 42 20.5 34.4 27.5 33.6" />
    </Art>
  );
}

export const CLUB_ART: Record<ClubArtKind, (props: ArtProps) => ReactNode> = {
  driver: DriverArt,
  wood: WoodArt,
  hybrid: HybridArt,
  iron: IronArt,
  wedge: WedgeArt,
};

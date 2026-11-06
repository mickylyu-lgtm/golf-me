// Small line-art sketches of each club type for the club picker
// (ClubPicker.tsx). Plain strokes in currentColor, so they follow the text
// colour in light and dark mode. The woods are drawn face-on at address;
// the iron and the wedge from the toe, so their loft difference shows.
// Slightly uneven curves on purpose: a hand-drawn look, not a technical
// drawing. Decorative only (aria-hidden); the card's label names the club.
import type { ReactNode, SVGProps } from "react";

type SketchProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, "viewBox">;

function Sketch({ size = 44, children, ...rest }: SketchProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Big, deep, round head. */
export function DriverSketch(props: SketchProps) {
  return (
    <Sketch {...props}>
      <path d="M41 3.5 L31.5 27.5" />
      <path d="M31.5 27.5 C35.5 29.5 37 35 35 40 C31.5 46 13 46.5 7 41.5 C2.5 37 4.5 30 12 28.3 C18.5 26.8 26.5 26.6 31.5 27.5 Z" />
      <path d="M10.5 33 C16 31.2 24 31 30 32.2" strokeWidth={1.1} opacity={0.55} />
    </Sketch>
  );
}

/** Smaller, flatter head than the driver. */
export function WoodSketch(props: SketchProps) {
  return (
    <Sketch {...props}>
      <path d="M40 4 L31 32.5" />
      <path d="M31 32.5 C34 33.7 34.8 37.6 32.8 40.2 C28.8 43.6 15 43.8 10.2 40.8 C7 38.6 8.4 34.6 14 33.4 C19.5 32.4 26.6 32 31 32.5 Z" />
      <path d="M13 36.5 C18.5 35.4 25 35.2 30 36" strokeWidth={1.1} opacity={0.55} />
    </Sketch>
  );
}

/** Iron-like face with a rounded, hollow-looking back. */
export function HybridSketch(props: SketchProps) {
  return (
    <Sketch {...props}>
      <path d="M39.5 4 L30.5 31" />
      <path d="M30.5 31 C33 32.4 33.6 36.8 32 40.6 C28.4 43.8 16 44 11.4 41.6 C9 40.2 8.6 36.4 10.6 34.4 C15.4 32 24.6 30.6 30.5 31 Z" />
      {/* the rounded back, peeking over the top line */}
      <path d="M12 34 C14.6 29.6 25.4 28.4 30.6 30.8" strokeWidth={1.2} opacity={0.6} strokeDasharray="2.2 2.2" />
    </Sketch>
  );
}

/** Thin blade seen from the toe: little loft. */
export function IronSketch(props: SketchProps) {
  return (
    <Sketch {...props}>
      <path d="M33 3.5 L28.6 27" />
      <path d="M28.6 27 C27.6 32.5 26.4 38 25 43 C27.6 44.4 31.4 44.4 33.2 43.2 C33.4 38.6 32.8 33 31.4 28.4 C30.6 27.4 29.6 27 28.6 27 Z" />
    </Sketch>
  );
}

/** Steep loft from the toe, with grooves on the face and a bounced sole. */
export function WedgeSketch(props: SketchProps) {
  return (
    <Sketch {...props}>
      <path d="M36.5 3.5 L31.4 23.5" />
      <path d="M31.4 23.5 C25.4 29.4 19 35.6 13 41.6 C18 44.4 28.4 45 33.4 43 C34 37 33.6 30 32.6 24.6 C32.2 23.8 31.8 23.6 31.4 23.5 Z" />
      <path d="M26.4 29.6 L28.6 31.4 M22.8 33.2 L25 35 M19.2 36.8 L21.4 38.6" strokeWidth={1.3} />
    </Sketch>
  );
}

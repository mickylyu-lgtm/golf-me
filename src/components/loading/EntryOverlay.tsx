import { useEffect, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { GolfMeIcon } from "../brand/GolfMeIcon";
import type { GolfMeIconPart } from "../brand/GolfMeIcon";
import { ENTRY_BOOT_CLASS, SHOW_ENTRY } from "./entryFlag";
import { getFullScreenLoaderCount, subscribeFullScreenLoaders, usePrefersReducedMotion } from "./loaderState";

// Timeline (ms from the overlay's first paint), on the plain green:
//   0    hole fades in (300ms); top-left ball starts
//   150  top-right ball (with its flag) starts
//   300  bottom-left ball starts
//        each ball: fade + scale 0.85 -> 1 over BALL_MS, damped ease-out,
//        overlapping so the three read as one motion; all in by ~720ms
//   600  gold halo around the hole swells and settles (same halo as before)
// The overlay then fades out over EXIT_MS as soon as the app underneath is
// ready: never held for the halo, never before the last ball has landed.
// If the app is still loading, the halo keeps breathing.
const BALL_MS = 420;
const BALL_STAGGER_MS = 150;
const INTRO_MS = 2 * BALL_STAGGER_MS + BALL_MS;
const EXIT_MS = 350;
// Safety net: never cover the app for longer than this, even if a loader
// never unmounts (e.g. a stuck session restore), so an error screen is seen.
const MAX_HOLD_MS = 8000;

// Geometry of the iOS launch image (ios/App/App/Assets.xcassets/
// Splash.imageset, 2732px square, aspect-fill): the same diagonal gradient
// as the app icon across the whole square, with the mark centered and its
// ball centres 213px from the middle. The current mark's ball centres sit
// 10.1 of 48 units from the middle, so its 48-unit box spans 48 x 213/10.1
// = 1012px, i.e. 37.05% of the square. Rendering the overlay the same way
// (a square of max(width, height), centered) puts the mark where the launch
// image had it, with no size or position jump at the hand-off.
const MARK_FRACTION = 0.3705;

// "Ready" = no fullScreen GolfMeLoader mounted (AppGate's session restore
// and the router's lazy-route fallback both use one), confirmed across two
// animation frames so the hand-off between those two loaders, which happens
// within a single commit, never reads as a gap.
function useAppReady(active: boolean): boolean {
  const loaderCount = useSyncExternalStore(subscribeFullScreenLoaders, getFullScreenLoaderCount);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active || ready || loaderCount > 0) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (getFullScreenLoaderCount() === 0) setReady(true);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, ready, loaderCount]);
  return ready;
}

// The once-per-launch brand entry, behind a per-device test switch (see
// entryFlag.ts). The existing mark (GolfMeIcon's gradient variant, without
// its own background square) on the launch image's full-screen green, its
// balls arriving one after another around the hole. The
// halo is a separate transparent ellipse with only an outer glow, laid over
// the hole's rim: the logo's own geometry and colors are never touched.
// Each ball scales about its own centre (GolfMeIcon's 48-unit box).
function ballPart(cx: number, cy: number, index: number): { className: string; style: CSSProperties } {
  return {
    className: "animate-entry-ball",
    style: { transformBox: "view-box", transformOrigin: `${cx}px ${cy}px`, animationDelay: `${index * BALL_STAGGER_MS}ms` },
  };
}

const ENTRY_PARTS: Partial<Record<GolfMeIconPart, { className: string; style?: CSSProperties }>> = {
  ballTopLeft: ballPart(13.9, 13.9, 0),
  ballTopRight: ballPart(34.1, 13.9, 1),
  ballBottomLeft: ballPart(13.9, 34.1, 2),
  hole: { className: "animate-entry-fade" },
};

export function EntryOverlay() {
  const [phase, setPhase] = useState<"in" | "out" | "done">(SHOW_ENTRY ? "in" : "done");
  const [introDone, setIntroDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const ready = useAppReady(phase === "in");

  useEffect(() => {
    if (phase !== "in") return;
    const intro = setTimeout(() => setIntroDone(true), reducedMotion ? 0 : INTRO_MS);
    const cap = setTimeout(() => setTimedOut(true), MAX_HOLD_MS);
    return () => {
      clearTimeout(intro);
      clearTimeout(cap);
    };
  }, [phase, reducedMotion]);

  useEffect(() => {
    if (phase === "in" && ((ready && introDone) || timedOut)) setPhase("out");
  }, [phase, ready, introDone, timedOut]);

  useEffect(() => {
    if (phase === "out") {
      // The page underneath has its own background again from here on.
      document.documentElement.classList.remove(ENTRY_BOOT_CLASS);
      const timer = setTimeout(() => setPhase("done"), reducedMotion ? 0 : EXIT_MS);
      return () => clearTimeout(timer);
    }
  }, [phase, reducedMotion]);

  if (phase === "done") return null;

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[120] overflow-hidden bg-[#143822] transition-opacity duration-[350ms] ease-out ${
        phase === "out" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: "max(100vw, 100lvh)",
          height: "max(100vw, 100lvh)",
          background: "linear-gradient(135deg, #1b4a2d, #0e2717)",
        }}
      >
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ width: `${MARK_FRACTION * 100}%`, height: `${MARK_FRACTION * 100}%` }}
        >
          <GolfMeIcon
            size={48}
            variant="gradient"
            background={false}
            parts={reducedMotion ? undefined : ENTRY_PARTS}
            className="block h-full w-full"
          />
          {!reducedMotion && (
            // Hole rim in GolfMeIcon's 48-unit box: center (34.1, 34.1),
            // rx 7.8, ry 4.9 -> as percentages of the mark's box.
            <span
              className="animate-entry-halo absolute rounded-[50%]"
              style={{
                left: `${((34.1 - 7.8) / 48) * 100}%`,
                top: `${((34.1 - 4.9) / 48) * 100}%`,
                width: `${((7.8 * 2) / 48) * 100}%`,
                height: `${((4.9 * 2) / 48) * 100}%`,
                boxShadow: "0 0 24px 6px rgba(240, 185, 63, 0.7)",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

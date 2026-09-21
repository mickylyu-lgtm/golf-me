import { useEffect, useRef, useState } from "react";

// Four decorative golfer micro-illustrations for the Caddie processing
// screen, replacing the old single held practice-swing pose (see git
// history for CaddiePracticeSwingIcon.tsx) — approved via a standalone
// preview artifact (readability pass 2) before landing here. Shared
// cap/torso/legs/ground parts stay pixel-identical across all four scenes
// so it reads as the same mascot throughout; only the pose-specific groups
// (bend, arm/club, head tilt, ball) differ per scene. Coordinates sit in a
// 0-64 viewBox — 32 is dead-center on both axes, so every scene's pivot
// points share the same anchor.
//
// This file is purely decorative: it has no knowledge of analysis status,
// never creates/restarts/polls anything, and the rotator below owns only
// its own timers. CaddieThinking.tsx (the only consumer) is what decides
// *whether* to render this at all, based on the real persisted job state.

function CapGlyph() {
  return (
    <>
      <path d="M23 19 C23 14.6 27 11.2 32 11.2 C37 11.2 41 14.6 41 19 Z" fill="white" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={23} cy={19.4} r={1.8} fill="white" stroke="currentColor" strokeWidth={1.8} />
      <circle cx={41} cy={19.4} r={1.8} fill="white" stroke="currentColor" strokeWidth={1.8} />
      <path d="M24.3 17.7 Q32 19.6 39.7 17.7" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
      <text x={32} y={16.2} textAnchor="middle" fontSize={6.2} fontWeight={900} fill="currentColor" fontFamily="system-ui, sans-serif" letterSpacing={-0.3}>
        AI
      </text>
      <rect x={24.5} y={19} width={15} height={10.5} rx={3.6} fill="currentColor" />
      <rect x={27.8} y={22.6} width={2.2} height={3.6} rx={1.1} fill="white" />
      <rect x={34} y={22.6} width={2.2} height={3.6} rx={1.1} fill="white" />
    </>
  );
}

function TorsoGlyph() {
  return <path d="M28 29.5 L26 40 Q26 44 29 44 L35 44 Q38 44 38 40 L36 29.5 Z" fill="currentColor" opacity={0.92} />;
}

function LegsGlyph() {
  return (
    <>
      <line x1={29.5} y1={44} x2={28} y2={52} stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" />
      <line x1={34.5} y1={44} x2={37} y2={52} stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" />
    </>
  );
}

function GroundGlyph() {
  return <line x1={6} y1={55} x2={50} y2={55} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" opacity={0.25} />;
}

function CupGlyph() {
  return (
    <>
      <ellipse cx={52} cy={55} rx={3.2} ry={1.3} fill="#14532d" opacity={0.85} />
      <line x1={52} y1={55} x2={52} y2={45} stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" opacity={0.7} />
      <path d="M52 45 L57 47.2 L52 49.4 Z" fill="currentColor" opacity={0.75} />
    </>
  );
}

function TeeUpScene({ animated }: { animated: boolean }) {
  return (
    <>
      <GroundGlyph />
      <line x1={21} y1={55} x2={21} y2={51} stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" opacity={0.55} />
      <circle cx={21} cy={49.7} r={1.7} fill="currentColor" opacity={0.9} />
      <LegsGlyph />
      <g style={{ transformOrigin: "32px 44px" }} className={animated ? "animate-caddie-teeup-bend" : ""}>
        <CapGlyph />
        <TorsoGlyph />
        <line x1={29} y1={31} x2={20.5} y2={47.5} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
        <circle cx={20.5} cy={47.5} r={1.2} fill="currentColor" />
      </g>
    </>
  );
}

function SwingScene({ animated }: { animated: boolean }) {
  return (
    <>
      <GroundGlyph />
      <circle cx={24} cy={53} r={1.7} fill="currentColor" opacity={0.9} />
      <LegsGlyph />
      <CapGlyph />
      <TorsoGlyph />
      <g style={{ transformOrigin: "32px 29px" }} className={animated ? "animate-caddie-swing-arc" : ""}>
        <line x1={32} y1={29} x2={16.5} y2={52} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
        <line x1={14.5} y1={51.5} x2={19} y2={53.5} stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
      </g>
    </>
  );
}

function PuttLineScene({ animated }: { animated: boolean }) {
  return (
    <>
      <GroundGlyph />
      <CupGlyph />
      <circle cx={24} cy={53.5} r={1.7} fill="currentColor" opacity={0.9} />
      <LegsGlyph />
      <g style={{ transformOrigin: "32px 44px" }} className={animated ? "animate-caddie-puttline-bend" : ""}>
        <g style={{ transformOrigin: "32px 15px" }} className={animated ? "animate-caddie-puttline-glance" : ""}>
          <CapGlyph />
        </g>
        <TorsoGlyph />
        <g className={animated ? "animate-caddie-puttline-putter-arm" : ""}>
          <line x1={30} y1={32} x2={25} y2={52} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          <line x1={25} y1={51.5} x2={22} y2={53.2} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </g>
        <g className={animated ? "animate-caddie-puttline-sight-arm" : "opacity-0"}>
          <line x1={34} y1={32} x2={41} y2={23} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          <circle cx={41} cy={23} r={1.1} fill="currentColor" />
        </g>
      </g>
    </>
  );
}

function PuttScene({ animated }: { animated: boolean }) {
  return (
    <>
      <GroundGlyph />
      <CupGlyph />
      <circle className={animated ? "animate-caddie-ball-roll" : ""} cx={25} cy={53.5} r={1.7} fill="currentColor" />
      <LegsGlyph />
      <CapGlyph />
      <TorsoGlyph />
      <g style={{ transformOrigin: "30px 32px" }} className={animated ? "animate-caddie-putt-stroke" : ""}>
        <line x1={30} y1={32} x2={25} y2={52} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
        <line x1={25} y1={51.5} x2={22} y2={53.2} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      </g>
    </>
  );
}

export type CaddieLoadingSceneKey = "teeup" | "swing" | "puttline" | "putt";
export const CADDIE_LOADING_SCENES: CaddieLoadingSceneKey[] = ["teeup", "swing", "puttline", "putt"];

// PuttLine's sight-arm is only meaningful while animated (it's a crossfade
// keyframe) -- under a static/reduced-motion render it would otherwise
// render at whatever its 0% opacity default happens to be; forcing
// "opacity-0" there keeps the static pose as just the putter-hold, same as
// every other scene's plain rest frame.
function SceneArt({ scene, animated }: { scene: CaddieLoadingSceneKey; animated: boolean }) {
  switch (scene) {
    case "teeup":
      return <TeeUpScene animated={animated} />;
    case "swing":
      return <SwingScene animated={animated} />;
    case "puttline":
      return <PuttLineScene animated={animated} />;
    case "putt":
      return <PuttScene animated={animated} />;
  }
}

function shuffledNoRepeat(prevLast: CaddieLoadingSceneKey | null): CaddieLoadingSceneKey[] {
  const arr = CADDIE_LOADING_SCENES.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (prevLast && arr[0] === prevLast) {
    const swapWith = 1 + Math.floor(Math.random() * (arr.length - 1));
    [arr[0], arr[swapWith]] = [arr[swapWith], arr[0]];
  }
  return arr;
}

// Each scene visible ~10s (within the brief's 8-12s target) before a ~380ms
// crossfade to the next -- both numbers are independent of, and much
// slower than, each scene's own ~4.2-4.6s internal pose loop above.
const SCENE_VISIBLE_MS = 10000;
const CROSSFADE_MS = 380;

export interface CaddieLoadingRotatorProps {
  size?: number;
  /** Caller-supplied (CaddieThinking already runs its own matchMedia check
   * for the status text below this icon) so there's one listener, not two. */
  reducedMotion: boolean;
}

// Purely decorative scene rotator -- owns exactly two timers (the
// scene-advance interval and the crossfade-completion timeout), both
// cleared on every relevant change and on unmount. No analysis/job state
// enters or leaves this component: it neither reads nor could read
// anything about a real Caddie analysis, so there's nothing here that
// could duplicate polling, restart an analysis, or race the real
// persisted-status source of truth in CaddieThinking's parent.
export function CaddieLoadingRotator({ size = 64, reducedMotion }: CaddieLoadingRotatorProps) {
  const [current, setCurrent] = useState<CaddieLoadingSceneKey>("swing");
  const [incoming, setIncoming] = useState<CaddieLoadingSceneKey | null>(null);
  const [incomingVisible, setIncomingVisible] = useState(false);
  const queueRef = useRef<CaddieLoadingSceneKey[]>([]);
  const lastRef = useRef<CaddieLoadingSceneKey>("swing");

  // Owns the scene-advance interval. Reduced motion: no interval at all --
  // a fixed static pose, not just a frozen-looking one, so there's no
  // continuous crossfading regardless of what prefers-reduced-motion's own
  // CSS override would otherwise collapse.
  useEffect(() => {
    if (reducedMotion) return;
    queueRef.current = shuffledNoRepeat(null);
    const first = queueRef.current.shift() ?? "swing";
    setCurrent(first);
    lastRef.current = first;

    const interval = setInterval(() => {
      if (queueRef.current.length === 0) queueRef.current = shuffledNoRepeat(lastRef.current);
      setIncoming(queueRef.current.shift() ?? null);
      setIncomingVisible(false);
    }, SCENE_VISIBLE_MS);

    return () => clearInterval(interval);
  }, [reducedMotion]);

  // Owns the crossfade lifecycle for whichever scene is currently entering:
  // mount it at opacity 0, flip to visible on the next frame (so the CSS
  // transition has a real 0->1 to animate), then finish the swap once the
  // transition duration elapses.
  useEffect(() => {
    if (incoming === null) return;
    const raf = requestAnimationFrame(() => setIncomingVisible(true));
    const done = setTimeout(() => {
      setCurrent(incoming);
      lastRef.current = incoming;
      setIncoming(null);
      setIncomingVisible(false);
    }, CROSSFADE_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [incoming]);

  const sceneToShow = reducedMotion ? "swing" : current;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        role="presentation"
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          opacity: incoming && !reducedMotion ? 0 : 1,
          transition: reducedMotion ? undefined : `opacity ${CROSSFADE_MS}ms ease`,
        }}
      >
        <SceneArt scene={sceneToShow} animated={!reducedMotion} />
      </svg>
      {incoming && !reducedMotion && (
        <svg
          viewBox="0 0 64 64"
          width={size}
          height={size}
          role="presentation"
          aria-hidden="true"
          className="absolute inset-0"
          style={{ opacity: incomingVisible ? 1 : 0, transition: `opacity ${CROSSFADE_MS}ms ease` }}
        >
          <SceneArt scene={incoming} animated />
        </svg>
      )}
    </div>
  );
}

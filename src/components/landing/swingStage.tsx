import { FLOOR_Y } from "./swingRenderer";

// Shared by the landing page's Caddie demo (Interactive.tsx) and the in-app
// Coach Replay demo (components/caddie/CoachReplayDemo.tsx): the dark stage
// the golfer swings on, and the gradients swingRenderer's shapes reference
// by id. Only one of the two is ever on screen at once, so the ids are
// unique per page.

// The stage's static backdrop (spotlight, floor, light pool) — its own SVG
// layer under the animated one, so it is painted once, not every frame.
export function StageBackdrop() {
  return (
    <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <defs>
        <radialGradient id="mq-stage" cx="0.38" cy="0.05" r="0.95">
          <stop offset="0" stopColor="#24432f" />
          <stop offset="0.45" stopColor="#0e1d15" />
          <stop offset="1" stopColor="#050a07" />
        </radialGradient>
        <linearGradient id="mq-cone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.10" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="mq-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#09130e" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#060c09" stopOpacity="0.92" />
          <stop offset="1" stopColor="#040806" stopOpacity="1" />
        </linearGradient>
        <radialGradient id="mq-pool" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.13" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="300" fill="url(#mq-stage)" />
      <path d="M128 -10 L213 -10 L293 250 L48 250 Z" fill="url(#mq-cone)" />
      <ellipse cx="158" cy={FLOOR_Y + 4} rx="110" ry="14" fill="url(#mq-pool)" />
      <rect x="0" y={FLOOR_Y} width="400" height={300 - FLOOR_Y} fill="url(#mq-floor)" />
      <line x1="0" y1={FLOOR_Y} x2="400" y2={FLOOR_Y} stroke="#ffffff" strokeOpacity="0.06" />
    </svg>
  );
}

// Must sit inside the animated layer's own <svg> (swingRenderer's shapes
// point at these ids with url(#...)).
export function SwingFigureDefs() {
  return (
    <>
      <linearGradient id="mq-limb" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.3" stopColor="#eef1ec" />
        <stop offset="0.75" stopColor="#a9b3ad" />
        <stop offset="1" stopColor="#6f7a74" />
      </linearGradient>
      <radialGradient id="mq-ball" cx="0.35" cy="0.3" r="0.75">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.5" stopColor="#e3e7e2" />
        <stop offset="1" stopColor="#7c8781" />
      </radialGradient>
      <radialGradient id="mq-heat" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#f87171" stopOpacity="0.75" />
        <stop offset="0.55" stopColor="#f4b942" stopOpacity="0.25" />
        <stop offset="1" stopColor="#f4b942" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="gm-bone" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#bbf7d0" />
        <stop offset="1" stopColor="#4ade80" />
      </linearGradient>
    </>
  );
}

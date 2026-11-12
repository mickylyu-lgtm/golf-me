import { memo } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./CaddieWaitScene.css";
import type { CaddieProgressStep } from "../../lib/caddieProgress";
import {
  BALL,
  FADE_IN_S,
  FADE_OUT_FROM_S,
  FIGURE_TRANSFORM,
  GROUND_Y,
  HEAD_R,
  IMPACT_S,
  LOOP_S,
  PHASE_TIMES,
  SCENE_H,
  SCENE_W,
  STANCE_X,
  TRACER_D,
  bonesPath,
  clubPath,
  jointsPath,
  skeletonAt,
  smilTrack,
} from "../../lib/caddieSwingLoop";

// What the golfer watches while Caddie works: a face-on swing drawn the way
// Caddie's pose overlay draws a real one (bones as lines, joints as dots),
// on a fairway at dusk, with a shot tracer after impact. The swing is a
// precomputed SMIL loop (src/lib/caddieSwingLoop.ts), so React never
// re-renders it and no JavaScript runs per frame; the stage overlays are
// CSS transform/opacity loops (CaddieWaitScene.css).
//
// `stage` is the step the server last SAVED (caddieProgress), or undefined
// for the demo path, which has no job row. Each step gets its own quiet
// overlay; none of them claims anything about how far along the run is.
// Reduced motion: a still of the finish with the tracer drawn, overlays
// held still.

const CREAM = "#f3efe2";
const GOLD = "#f0b93f";
const GREEN = "#22c55e";

const DUR = `${LOOP_S}s`;
const kt = (s: number) => (s / LOOP_S).toFixed(4);

// Computed once per app load: the keyframe lists for every animated path.
let tracks: { bones: ReturnType<typeof smilTrack>; joints: ReturnType<typeof smilTrack>; club: ReturnType<typeof smilTrack>; head: ReturnType<typeof smilTrack> } | undefined;
function swingTracks() {
  tracks ??= {
    bones: smilTrack(bonesPath),
    joints: smilTrack(jointsPath),
    club: smilTrack(clubPath),
    head: smilTrack((s) => `${(Math.round(s.head.x * 10) / 10).toString()} ${(Math.round(s.head.y * 10) / 10).toString()}`),
  };
  return tracks;
}

const STILL = skeletonAt(4.6);
const FLIGHT_S = 1.6;

function Loop({ attributeName, track }: { attributeName: string; track: { keyTimes: string; values: string } }) {
  return <animate attributeName={attributeName} dur={DUR} repeatCount="indefinite" calcMode="linear" keyTimes={track.keyTimes} values={track.values} />;
}

// A deterministic tree line: many small crowns of varying height, so it
// reads as woods at the end of a hole, not as rolling hills.
function treeLine(base: number, minH: number, maxH: number, seed: number): string {
  const rnd = (i: number) => {
    const v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  let d = `M0 ${base + 12} L0 ${base}`;
  let x = 0;
  let i = 0;
  while (x < SCENE_W) {
    const w = 5 + rnd(i) * 9;
    const h = minH + rnd(i + 100) * (maxH - minH);
    const y = base - h;
    d += ` Q${(x + w / 2).toFixed(1)} ${(y - w * 0.45).toFixed(1)} ${(x + w).toFixed(1)} ${(base - (minH + rnd(i + 200) * (maxH - minH)) * 0.6).toFixed(1)}`;
    x += w;
    i++;
  }
  return `${d} L${SCENE_W} ${base + 12} Z`;
}
const FAR_TREES = treeLine(92, 3, 10, 1);
const NEAR_TREES = treeLine(98, 2, 8, 2);
const HORIZON = 100;

function Backdrop() {
  // Mowing stripes, running away from the golfer toward the horizon.
  const stripes = [];
  const vx = 170;
  const vy = -140;
  const t = (HORIZON - vy) / (SCENE_H - vy);
  for (let i = -8; i <= 8; i += 2) {
    const x0 = vx + i * 40;
    const x1 = vx + (i + 1) * 40;
    stripes.push(
      <path key={i} d={`M${x0} ${SCENE_H} L${x1} ${SCENE_H} L${vx + (x1 - vx) * t} ${HORIZON} L${vx + (x0 - vx) * t} ${HORIZON} Z`} fill="#ffffff" opacity={0.028} />,
    );
  }
  return (
    <>
      <rect width={SCENE_W} height={SCENE_H} fill="url(#gm-wait-sky)" />
      <ellipse cx={220} cy={HORIZON - 6} rx={170} ry={40} fill="url(#gm-wait-glow)" />
      {/* Two layers of trees: the far one lighter, as haze does. */}
      <path d={FAR_TREES} fill="#1a4429" />
      <path d={NEAR_TREES} fill="#0c2415" />
      <rect y={HORIZON} width={SCENE_W} height={SCENE_H - HORIZON} fill="url(#gm-wait-turf)" />
      {stripes}
      <rect y={HORIZON} width={SCENE_W} height={12} fill="url(#gm-wait-horizon)" />
      {/* Vignette, the way a phone lens falls off at the edges. */}
      <rect width={SCENE_W} height={SCENE_H} fill="url(#gm-wait-vignette)" />
    </>
  );
}

function Corners() {
  const c = "M10 22 V10 H22 M298 10 H310 V22 M310 158 V170 H298 M22 170 H10 V158";
  return <path d={c} fill="none" stroke={CREAM} strokeOpacity={0.28} strokeWidth={1.2} strokeLinecap="round" />;
}

function Golfer({ animated, halos }: { animated: boolean; halos: boolean }) {
  const tr = animated ? swingTracks() : undefined;
  const bones = bonesPath(STILL);
  const joints = jointsPath(STILL);
  const club = clubPath(STILL);
  const fade = animated ? (
    <animate attributeName="opacity" dur={DUR} repeatCount="indefinite" keyTimes={`0;${kt(FADE_IN_S)};${kt(FADE_OUT_FROM_S)};1`} values="0;1;1;0" />
  ) : null;
  return (
    <g>
      {fade}
      {/* The figure, in its own units (caddieSwingLoop), scaled into the scene. */}
      <g transform={FIGURE_TRANSFORM}>
        {/* Contact shadow */}
        <ellipse cx={STANCE_X + 2} cy={GROUND_Y + 1} rx={24} ry={2.6} fill="#000000" opacity={0.3} />
        {halos && (
          <path className="gm-wait-halo" d={joints} fill="none" stroke={GREEN} strokeWidth={7.5} strokeLinecap="round">
            {tr && <Loop attributeName="d" track={tr.joints} />}
          </path>
        )}
        {/* Body volume under the skeleton, so it reads as a person. */}
        <path d={bones} fill="none" stroke={CREAM} strokeOpacity={0.09} strokeWidth={7.5} strokeLinecap="round" strokeLinejoin="round">
          {tr && <Loop attributeName="d" track={tr.bones} />}
        </path>
        <path d={bones} fill="none" stroke={CREAM} strokeOpacity={0.92} strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round">
          {tr && <Loop attributeName="d" track={tr.bones} />}
        </path>
        <path d={club} fill="none" stroke={GOLD} strokeWidth={1.2} strokeLinecap="round">
          {tr && <Loop attributeName="d" track={tr.club} />}
        </path>
        <path d={joints} fill="none" stroke={GREEN} strokeWidth={3.6} strokeLinecap="round">
          {tr && <Loop attributeName="d" track={tr.joints} />}
        </path>
        <path d={joints} fill="none" stroke={CREAM} strokeWidth={1.5} strokeLinecap="round">
          {tr && <Loop attributeName="d" track={tr.joints} />}
        </path>
        <g transform={animated ? undefined : `translate(${STILL.head.x} ${STILL.head.y})`}>
          {tr && <animateTransform attributeName="transform" type="translate" dur={DUR} repeatCount="indefinite" calcMode="linear" keyTimes={tr.head.keyTimes} values={tr.head.values} />}
          <circle r={HEAD_R} fill={CREAM} fillOpacity={0.1} stroke={CREAM} strokeOpacity={0.92} strokeWidth={1.35} />
        </g>
        <circle cx={BALL.x} cy={BALL.y} r={BALL.r * 0.8} fill="#ffffff" opacity={animated ? 1 : 0}>
          {animated && <animate attributeName="opacity" dur={DUR} repeatCount="indefinite" calcMode="discrete" keyTimes={`0;${kt(IMPACT_S)}`} values="1;0" />}
        </circle>
      </g>
      {/* The shot and its tracer, in scene units */}
      <path d={TRACER_D} pathLength={1} fill="none" stroke={GOLD} strokeOpacity={0.28} strokeWidth={4.5} strokeLinecap="round" strokeDasharray="1 1" strokeDashoffset={animated ? 1 : 0}>
        {animated && <Tracer />}
      </path>
      <path d={TRACER_D} pathLength={1} fill="none" stroke="url(#gm-wait-tracer)" strokeWidth={1.6} strokeLinecap="round" strokeDasharray="1 1" strokeDashoffset={animated ? 1 : 0}>
        {animated && <Tracer />}
      </path>
      {animated && (
        <circle r={1.8} fill="#ffffff" opacity={0}>
          <animate attributeName="opacity" dur={DUR} repeatCount="indefinite" calcMode="discrete" keyTimes={`0;${kt(IMPACT_S)};${kt(IMPACT_S + FLIGHT_S)}`} values="0;1;0" />
          <animateMotion
            path={TRACER_D}
            dur={DUR}
            repeatCount="indefinite"
            calcMode="spline"
            keyPoints="0;0;1;1"
            keyTimes={`0;${kt(IMPACT_S)};${kt(IMPACT_S + FLIGHT_S)};1`}
            keySplines="0 0 1 1;0.15 0.55 0.35 1;0 0 1 1"
          />
        </circle>
      )}
    </g>
  );
}

function Tracer() {
  return (
    <animate
      attributeName="stroke-dashoffset"
      dur={DUR}
      repeatCount="indefinite"
      calcMode="spline"
      keyTimes={`0;${kt(IMPACT_S)};${kt(IMPACT_S + FLIGHT_S)};1`}
      values="1;1;0;0"
      keySplines="0 0 1 1;0.15 0.55 0.35 1;0 0 1 1"
    />
  );
}

// Every step's overlay sits on one glass card in the lower right, clear of
// the golfer and the ball flight.
const CARD = { x: 184, y: 104, w: 122, h: 54 };

function Card({ children }: { children: ReactNode }) {
  return (
    <g>
      <rect x={CARD.x} y={CARD.y} width={CARD.w} height={CARD.h} rx={7} fill="#06140b" fillOpacity={0.5} stroke={CREAM} strokeOpacity={0.16} />
      <g clipPath="url(#gm-wait-card-clip)">{children}</g>
    </g>
  );
}

/** A tiny copy of the swing at time `t`, standing on (x, groundY). */
function MiniSwing({ t, x, groundY, scale, opacity = 0.75 }: { t: number; x: number; groundY: number; scale: number; opacity?: number }) {
  const s = skeletonAt(t);
  return (
    <g transform={`translate(${x} ${groundY}) scale(${scale}) translate(${-STANCE_X} ${-GROUND_Y})`} opacity={opacity}>
      <path d={bonesPath(s)} fill="none" stroke={CREAM} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
      <path d={clubPath(s)} fill="none" stroke={GOLD} strokeWidth={3} strokeLinecap="round" />
      <circle cx={s.head.x} cy={s.head.y} r={HEAD_R} fill="none" stroke={CREAM} strokeWidth={3.2} />
    </g>
  );
}

const FILM_TIMES = [0.9, 1.4, 1.8, 2.3, 2.75, 2.92, 3.15, 3.6];

/** Preparing: the clip as a filmstrip, ticking past a gold read head. */
function Filmstrip() {
  const frameW = 26;
  const frames = [];
  for (let i = 0; i < 13; i++) {
    const x = CARD.x - 4 + i * frameW;
    frames.push(
      <g key={i}>
        <rect x={x + 2} y={CARD.y + 13} width={frameW - 4} height={28} rx={1.5} fill={CREAM} fillOpacity={0.07} />
        <MiniSwing t={FILM_TIMES[i % FILM_TIMES.length]} x={x + frameW / 2} groundY={CARD.y + 38} scale={0.24} opacity={0.55} />
        {[5, 15].map((dx) => (
          <g key={dx}>
            <rect x={x + dx} y={CARD.y + 7.5} width={4} height={2.4} rx={0.6} fill={CREAM} fillOpacity={0.22} />
            <rect x={x + dx} y={CARD.y + 44} width={4} height={2.4} rx={0.6} fill={CREAM} fillOpacity={0.22} />
          </g>
        ))}
      </g>,
    );
  }
  const headX = CARD.x + 4 + frameW * 2;
  return (
    <Card>
      <g className="gm-wait-film">{frames}</g>
      <rect x={headX} y={CARD.y + 11} width={frameW} height={32} rx={2.5} fill="none" stroke={GOLD} strokeWidth={1.3} />
    </Card>
  );
}

/** Finding body position: a soft band sweeps across the golfer. */
function Scan() {
  return <rect className="gm-wait-scan" x={36} y={0} width={26} height={SCENE_H} fill="url(#gm-wait-scan)" />;
}

/** Getting the swing ready: its four key positions, each lit as the golfer reaches it. */
function KeyPositions({ animated }: { animated: boolean }) {
  const times = [PHASE_TIMES.address, PHASE_TIMES.top, PHASE_TIMES.impact, PHASE_TIMES.finish];
  const w = 25;
  const gap = 4;
  const x0 = CARD.x + (CARD.w - (4 * w + 3 * gap)) / 2;
  return (
    <Card>
      {times.map((t, i) => {
        const x = x0 + i * (w + gap);
        return (
          <g key={t}>
            <rect x={x} y={CARD.y + 8} width={w} height={38} rx={3} fill={CREAM} fillOpacity={0.06} stroke={CREAM} strokeOpacity={0.14} />
            <MiniSwing t={t} x={x + w / 2} groundY={CARD.y + 41} scale={0.3} />
            <rect x={x} y={CARD.y + 8} width={w} height={38} rx={3} fill="none" stroke={GOLD} strokeWidth={1.3} opacity={animated ? 0 : 0.9}>
              {animated && <animate attributeName="opacity" dur={DUR} repeatCount="indefinite" calcMode="discrete" keyTimes={`0;${kt(t)};${kt(FADE_OUT_FROM_S)}`} values="0;1;0" />}
            </rect>
          </g>
        );
      })}
    </Card>
  );
}

/** Writing feedback (and saving it): a note whose lines type in. */
function Note({ saving }: { saving: boolean }) {
  const widths = [92, 80, 88, 52];
  const x = CARD.x + 11;
  return (
    <Card>
      <rect x={x} y={CARD.y + 9} width={18} height={3} rx={1.5} fill={GOLD} />
      {widths.map((w, i) => (
        <rect
          key={i}
          className={saving ? undefined : "gm-wait-line"}
          style={saving ? undefined : ({ "--gm-wait-line-anim": `gm-wait-line-${i + 1}` } as CSSProperties)}
          x={x}
          y={CARD.y + 19 + i * 8}
          width={w}
          height={3}
          rx={1.5}
          fill={CREAM}
          fillOpacity={0.5}
        />
      ))}
      {saving && <rect className="gm-wait-save" x={CARD.x} y={CARD.y + CARD.h - 2.5} width={CARD.w} height={2.5} fill={GOLD} />}
    </Card>
  );
}

function SceneInner({ stage, reducedMotion }: { stage?: CaddieProgressStep; reducedMotion: boolean }) {
  const animated = !reducedMotion;
  return (
    <svg className="gm-wait-scene" viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="gm-wait-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0e2717" />
          <stop offset="0.55" stopColor="#1b4a2d" />
          <stop offset="1" stopColor="#24583a" />
        </linearGradient>
        <radialGradient id="gm-wait-glow">
          <stop offset="0" stopColor={GOLD} stopOpacity={0.13} />
          <stop offset="1" stopColor={GOLD} stopOpacity={0} />
        </radialGradient>
        <linearGradient id="gm-wait-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24603a" />
          <stop offset="1" stopColor="#123a22" />
        </linearGradient>
        <linearGradient id="gm-wait-horizon" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" stopOpacity={0.3} />
          <stop offset="1" stopColor="#000000" stopOpacity={0} />
        </linearGradient>
        <radialGradient id="gm-wait-vignette" cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.6" stopColor="#000000" stopOpacity={0} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.45} />
        </radialGradient>
        <linearGradient id="gm-wait-tracer" gradientUnits="userSpaceOnUse" x1={100} y1={0} x2={SCENE_W} y2={0}>
          <stop offset="0" stopColor={GOLD} stopOpacity={0.35} />
          <stop offset="0.5" stopColor={GOLD} />
          <stop offset="1" stopColor="#fbe3a6" />
        </linearGradient>
        <linearGradient id="gm-wait-scan" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4ade80" stopOpacity={0} />
          <stop offset="0.5" stopColor="#4ade80" stopOpacity={0.22} />
          <stop offset="1" stopColor="#4ade80" stopOpacity={0} />
        </linearGradient>
        <clipPath id="gm-wait-card-clip">
          <rect x={CARD.x} y={CARD.y} width={CARD.w} height={CARD.h} rx={7} />
        </clipPath>
      </defs>
      <Backdrop />
      {stage === "pose" && animated && <Scan />}
      <Golfer animated={animated} halos={stage === "pose"} />
      {stage === "preparing" && <Filmstrip />}
      {stage === "sending" && <KeyPositions animated={animated} />}
      {(stage === "writing" || stage === "saving") && <Note saving={stage === "saving"} />}
      <Corners />
    </svg>
  );
}

export const CaddieWaitScene = memo(SceneInner);

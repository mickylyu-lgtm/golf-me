// Draws the Caddie demo's golfer into an SVG group and animates it, outside
// React. React renders the stage once; this module creates every shape a
// single time and then, on each animation frame, only updates attributes
// (positions, angles, opacity) and re-orders the figure's parts when their
// front-to-back order changes. Re-rendering the whole scene through React
// every frame (dozens of elements diffed, sorted and committed ~60 times a
// second) is what made the swing stutter on phones.
//
// Plain DOM + math, no React, so the same code runs in the browser checks
// in scripts/.

import { samplePose, swingOpacity, SWING_MS, IMPACT_T, BALL, RETURN_MID, TRACE_END_T, JOINT_NAMES } from "./swingMotion";
import type { JointName, Pose, Pt } from "./swingMotion";

const NS = "http://www.w3.org/2000/svg";
export const FLOOR_Y = 246; // scene y of the stage floor
// The rig's figure box -> scene: scaled and placed so the whole club arc
// stays on the 400 x 300 stage with the feet on the floor.
const FIG_S = 1.02;
const FIG_DX = 40;
const FIG_DY = 7;
const FIG_T = `translate(${FIG_DX} ${FIG_DY}) scale(${FIG_S})`;
const toScene = (q: Pt): Pt => [q[0] * FIG_S + FIG_DX, q[1] * FIG_S + FIG_DY];
const LIGHT = [-0.6, -0.8]; // direction the light comes FROM
const BALL_VX = 2000; // ball launch, stage units per second (~28° up): faster
// than the clubhead, as a struck ball is, so it leads the club away
const BALL_VY = 1060;

// ── clubhead trail ──────────────────────────────────────────────────────
// Every clubhead position over one swing, precomputed once with its speed.
// Only the last TRAIL_MS is drawn: a tapered streak that fades out behind
// the clubhead, coloured by clubhead speed (green slow -> coral fastest).
const FAN_STEP = 0.0015; // ~6 ms between samples: a smooth curve
const FAN: { t: number; club: Pt; speed: number }[] = (() => {
  const out: { t: number; club: Pt; speed: number }[] = [];
  let prev: Pt | null = null;
  for (let t = 0; t <= TRACE_END_T; t += FAN_STEP) {
    const p = samplePose(t);
    out.push({ t, club: p.club, speed: prev ? Math.hypot(p.club[0] - prev[0], p.club[1] - prev[1]) : 0 });
    prev = p.club;
  }
  return out;
})();
const FAN_MAX = Math.max(...FAN.map((f) => f.speed)) || 1;
const BAND_COLOURS = ["#4ade80", "#86d36a", "#c4c454", "#f4b942", "#f6935a", "#f87171"];
const speedBand = (v: number) => Math.min(BAND_COLOURS.length - 1, Math.floor((v / FAN_MAX) * BAND_COLOURS.length));
const TRAIL_MS = 340;
const TRAIL_PIECES = 10;

// ── the figure's parts ──────────────────────────────────────────────────
type Key = keyof Pose & string;
type Part =
  | { kind: "cap"; a: Key; b: Key; r: number; bias: number }
  | { kind: "ball"; a: Key; r: number; bias: number }
  | { kind: "torso" }
  | { kind: "pelvis" }
  | { kind: "head" }
  | { kind: "shaft"; i: number }
  | { kind: "clubhead" };
const PARTS: Part[] = [];
for (const s of ["L", "R"] as const) {
  PARTS.push({ kind: "cap", a: `hip${s}`, b: `knee${s}`, r: 9.2, bias: 0 });
  PARTS.push({ kind: "cap", a: `knee${s}`, b: `ank${s}`, r: 7, bias: 0 });
  PARTS.push({ kind: "ball", a: `knee${s}`, r: 7.6, bias: 0.1 });
  PARTS.push({ kind: "cap", a: `ank${s}`, b: `toe${s}`, r: 5, bias: 0.2 });
}
PARTS.push({ kind: "pelvis" }, { kind: "torso" });
PARTS.push({ kind: "cap", a: "shL", b: "shR", r: 7.5, bias: 0.5 });
PARTS.push({ kind: "ball", a: "shL", r: 7.2, bias: 0.6 }, { kind: "ball", a: "shR", r: 7.2, bias: 0.6 });
PARTS.push({ kind: "cap", a: "neck", b: "head", r: 5, bias: 0 }, { kind: "head" });
PARTS.push({ kind: "cap", a: "shR", b: "elR", r: 6.2, bias: 0 }, { kind: "cap", a: "elR", b: "hands", r: 5.2, bias: 0 }, { kind: "ball", a: "elR", r: 5.4, bias: 0.1 });
PARTS.push({ kind: "cap", a: "shL", b: "elL", r: 6.2, bias: 0 }, { kind: "cap", a: "elL", b: "handT", r: 5.2, bias: 0 }, { kind: "ball", a: "elL", r: 5.4, bias: 0.1 });
PARTS.push({ kind: "ball", a: "hands", r: 5.4, bias: 0.3 }, { kind: "ball", a: "handT", r: 5.4, bias: 0.3 });
// the shaft in three pieces, so each sorts at its own depth as it wraps
PARTS.push({ kind: "shaft", i: 0 }, { kind: "shaft", i: 1 }, { kind: "shaft", i: 2 }, { kind: "clubhead" });

const BONES: [JointName, JointName][] = [
  ["head", "neck"], ["neck", "shL"], ["neck", "shR"], ["shL", "elL"], ["elL", "hands"], ["shR", "elR"], ["elR", "hands"],
  ["shL", "hipL"], ["shR", "hipR"], ["hipL", "hipR"], ["hipL", "kneeL"], ["kneeL", "ankL"], ["hipR", "kneeR"], ["kneeR", "ankR"],
];

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
};
const f1 = (n: number) => n.toFixed(2);

// A capsule (rounded limb) from a to b: a rounded bar along +x in its own
// frame, rotated into place; mirrored if needed so it is lit from the
// upper left (one shared gradient, no per-frame gradients).
function setCapsule(r: SVGRectElement, a: Pt, b: Pt, rad: number) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const th = Math.atan2(dy, dx);
  const flip = Math.sin(th) * LIGHT[0] - Math.cos(th) * LIGHT[1] < 0 ? -1 : 1;
  r.setAttribute("width", f1(Math.hypot(dx, dy) + 2 * rad));
  r.setAttribute("transform", `translate(${f1(a[0])} ${f1(a[1])}) rotate(${f1((th * 180) / Math.PI)}) scale(1 ${flip})`);
}

export type SwingHooks = {
  /** what the analysis overlay should show right now */
  overlay: () => { pose: boolean; heat: boolean };
  /** called every frame with the loop position 0..1 */
  onProgress?: (t: number) => void;
  /** test hook: the loop position to draw instead of the clock's */
  at?: () => number | null;
};

/** Builds the scene into `root` and starts animating. Returns a stop function. */
export function mountSwing(root: SVGGElement, hooks: SwingHooks): () => void {
  root.replaceChildren();
  const shadows = [0, 1].map(() => el("ellipse", { cy: FLOOR_Y + 1, rx: 15, ry: 2.6, fill: "#000000" }, root));
  const teeBall = el("circle", { cx: f1(toScene(BALL)[0]), cy: f1(toScene(BALL)[1]), r: 3, fill: "#f8faf8" }, root);
  const streak = el("line", { stroke: "#f8faf8", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-opacity": 0.45 }, root);
  const flight = el("circle", { r: 2.6, fill: "#f8faf8" }, root);
  const fig = el("g", { transform: FIG_T }, root);
  const trail = Array.from({ length: TRAIL_PIECES }, () => el("path", { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, fig));
  const partsG = el("g", {}, fig);
  const heat = el("circle", { r: 30, fill: "url(#mq-heat)", class: "animate-halo-pulse" }, root);
  const overlay = el("g", { transform: FIG_T, class: "animate-fade-in" }, root);
  const boneEls = BONES.map(() => el("line", { stroke: "url(#gm-bone)", "stroke-width": 2, "stroke-linecap": "round", opacity: 0.9 }, overlay));
  const jointEls = JOINT_NAMES.map(() => {
    const g = el("g", {}, overlay);
    el("circle", { r: 5.5, fill: "#f4b942", opacity: 0.18 }, g);
    el("circle", { r: 3.4, fill: "#f4b942" }, g);
    el("circle", { r: 1.4, fill: "#fff7e0" }, g);
    return g;
  });

  // one element per part, created once
  const partEls: SVGElement[] = PARTS.map((p) => {
    switch (p.kind) {
      case "cap":
        return el("rect", { x: -p.r, y: -p.r, height: 2 * p.r, rx: p.r, fill: "url(#mq-limb)" });
      case "pelvis":
        return el("rect", { x: -10, y: -10, height: 20, rx: 10, fill: "url(#mq-limb)" });
      case "torso":
        return el("rect", { x: -13, y: -13, height: 26, rx: 13, fill: "url(#mq-limb)" });
      case "ball":
        return el("circle", { r: p.r, fill: "url(#mq-ball)" });
      case "head":
        return el("ellipse", { rx: 12, ry: 14.5, fill: "url(#mq-ball)" });
      case "shaft":
        return el("line", { stroke: "#d7dcd8", "stroke-width": 2.2, "stroke-linecap": "round" });
      case "clubhead":
        return el("circle", { r: 4.5, fill: "#2a2f2c", stroke: "#9aa39c", "stroke-width": 1 });
    }
  });
  let order: number[] = [];
  const depth = new Array<number>(PARTS.length).fill(0);

  const draw = (t: number) => {
    const J = samplePose(t);
    const z = J.z;
    const op = swingOpacity(t);
    const ov = hooks.overlay();
    // shadows, ball
    [J.ankL, J.ankR].forEach((a, i) => {
      shadows[i].setAttribute("cx", f1(toScene(a)[0]));
      shadows[i].setAttribute("opacity", f1(0.5 * op));
    });
    teeBall.style.display = t < IMPACT_T || t >= RETURN_MID ? "" : "none";
    // Ball flight: launched off the clubface at ~2,260 stage units a second
    // on a rising line (it leaves the stage in about a seventh of a second),
    // with a short streak behind it so it reads as struck, not floating.
    const since = ((t - IMPACT_T) * SWING_MS) / 1000;
    const bx = toScene(BALL)[0] + BALL_VX * since;
    const by = toScene(BALL)[1] - BALL_VY * since;
    const struck = since > 0 && since < 0.4 && bx < 420 && by > -20;
    flight.style.display = struck ? "" : "none";
    streak.style.display = struck ? "" : "none";
    if (struck) {
      const tail = Math.min(since, 0.025);
      flight.setAttribute("cx", f1(bx));
      flight.setAttribute("cy", f1(by));
      streak.setAttribute("x1", f1(bx - BALL_VX * tail));
      streak.setAttribute("y1", f1(by + BALL_VY * tail));
      streak.setAttribute("x2", f1(bx));
      streak.setAttribute("y2", f1(by));
    }
    fig.setAttribute("opacity", f1(op));
    // trail
    const from = t - TRAIL_MS / SWING_MS;
    const pts = t < RETURN_MID ? FAN.filter((f) => f.t > from && f.t <= t) : [];
    for (let k = 0; k < TRAIL_PIECES; k++) {
      const a = Math.floor((k * (pts.length - 1)) / TRAIL_PIECES);
      const b = Math.floor(((k + 1) * (pts.length - 1)) / TRAIL_PIECES);
      const path = trail[k];
      if (pts.length < 2 || b <= a) {
        path.style.display = "none";
        continue;
      }
      const seg = pts.slice(a, b + 1);
      const fresh = Math.max(0, 1 - (t - seg[seg.length - 1].t) / (TRAIL_MS / SWING_MS));
      path.style.display = "";
      path.setAttribute("d", seg.map((f, i) => `${i ? "L" : "M"}${f1(f.club[0])} ${f1(f.club[1])}`).join(""));
      path.setAttribute("stroke", BAND_COLOURS[speedBand(Math.max(...seg.map((f) => f.speed)))]);
      path.setAttribute("stroke-width", f1(0.6 + 2.4 * fresh * fresh));
      path.setAttribute("stroke-opacity", f1(0.9 * fresh * fresh));
    }
    // figure parts: position, then depth
    const chest: Pt = [(J.shL[0] + J.shR[0]) / 2, (J.shL[1] + J.shR[1]) / 2];
    const chestZ = (z.shL + z.shR) / 2;
    PARTS.forEach((p, i) => {
      const e = partEls[i];
      switch (p.kind) {
        case "cap":
          setCapsule(e as SVGRectElement, J[p.a] as Pt, J[p.b] as Pt, p.r);
          depth[i] = (z[p.a] + z[p.b]) / 2 + p.bias;
          break;
        case "pelvis":
          setCapsule(e as SVGRectElement, J.hipL, J.hipR, 10);
          depth[i] = (z.hipL + z.hipR) / 2;
          break;
        case "torso":
          setCapsule(e as SVGRectElement, J.pelvis, [(chest[0] * 3 + J.neck[0]) / 4, (chest[1] * 3 + J.neck[1]) / 4], 13);
          depth[i] = (z.pelvis + chestZ) / 2;
          break;
        case "ball": {
          const c = J[p.a] as Pt;
          e.setAttribute("cx", f1(c[0]));
          e.setAttribute("cy", f1(c[1]));
          depth[i] = z[p.a] + p.bias;
          break;
        }
        case "head": {
          const ang = (Math.atan2(J.head[1] - J.neck[1], J.head[0] - J.neck[0]) * 180) / Math.PI + 90;
          e.setAttribute("cx", f1(J.head[0]));
          e.setAttribute("cy", f1(J.head[1]));
          e.setAttribute("transform", `rotate(${f1(ang)} ${f1(J.head[0])} ${f1(J.head[1])})`);
          depth[i] = z.head + 1;
          break;
        }
        case "shaft": {
          const k0 = p.i / 3;
          const k1 = (p.i + 1) / 3;
          e.setAttribute("x1", f1(J.hands[0] + (J.club[0] - J.hands[0]) * k0));
          e.setAttribute("y1", f1(J.hands[1] + (J.club[1] - J.hands[1]) * k0));
          e.setAttribute("x2", f1(J.hands[0] + (J.club[0] - J.hands[0]) * k1));
          e.setAttribute("y2", f1(J.hands[1] + (J.club[1] - J.hands[1]) * k1));
          depth[i] = z.hands + (z.club - z.hands) * ((k0 + k1) / 2);
          break;
        }
        case "clubhead":
          e.setAttribute("cx", f1(J.club[0]));
          e.setAttribute("cy", f1(J.club[1]));
          depth[i] = z.club;
          break;
      }
    });
    // paint back to front; only touch the DOM order when it changed
    const next = PARTS.map((_, i) => i).sort((a, b) => depth[a] - depth[b]);
    if (next.some((v, i) => v !== order[i])) {
      next.forEach((i) => partsG.appendChild(partEls[i]));
      order = next;
    }
    // analysis overlay
    heat.style.display = ov.heat ? "" : "none";
    if (ov.heat) {
      const hc = toScene([(J.hipL[0] + J.hipR[0]) / 2, (J.hipL[1] + J.hipR[1]) / 2]);
      heat.setAttribute("cx", f1(hc[0]));
      heat.setAttribute("cy", f1(hc[1] - 4));
      heat.setAttribute("opacity", f1(op));
    }
    overlay.style.display = ov.pose ? "" : "none";
    if (ov.pose) {
      overlay.setAttribute("opacity", f1(op));
      BONES.forEach(([a, b], i) => {
        boneEls[i].setAttribute("x1", f1(J[a][0]));
        boneEls[i].setAttribute("y1", f1(J[a][1]));
        boneEls[i].setAttribute("x2", f1(J[b][0]));
        boneEls[i].setAttribute("y2", f1(J[b][1]));
      });
      JOINT_NAMES.forEach((k, i) => jointEls[i].setAttribute("transform", `translate(${f1(J[k][0])} ${f1(J[k][1])})`));
    }
    hooks.onProgress?.(t);
  };

  // The swing loops on the clock; each frame draws the pose for "now", so a
  // slow frame never slows the swing down, it just skips ahead.
  const start = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    draw(hooks.at?.() ?? ((now - start) % SWING_MS) / SWING_MS);
    raf = requestAnimationFrame(tick);
  };
  draw(0);
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

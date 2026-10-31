// Motion for the Caddie demo's golfer: a small 3D skeleton, keyframed in
// joint terms and projected through the website's face-on camera. Pure
// math, no React, so it can be sampled outside the browser.
//
// Why 3D: a golf finish is a 3D pose — the body turns 90°+ to the target,
// the trail arm folds across the chest, the club wraps behind the neck,
// the trail foot rolls onto its toe. A flat 2D rig can only fake that with
// sideways offsets, which read as stiff arms and a club lying across the
// shoulders. Here every part has a real position in space, the camera
// looks straight at the golfer's address position (orthographic), and the
// renderer draws parts back to front by depth, so the club genuinely goes
// behind the neck and the trail arm genuinely crosses in front of the chest.
//
// World axes (golfer-sized units, ~182 tall): X toward the target (screen
// right), Y up, Z toward the camera. The golfer faces the camera at address;
// the ball is in front of the feet (+Z).
//
// The skeleton:
//   * pelvis: position + turn (yaw about Y). Hip joints sit either side.
//   * spine: from the pelvis, bent forward toward the ball and tilted
//     sideways; the shoulders turn (yaw) about it. Spine angle is held
//     through the swing and stands up in the finish, as in a real swing.
//   * arms: shoulder -> elbow -> hand, solved as two-bone limbs (fixed
//     upper-arm and forearm lengths) to reach the hands on the grip, each
//     elbow bending toward its keyed "pole" direction (lead elbow down and
//     out, trail elbow tucked, both folding in the finish).
//   * club: a rigid shaft from the lead hand along the keyed shaft
//     direction; the trail hand sits on the grip just below. The club
//     never leaves the hands.
//   * legs: hip -> knee -> ankle, two-bone solved to the feet, knees
//     bending toward their pole (forward; the lead knee in at the top, the
//     trail knee driving to the target). The lead foot stays planted; the
//     trail foot rolls up onto its toe through the finish.
// Every keyed channel is a smooth cubic over time (velocity continuous,
// at rest at address, the top and the finish), so nothing snaps.

export type JointName =
  | "head" | "neck" | "shL" | "shR" | "elL" | "elR" | "hands"
  | "hipL" | "hipR" | "kneeL" | "kneeR" | "ankL" | "ankR";
export type Pt = readonly [number, number];
/** Projected (screen) positions, plus the extra points and depths the
 *  renderer needs. "L" = trail side (screen left), "R" = lead side. */
export type Pose = Record<JointName, Pt> & {
  club: Pt;
  handT: Pt; // trail hand, just below the lead hand on the grip
  toeL: Pt;
  toeR: Pt;
  pelvis: Pt;
  /** depth toward the camera of every point above (bigger = nearer) */
  z: Record<string, number>;
};

type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.sqrt(dot(a, a));
const norm = (a: V): V => mul(a, 1 / (len(a) || 1));
const RAD = Math.PI / 180;

// ── body measurements ───────────────────────────────────────────────────
const SPINE = 50; // pelvis centre -> base of neck
const NECK = 15; // base of neck -> head centre
const SH_HALF = 17; // half shoulder width
const SH_DROP = 3; // shoulders sit a little below the base of the neck
const HIP_HALF = 9;
const UPPER_ARM = 29;
const FOREARM = 27;
const THIGH = 47;
const SHIN = 45;
const CLUB = 88; // lead hand -> clubhead
const GRIP_GAP = 4; // lead hand -> trail hand along the shaft
const ANKLE_H = 4;

// Feet (ankle, toe). The trail toe is the pivot it rolls onto.
const LEAD_ANKLE: V = [18, ANKLE_H, 0];
const LEAD_TOE: V = [23, 0, 12];
const TRAIL_TOE: V = [-18, 0, 12];
const BALL3: V = [2, 2, 60];

// ── keyframes ───────────────────────────────────────────────────────────
// t: seconds from the start of the takeaway. Angles in degrees.
//   pel: pelvis centre; pYaw: pelvis turn (+ toward the trail side, - open
//   to the target); bend: spine forward bend toward the ball; side: spine
//   side tilt (+ = top of the spine away from the target); sYaw: shoulder
//   turn; grip: lead hand; shaft: lead hand -> clubhead direction; eL/eR:
//   trail/lead elbow pole; kL/kR: trail/lead knee pole; heel: trail heel
//   lift 0..1.
type Key = {
  t: number;
  pel: V;
  pYaw: number;
  bend: number;
  side: number;
  sYaw: number;
  grip: V;
  shaft: V;
  eL: V;
  eR: V;
  kL: V;
  kR: V;
  heel: number;
  rest?: boolean; // momentarily still here (velocity 0)
};
export const KEYS: Key[] = [
  // address (after a real face-on address): standing tall and square,
  // shoulders level, spine bent ~30° toward the ball but straight in the
  // front view (2° side tilt — more read as the whole body leaning), hands
  // on the body's centreline, shaft hanging straight down to the ball
  { t: 0, rest: true, pel: [0, 91, -7], pYaw: 0, bend: 30, side: 2, sYaw: -4, grip: [0, 86, 35], shaft: [0, -1, 0], eL: [-0.6, -0.5, -0.6], eR: [0.6, -0.5, -0.4], kL: [0, 0, 1], kR: [0, 0, 1], heel: 0 },
  // takeaway: club low and wide, toward the trail side
  { t: 0.24, pel: [-1, 91, -7], pYaw: 10, bend: 31, side: 3, sYaw: 24, grip: [-13, 87, 37], shaft: [-0.72, -0.6, 0.35], eL: [-0.4, -0.7, -0.6], eR: [0.4, -0.7, -0.6], kL: [0, 0, 1], kR: [-0.2, 0, 1], heel: 0 },
  // hip high: shaft parallel to the ground, pointing away from the target
  { t: 0.45, pel: [-2, 91, -7], pYaw: 22, bend: 31, side: 4, sYaw: 52, grip: [-32, 90, 31], shaft: [-0.95, 0.12, 0.28], eL: [-0.2, -0.8, -0.6], eR: [0.2, -0.8, 0.5], kL: [0, 0, 1], kR: [-0.35, 0, 1], heel: 0 },
  // lead arm parallel: wrists set, shaft pointing up
  { t: 0.66, pel: [-3, 91, -7], pYaw: 36, bend: 32, side: 5, sYaw: 75, grip: [-57, 125, 19], shaft: [-0.25, 0.96, 0.1], eL: [-0.1, -1, -0.3], eR: [0.3, -0.6, 0.7], kL: [0, 0, 1], kR: [-0.5, 0, 1], heel: 0 },
  // top: hips ~45°, shoulders ~90°, hands high over the trail shoulder,
  // shaft parallel to the ground pointing at the target
  { t: 0.9, rest: true, pel: [-4, 91, -7], pYaw: 45, bend: 32, side: 5, sYaw: 92, grip: [-38, 162, 11], shaft: [0.92, 0.05, -0.38], eL: [0, -1, 0.1], eR: [0.2, -0.5, 0.8], kL: [0, 0, 1], kR: [-0.6, 0, 1], heel: 0 },
  // transition: hips start to the target first, arms drop, lag held
  { t: 1.02, pel: [0, 90, -7], pYaw: 22, bend: 31, side: 5, sYaw: 72, grip: [-53, 135, 21], shaft: [0.25, 0.95, -0.2], eL: [0.1, -1, 0.3], eR: [0.2, -0.6, 0.8], kL: [0.2, 0, 1], kR: [-0.3, 0, 1], heel: 0 },
  // hip high in the downswing: lag, shaft still pointing up behind the hands
  { t: 1.13, pel: [4, 90, -7], pYaw: -12, bend: 32, side: 6, sYaw: 34, grip: [-27, 85, 41], shaft: [-0.55, 0.78, 0.3], eL: [0.2, -1, 0.3], eR: [0.3, -0.7, 0.6], kL: [0.5, 0, 1], kR: [0, 0, 1], heel: 0.05 },
  // release
  { t: 1.185, pel: [6, 90, -7], pYaw: -26, bend: 31, side: 6, sYaw: 8, grip: [-1, 85, 41], shaft: [-0.72, -0.4, 0.57], eL: [0.2, -1, 0.3], eR: [0.4, -0.8, 0.4], kL: [0.6, 0, 1], kR: [0, 0, 1], heel: 0.1 },
  // impact: hands ahead of the ball, hips open ~35°, shoulders square,
  // trail shoulder down, weight moving onto the lead side
  { t: 1.22, pel: [7, 90, -7], pYaw: -35, bend: 31, side: 6, sYaw: -10, grip: [9, 82, 25], shaft: [0, -1, 0], eL: [0.3, -1, 0.2], eR: [0.6, -0.6, 0.3], kL: [0.7, 0, 1], kR: [0.1, 0, 1], heel: 0.15 },
  // just after the ball: club chasing low toward the target
  { t: 1.27, pel: [9, 90, -7], pYaw: -48, bend: 30, side: 6, sYaw: -22, grip: [19, 94, 38], shaft: [0.62, -0.6, 0.5], eL: [0.4, -1, 0.2], eR: [0.6, -0.6, -0.2], kL: [0.8, 0, 0.8], kR: [0.1, 0, 1], heel: 0.25 },
  // both arms extended: shaft parallel to the ground pointing at the target
  { t: 1.33, pel: [11, 91, -7], pYaw: -62, bend: 28, side: 5, sYaw: -48, grip: [35, 101, 33], shaft: [0.97, 0.12, 0.2], eL: [0.4, -1, 0.3], eR: [0.4, -0.5, -0.8], kL: [0.9, 0, 0.6], kR: [0.1, 0, 1], heel: 0.4 },
  // three-quarter: shaft vertical, trail arm crossing over
  { t: 1.45, pel: [13, 92, -7], pYaw: -80, bend: 18, side: 3, sYaw: -78, grip: [34, 140, 24], shaft: [0.08, 0.99, -0.15], eL: [0.3, -0.9, 0.4], eR: [0.1, -0.9, -0.4], kL: [1, 0, 0.5], kR: [0.1, 0, 1], heel: 0.7 },
  // wrapping: hands rising over the lead shoulder, club falling behind
  { t: 1.58, pel: [14, 93, -7], pYaw: -90, bend: 10, side: 1, sYaw: -98, grip: [27, 155, 4], shaft: [-0.55, 0.62, -0.56], eL: [0.3, -0.85, 0.45], eR: [-0.1, -0.9, -0.4], kL: [1, 0, 0.4], kR: [0.1, 0, 1], heel: 0.9 },
  // finish: chest past the target, standing tall over a straight lead leg,
  // trail foot up on its toe, hands high beside the head, elbows tucked,
  // club wrapped behind the neck and lead shoulder, pointing down and back
  { t: 1.72, rest: true, pel: [14, 94, -7], pYaw: -95, bend: 6, side: 0, sYaw: -110, grip: [22, 158, -12], shaft: [-0.72, -0.45, -0.53], eL: [0.25, -0.85, 0.45], eR: [-0.2, -0.9, -0.35], kL: [1, 0, 0.4], kR: [0.1, 0, 1], heel: 1 },
];
// Address and impact shafts point exactly at the ball.
for (const k of KEYS) if (k.t === 0 || k.t === 1.22) k.shaft = norm(sub(BALL3, k.grip));
const TOP_KEY = 0.9;
const IMPACT_KEY = 1.22;
const FINISH_KEY = 1.72;

// ── timeline ────────────────────────────────────────────────────────────
const ADDRESS_HOLD = 0.5;
const SWING_S = KEYS[KEYS.length - 1].t;
const FINISH_HOLD = 1.2; // long enough to recognise the finish
const RETURN = 0.5;
export const SWING_MS = Math.round((ADDRESS_HOLD + SWING_S + FINISH_HOLD + RETURN) * 1000);
const DUR = SWING_MS / 1000;
const toU = (sec: number) => (ADDRESS_HOLD + sec) / DUR;
export const TOP_T = toU(TOP_KEY);
export const IMPACT_T = toU(IMPACT_KEY);
export const FINISH_T = toU(FINISH_KEY);
export const TRACE_END_T = FINISH_T;

// Smooth cubic through the keys (Hermite with finite-difference slopes;
// zero slope at "rest" keys and where a channel turns round), applied to
// every scalar channel.
const TS = KEYS.map((k) => k.t);
function curve(vals: number[]): (sec: number) => number {
  const n = vals.length;
  const m = vals.map((v, i) => {
    if (KEYS[i].rest || i === 0 || i === n - 1) return 0;
    const d0 = (v - vals[i - 1]) / (TS[i] - TS[i - 1]);
    const d1 = (vals[i + 1] - v) / (TS[i + 1] - TS[i]);
    return d0 * d1 <= 0 ? 0 : (d0 + d1) / 2;
  });
  return (sec) => {
    if (sec <= TS[0]) return vals[0];
    if (sec >= TS[n - 1]) return vals[n - 1];
    let i = 0;
    while (sec > TS[i + 1]) i++;
    const h = TS[i + 1] - TS[i];
    const x = (sec - TS[i]) / h;
    const x2 = x * x;
    const x3 = x2 * x;
    return (2 * x3 - 3 * x2 + 1) * vals[i] + (x3 - 2 * x2 + x) * h * m[i] + (-2 * x3 + 3 * x2) * vals[i + 1] + (x3 - x2) * h * m[i + 1];
  };
}
const vecCurve = (get: (k: Key) => V) => {
  const c = [0, 1, 2].map((j) => curve(KEYS.map((k) => get(k)[j])));
  return (sec: number): V => [c[0](sec), c[1](sec), c[2](sec)];
};
const RAWC = {
  pel: vecCurve((k) => k.pel),
  pYaw: curve(KEYS.map((k) => k.pYaw)),
  bend: curve(KEYS.map((k) => k.bend)),
  side: curve(KEYS.map((k) => k.side)),
  sYaw: curve(KEYS.map((k) => k.sYaw)),
  grip: vecCurve((k) => k.grip),
  shaft: vecCurve((k) => norm(k.shaft)),
  eL: vecCurve((k) => k.eL),
  eR: vecCurve((k) => k.eR),
  kL: vecCurve((k) => k.kL),
  kR: vecCurve((k) => k.kR),
  heel: curve(KEYS.map((k) => k.heel)),
};
type ChName = keyof typeof RAWC;
const CH_NAMES = Object.keys(RAWC) as ChName[];
const flat = (sec: number): number[] => CH_NAMES.flatMap((n) => {
  const v = RAWC[n](sec);
  return typeof v === "number" ? [v] : v;
});

type Channels = { pel: V; pYaw: number; bend: number; side: number; sYaw: number; grip: V; shaft: V; eL: V; eR: V; kL: V; kR: V; heel: number };
function unpack(row: number[]): Channels {
  let j = 0;
  const take = (n: number) => row.slice(j, (j += n));
  const one = () => take(1)[0];
  const three = () => take(3) as V;
  return { pel: three(), pYaw: one(), bend: one(), side: one(), sYaw: one(), grip: three(), shaft: three(), eL: three(), eR: three(), kL: three(), kR: three(), heel: one() };
}
function channelsAt(sec: number): Channels {
  const x = Math.min(BAKE_N - 1, Math.max(0, sec * RATE));
  const i = Math.min(BAKE_N - 2, Math.floor(x));
  const f = x - i;
  return unpack(BAKED[i].map((a, c) => a + (BAKED[i + 1][c] - a) * f));
}

// ── solving ─────────────────────────────────────────────────────────────
// Two-bone limb from root A to end B with segment lengths a, b, the middle
// joint bending toward `pole`. If B is out of reach the limb straightens
// and stretches just enough to keep the hand on the club (the keys are set
// so this stays within a few percent; scripts check it).
function twoBone(A: V, B: V, a: number, b: number, pole: V): V {
  const d = sub(B, A);
  const dist = len(d) || 1e-6;
  const u = mul(d, 1 / dist);
  const k = Math.max(1, dist / (a + b - 1e-3));
  const aa = a * k;
  const bb = b * k;
  const x = (aa * aa - bb * bb + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, aa * aa - x * x));
  let v = sub(pole, mul(u, dot(pole, u)));
  if (len(v) < 1e-6) v = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return add(add(A, mul(u, x)), mul(norm(v), h));
}
const yawDir = (deg: number): V => [Math.cos(deg * RAD), 0, Math.sin(deg * RAD)]; // trail -> lead

export type Pose3 = Record<string, V>;
// The skeleton solved from one set of channel values.
function solve(C: Channels): Pose3 {
  const pel = C.pel;
  // pelvis turn: the hip line rotates about Y
  const hipDir = yawDir(C.pYaw);
  const hipR = add(pel, mul(hipDir, HIP_HALF));
  const hipL = add(pel, mul(hipDir, -HIP_HALF));
  // spine: bent toward the ball (+Z), tilted sideways (+ = away from target)
  const bend = C.bend * RAD;
  const side = C.side * RAD;
  const up = norm([-Math.sin(side), Math.cos(bend) * Math.cos(side), Math.sin(bend) * Math.cos(side)]);
  const neck = add(pel, mul(up, SPINE));
  const head = add(neck, mul(up, NECK));
  // shoulders turn about the spine
  let shDir = yawDir(C.sYaw);
  shDir = norm(sub(shDir, mul(up, dot(shDir, up))));
  const shBase = sub(neck, mul(up, SH_DROP));
  const shR = add(shBase, mul(shDir, SH_HALF));
  const shL = add(shBase, mul(shDir, -SH_HALF));
  // hands on the club; the club is rigid from the lead hand
  const grip = C.grip;
  const shaft = norm(C.shaft);
  const handT = add(grip, mul(shaft, GRIP_GAP));
  const club = add(grip, mul(shaft, CLUB));
  const elR = twoBone(shR, grip, UPPER_ARM, FOREARM, norm(C.eR));
  const elL = twoBone(shL, handT, UPPER_ARM, FOREARM, norm(C.eL));
  // feet: lead planted; trail rolls up onto its toe and turns to the target
  const heel = Math.min(1, Math.max(0, C.heel));
  const pitch = heel * 72 * RAD;
  const turn = heel * 80 * RAD;
  const back: V = [0, ANKLE_H * Math.cos(pitch) + 12 * Math.sin(pitch), -12 * Math.cos(pitch) + ANKLE_H * Math.sin(pitch)];
  const backT: V = [back[2] * Math.sin(turn), back[1], back[2] * Math.cos(turn)];
  const ankL = add(TRAIL_TOE, backT);
  const kneeL = twoBone(hipL, ankL, THIGH, SHIN, norm(C.kL));
  const kneeR = twoBone(hipR, LEAD_ANKLE, THIGH, SHIN, norm(C.kR));
  return { head, neck, shL, shR, elL, elR, hands: grip, handT, hipL, hipR, kneeL, kneeR, ankL, ankR: LEAD_ANKLE, toeL: TRAIL_TOE, toeR: LEAD_TOE, pelvis: pel, club };
}
// Smoothing: hand-placed keys space speed a little unevenly from key to
// key, which reads as jerky. Every channel is baked at 240 samples a
// second and smoothed over time with a Gaussian — 45 ms through the slow
// parts, 10 ms around impact so the strike stays sharp and on the ball.
// Address, the top and the finish are rests, so they stay put.
const RATE = 240;
const BAKE_N = Math.ceil(SWING_S * RATE) + 1;
const BAKED: number[][] = (() => {
  const keyed = Array.from({ length: BAKE_N }, (_, i) => flat(i / RATE));
  // Re-time each phase by distance travelled (hands + 0.3 x clubhead, in
  // 3D), so the speed rises and falls along one curve per phase instead of
  // key to key: an even backswing settling at the top, constant
  // acceleration to the ball, then a follow-through that leaves the ball at
  // that speed and slows into the finish. All channels share the new clock,
  // so the body stays in step with the arms.
  const poses = keyed.map((r) => solve(unpack(r)));
  const step = (i: number) => (i ? len(sub(poses[i].hands, poses[i - 1].hands)) + 0.3 * len(sub(poses[i].club, poses[i - 1].club)) : 0);
  const raw = keyed.map((r) => r.slice());
  const travel = (i0: number, i1: number) => {
    const cum = [0];
    for (let i = i0 + 1; i <= i1; i++) cum.push(cum[cum.length - 1] + step(i));
    return cum;
  };
  const retime = (i0: number, i1: number, ease: (x: number) => number) => {
    const cum = travel(i0, i1);
    const total = cum[cum.length - 1];
    let j = 0;
    for (let i = i0; i <= i1; i++) {
      const target = ease((i - i0) / (i1 - i0)) * total;
      while (j < cum.length - 2 && cum[j + 1] < target) j++;
      const f = cum[j + 1] > cum[j] ? Math.min(1, Math.max(0, (target - cum[j]) / (cum[j + 1] - cum[j]))) : 0;
      raw[i] = keyed[i0 + j].map((a, c) => a + (keyed[i0 + j + 1][c] - a) * f);
    }
    return total;
  };
  const [iTop, iImp, iEnd] = [Math.round(TOP_KEY * RATE), Math.round(IMPACT_KEY * RATE), BAKE_N - 1];
  // Speed shapes (as velocity profiles, integrated into easing curves):
  //   backswing  — sin(πx)^0.6: a smooth start, a long steady middle, and
  //                it only slows right at the top;
  //   downswing  — x^0.7: picks up speed straight away and keeps
  //                accelerating to the ball (x^1 or x^2 hung at the top:
  //                with a full stop on both sides the hands sat almost
  //                still for ~450 ms, which read as lag);
  //   through    — leaves the ball at the downswing's speed and bleeds it
  //                off into the finish.
  const easeFrom = (v: (x: number) => number) => {
    const n = 2000;
    const cum = [0];
    for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + v((i - 0.5) / n));
    return (x: number) => {
      const f = Math.min(n, Math.max(0, x * n));
      const i = Math.min(n - 1, Math.floor(f));
      return (cum[i] + (cum[i + 1] - cum[i]) * (f - i)) / cum[n];
    };
  };
  retime(0, iTop, easeFrom((x) => Math.sin(Math.PI * x) ** 0.6));
  const DOWN_POW = 0.7;
  const down = retime(iTop, iImp, easeFrom((x) => x ** DOWN_POW));
  const thru = travel(iImp, iEnd);
  // speed at the ball = (1 + DOWN_POW) x average downswing speed; the
  // follow-through 1 - (1 - x)^k starts at k x its average speed
  const k = Math.min(4, Math.max(1.5, ((1 + DOWN_POW) * down * (iEnd - iImp)) / ((iImp - iTop) * thru[thru.length - 1])));
  retime(iImp, iEnd, (x) => 1 - (1 - x) ** k);
  return raw.map((row, i) => {
    const sigma = 0.01 + 0.035 * Math.min(1, Math.max(0, (Math.abs(i / RATE - IMPACT_KEY) - 0.03) / 0.12));
    const span = Math.ceil(3 * sigma * RATE);
    return row.map((_, c) => {
      let acc = 0;
      let w = 0;
      for (let k = -span; k <= span; k++) {
        const wk = Math.exp(-0.5 * (k / (sigma * RATE)) ** 2);
        acc += wk * raw[Math.min(BAKE_N - 1, Math.max(0, i + k))][c];
        w += wk;
      }
      return acc / w;
    });
  });
})();
/** The full 3D pose at `sec` seconds into the swing (0 = takeaway). */
export function pose3(sec: number): Pose3 {
  return solve(channelsAt(sec));
}
export const LIMITS = { UPPER_ARM, FOREARM, THIGH, SHIN };

// ── camera ──────────────────────────────────────────────────────────────
// Face-on, orthographic, level: the address position fills the figure's
// 200 x 260 box with the ground at y 232.
const X0 = 95;
const GROUND = 232;
const project = (p: V): Pt => [X0 + p[0], GROUND - p[1]];

// The loop ends like a video clip: hold the finish, fade out, snap to
// address while invisible, fade back in.
const RETURN_START = (ADDRESS_HOLD + SWING_S + FINISH_HOLD) / DUR;
export const RETURN_MID = RETURN_START + (1 - RETURN_START) / 2;
export function swingOpacity(t: number): number {
  const u = ((t % 1) + 1) % 1;
  if (u < RETURN_START) return 1;
  const k = (u - RETURN_START) / (1 - RETURN_START);
  return Math.abs(1 - 2 * k);
}
/** Seconds into the swing (0 = takeaway) for a loop position t. */
export function swingSec(t: number): number {
  const u0 = ((t % 1) + 1) % 1;
  const u = u0 < RETURN_START ? u0 : u0 < RETURN_MID ? RETURN_START : 0;
  return Math.min(SWING_S, Math.max(0, u * DUR - ADDRESS_HOLD));
}

export function samplePose(t: number): Pose {
  const p = pose3(swingSec(t));
  const out: Record<string, unknown> = {};
  const z: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) {
    out[k] = project(v);
    z[k] = v[2];
  }
  out.z = z;
  return out as Pose;
}

export const BALL: Pt = project(BALL3);
export const TOP_POSE = samplePose(TOP_T);
export const JOINT_NAMES: JointName[] = ["head", "neck", "shL", "shR", "elL", "elR", "hands", "hipL", "hipR", "kneeL", "kneeR", "ankL", "ankR"];

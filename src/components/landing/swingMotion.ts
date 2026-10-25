// Motion for the Caddie demo's illustrated golfer. Pure math, no React, so
// it can be sampled outside the browser (scripts/ checks render it to a
// contact sheet).
//
// The figure is a RIG, not a set of traced points. Hand-tracing a video
// gives joints that wobble a few pixels frame to frame, limbs that change
// length and feet that slide; pulling every joint toward those points made
// the figure look like it was moving everywhere. Instead, the traced swing
// only drives the big, meaningful motions —
//   hip centre (slide/squat), hip line (width = turn, tilt), spine angle,
//   head angle, shoulder line (width = turn, tilt), the hands' path around
//   the chest, the club angle, and the trail foot's pivot —
// and the rest is solved so it can't drift:
//   * the spine, neck->head and club have fixed lengths;
//   * the lead foot is planted; the trail foot only pivots onto its toe;
//   * knees and elbows are described RELATIVE TO THEIR LIMB — how far
//     along hip->ankle / shoulder->hands they sit, plus a small sideways
//     offset (smoothed and capped). This is a face-on view of a 3D swing:
//     a flexing knee or folding arm mostly bends toward the camera, so in
//     2D the limb looks shorter rather than bent sideways. (Fixed 2D bone
//     lengths with IK pushed knees into an X and splayed the elbows.)
//     The offsets are continuous numbers, so a joint can never flip sides.
// All channels share one timeline (see warp/spline), so the body moves
// as one piece.

export type JointName =
  | "head" | "neck" | "shL" | "shR" | "elL" | "elR" | "hands"
  | "hipL" | "hipR" | "kneeL" | "kneeR" | "ankL" | "ankR";
export type Pt = readonly [number, number];
export type Pose = Record<JointName, Pt> & { club: Pt };

const P = (o: Record<string, [number, number]>) => o as unknown as Pose;

// [key index, pose]: joints read off a reference face-on swing animation
// (target to the viewer's right), sampled every 1/8 s of the clip, in that
// clip's pixels; M() maps them into the figure's 200 x 260 box with the
// ankles on the ground at y 232. Key 4 is address; 13.6 is impact (clubhead
// on the ball, hands a touch ahead). The top (9-10) and the finish (19-22)
// follow Tiger Woods' face-on driver swing instead: hands high with the
// shaft parallel at the top; through the finish the hands carry high over
// the head to the trail side and the club drops across the back toward the
// target.
const M = (x: number, y: number): [number, number] => [95 + (x - 295) * 0.426, 232 + (y - 605) * 0.426];
type Raw = Record<JointName | "club", [number, number]>;
const R = (o: Raw) => {
  const out: Record<string, [number, number]> = {};
  for (const k of Object.keys(o) as (keyof Raw)[]) out[k] = M(o[k][0], o[k][1]);
  return out as unknown as Pose;
};
const KEYS: [number, Pose][] = [
  [4, R({ head: [275, 207], neck: [278, 245], shL: [240, 255], shR: [325, 255], elL: [248, 330], elR: [318, 330], hands: [290, 405], hipL: [260, 360], hipR: [325, 360], kneeL: [245, 465], kneeR: [340, 465], ankL: [235, 600], ankR: [355, 600], club: [290, 612] })],
  [5, R({ head: [273, 210], neck: [278, 247], shL: [237, 258], shR: [328, 252], elL: [240, 335], elR: [295, 330], hands: [258, 410], hipL: [258, 360], hipR: [327, 360], kneeL: [245, 465], kneeR: [342, 465], ankL: [235, 600], ankR: [355, 600], club: [95, 545] })],
  [6, R({ head: [273, 213], neck: [275, 248], shL: [225, 242], shR: [325, 262], elL: [212, 318], elR: [260, 325], hands: [190, 385], hipL: [255, 360], hipR: [330, 360], kneeL: [245, 465], kneeR: [352, 462], ankL: [235, 600], ankR: [355, 600], club: [0, 372] })],
  [7, R({ head: [275, 213], neck: [275, 250], shL: [235, 247], shR: [310, 265], elL: [188, 292], elR: [222, 300], hands: [140, 320], hipL: [255, 362], hipR: [328, 362], kneeL: [245, 465], kneeR: [345, 470], ankL: [235, 600], ankR: [355, 600], club: [30, 130] })],
  [8, R({ head: [270, 212], neck: [272, 250], shL: [230, 248], shR: [305, 263], elL: [195, 280], elR: [220, 272], hands: [140, 265], hipL: [255, 364], hipR: [327, 364], kneeL: [240, 465], kneeR: [337, 480], ankL: [235, 601], ankR: [355, 601], club: [150, 55] })],
  [9, R({ head: [270, 212], neck: [270, 250], shL: [225, 250], shR: [300, 262], elL: [215, 235], elR: [240, 215], hands: [180, 160], hipL: [255, 365], hipR: [325, 365], kneeL: [240, 465], kneeR: [330, 488], ankL: [235, 602], ankR: [355, 602], club: [359, 57] })],
  [10, R({ head: [275, 213], neck: [275, 252], shL: [230, 255], shR: [305, 265], elL: [225, 230], elR: [250, 205], hands: [195, 145], hipL: [255, 365], hipR: [325, 365], kneeL: [245, 465], kneeR: [327, 488], ankL: [235, 602], ankR: [355, 602], club: [401, 152] })],
  [11, R({ head: [280, 215], neck: [285, 255], shL: [245, 260], shR: [330, 255], elL: [215, 265], elR: [240, 245], hands: [160, 215], hipL: [265, 355], hipR: [340, 355], kneeL: [250, 455], kneeR: [362, 465], ankL: [235, 602], ankR: [355, 602], club: [0, 115] })],
  [12, R({ head: [280, 215], neck: [285, 255], shL: [250, 265], shR: [355, 270], elL: [240, 300], elR: [270, 290], hands: [165, 305], hipL: [270, 360], hipR: [345, 360], kneeL: [250, 470], kneeR: [362, 470], ankL: [235, 602], ankR: [355, 602], club: [0, 350] })],
  [13, R({ head: [288, 210], neck: [290, 250], shL: [265, 260], shR: [370, 255], elL: [290, 330], elR: [315, 320], hands: [265, 385], hipL: [275, 360], hipR: [350, 360], kneeL: [260, 470], kneeR: [355, 470], ankL: [235, 602], ankR: [355, 602], club: [140, 580] })],
  [13.6, R({ head: [287, 207], neck: [290, 248], shL: [265, 262], shR: [360, 250], elL: [300, 335], elR: [335, 325], hands: [312, 402], hipL: [285, 358], hipR: [355, 355], kneeL: [265, 470], kneeR: [355, 470], ankL: [233, 602], ankR: [355, 602], club: [290, 612] })],
  [15, R({ head: [280, 210], neck: [290, 245], shL: [270, 275], shR: [355, 228], elL: [335, 330], elR: [375, 300], hands: [395, 375], hipL: [305, 355], hipR: [375, 350], kneeL: [270, 470], kneeR: [375, 470], ankL: [225, 598], ankR: [355, 602], club: [500, 395] })],
  [16, R({ head: [283, 210], neck: [295, 245], shL: [285, 270], shR: [370, 225], elL: [375, 315], elR: [400, 272], hands: [440, 340], hipL: [315, 355], hipR: [380, 350], kneeL: [275, 470], kneeR: [375, 470], ankL: [215, 595], ankR: [355, 602], club: [520, 315] })],
  [17, R({ head: [283, 205], neck: [300, 240], shL: [295, 270], shR: [370, 225], elL: [380, 275], elR: [400, 250], hands: [465, 255], hipL: [320, 360], hipR: [375, 365], kneeL: [285, 470], kneeR: [370, 470], ankL: [215, 592], ankR: [355, 602], club: [495, 150] })],
  [18, R({ head: [290, 198], neck: [305, 235], shL: [305, 255], shR: [375, 230], elL: [400, 235], elR: [405, 212], hands: [460, 190], hipL: [330, 362], hipR: [375, 365], kneeL: [290, 460], kneeR: [370, 465], ankL: [215, 588], ankR: [355, 602], club: [410, 5] })],
  [18.5, R({ head: [300, 190], neck: [315, 228], shL: [300, 240], shR: [370, 230], elL: [390, 220], elR: [405, 195], hands: [420, 150], hipL: [335, 356], hipR: [371, 360], kneeL: [285, 455], kneeR: [365, 466], ankL: [212, 582], ankR: [355, 602], club: [274, 4] })],
  [19, R({ head: [308, 183], neck: [322, 222], shL: [302, 230], shR: [372, 224], elL: [370, 200], elR: [385, 165], hands: [360, 115], hipL: [337, 350], hipR: [368, 352], kneeL: [285, 450], kneeR: [360, 468], ankL: [211, 578], ankR: [355, 602], club: [154, 97] })],
  [19.5, R({ head: [315, 178], neck: [328, 218], shL: [304, 222], shR: [371, 222], elL: [345, 160], elR: [360, 135], hands: [300, 105], hipL: [338, 347], hipR: [368, 348], kneeL: [285, 447], kneeR: [358, 470], ankL: [210, 576], ankR: [355, 602], club: [131, 223] })],
  [20, R({ head: [318, 175], neck: [330, 215], shL: [305, 218], shR: [370, 220], elL: [320, 160], elR: [345, 140], hands: [280, 118], hipL: [338, 345], hipR: [368, 345], kneeL: [285, 445], kneeR: [358, 470], ankL: [210, 575], ankR: [355, 602], club: [351, 312] })],
  [21, R({ head: [318, 175], neck: [330, 215], shL: [305, 218], shR: [370, 220], elL: [305, 165], elR: [335, 148], hands: [268, 132], hipL: [338, 345], hipR: [368, 345], kneeL: [285, 445], kneeR: [358, 470], ankL: [210, 575], ankR: [355, 602], club: [422, 270] })],
  [22, R({ head: [320, 168], neck: [332, 210], shL: [307, 214], shR: [372, 216], elL: [300, 168], elR: [330, 152], hands: [262, 140], hipL: [340, 345], hipR: [370, 345], kneeL: [285, 445], kneeR: [358, 470], ankL: [210, 575], ankR: [355, 602], club: [444, 237] })],
];

// Club shaft angle (radians, screen coords, y down) between consecutive
// keys rotates the way a real swing does: increasing through the backswing
// (head sweeps down-left then up and over), DEcreasing through the
// downswing and follow-through (round the trail side, through the ball,
// up toward the target, then wrapping behind the back). Shortest-path
// interpolation would send the club the wrong way round at the bottom.
// One entry per gap between KEYS: +1 / -1 forces the direction, 0 = shortest.
const CLUB_DIR = KEYS.slice(1).map(() => 0); // the club angle channel is unused now (see armsAndClub)

// Timing, in seconds within one loop.
const ADDRESS_HOLD = 0.5;
// Key index -> seconds after the takeaway starts: the reference clip's own
// spacing (1/8 s per key), stretched slightly in the backswing and played
// a little faster from the top, so the tempo is a tour pro's ~3:1.
const FIRST_FRAME = 4;
const LAST_FRAME = 22;
const keySec = (f: number) => (f <= 10 ? ((f - 4) / 8) * 1.2 : 0.9 + ((f - 10) / 8) * 0.71);
const SWING_S = keySec(LAST_FRAME);
const FINISH_HOLD = 1.0;
const RETURN = 0.5;
export const SWING_MS = Math.round((ADDRESS_HOLD + SWING_S + FINISH_HOLD + RETURN) * 1000);
const DUR = SWING_MS / 1000;

const frameT = (f: number) => (ADDRESS_HOLD + keySec(f)) / DUR;
export const TOP_T = frameT(10);
export const FINISH_T = frameT(20);

// Full key list over one normalised loop, including the holds.
const LOOP: { t: number; pose: Pose }[] = [
  { t: 0, pose: KEYS[0][1] },
  ...KEYS.map(([f, pose]) => ({ t: frameT(f), pose })),
  { t: (ADDRESS_HOLD + SWING_S + FINISH_HOLD) / DUR, pose: KEYS[KEYS.length - 1][1] },
  { t: 1, pose: KEYS[0][1] },
];
// Direction rule per LOOP gap (address hold, keys…, finish hold, return).
const DIRS = [0, ...CLUB_DIR, 0, 0];

// ── rig ─────────────────────────────────────────────────────────────────

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const ang = (a: Pt, b: Pt) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const hipC = (p: Pose): Pt => [(p.hipL[0] + p.hipR[0]) / 2, (p.hipL[1] + p.hipR[1]) / 2];
const median = (v: number[]) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)];
const KP = KEYS.map((k) => k[1]);
const ADDR = KP[0];

// Fixed lengths for the parts that really are rigid in this view, plus the
// longest traced shoulder->hands reach (the hands are kept within it).
const ARM = 1.02 * Math.max(...KP.flatMap((p) => [dist(p.shL, p.hands), dist(p.shR, p.hands)]));
const LEN = {
  spine: median(KP.map((p) => dist(hipC(p), p.neck))),
  head: median(KP.map((p) => dist(p.neck, p.head))),
  // A 7-iron is about half the golfer's height; the traced shaft (taken
  // from a driver swing, and foreshortened) read too long on the figure.
  club: 0.8 * dist(ADDR.hands, ADDR.club),
  hipW: dist(ADDR.hipL, ADDR.hipR),
  shW: dist(ADDR.shL, ADDR.shR),
};

// A middle joint J (knee, elbow) described relative to its limb A->B:
// t = how far along A->B it projects (0..1), o = signed sideways offset
// as a fraction of |A->B|. Rebuilt from the same two numbers, so the
// joint always sits sensibly between its ends.
function limbParams(A: Pt, B: Pt, J: Pt): { t: number; o: number } {
  const L = dist(A, B) || 1;
  const ux = (B[0] - A[0]) / L;
  const uy = (B[1] - A[1]) / L;
  const jx = J[0] - A[0];
  const jy = J[1] - A[1];
  return { t: (jx * ux + jy * uy) / L, o: (-jx * uy + jy * ux) / L };
}
const MAX_OFFSET = 0.22; // sideways bend cap, as a fraction of limb length
function limbJoint(A: Pt, B: Pt, t: number, o: number): Pt {
  const L = dist(A, B);
  const ux = (B[0] - A[0]) / (L || 1);
  const uy = (B[1] - A[1]) / (L || 1);
  const tt = Math.min(0.7, Math.max(0.3, t));
  const oo = Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, o));
  return [A[0] + (ux * tt - uy * oo) * L, A[1] + (uy * tt + ux * oo) * L];
}

// Per-key channels, unwrapped where they are angles.
type Channels = Record<string, number[]>;
const CH: Channels = {};
const push = (k: string, v: number) => (CH[k] ??= []).push(v);
const unwrap = (vals: number[], dirs?: number[]) => {
  const out = [vals[0]];
  for (let i = 1; i < vals.length; i++) {
    let d = vals[i] - out[i - 1];
    d = ((d % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; // shortest
    const dir = dirs ? dirs[i - 1] : 0;
    if (dir > 0 && d < 0) d += 2 * Math.PI;
    if (dir < 0 && d > 0) d -= 2 * Math.PI;
    out.push(out[i - 1] + d);
  }
  return out;
};
for (const { pose: p } of LOOP) {
  const hc = hipC(p);
  push("hcx", hc[0]);
  push("hcy", hc[1]);
  // A turned pelvis/torso looks narrower face-on; clamp so it never collapses.
  push("hipW", Math.min(1.05, Math.max(0.55, dist(p.hipL, p.hipR) / LEN.hipW)) * LEN.hipW);
  push("hipTilt", ang(p.hipL, p.hipR));
  push("spineA", ang(hc, p.neck));
  push("headA", ang(p.neck, p.head));
  push("shW", Math.min(1.05, Math.max(0.55, dist(p.shL, p.shR) / LEN.shW)) * LEN.shW);
  push("shTilt", ang(p.shL, p.shR));
  // The hands travel on their traced arc round the chest (polar about the
  // neck); both arms then reach for them with IK.
  push("handsA", ang(p.neck, p.hands));
  push("handsR", dist(p.neck, p.hands));
  push("clubA", ang(p.hands, p.club));
  push("ankLx", p.ankL[0]);
  push("ankLy", p.ankL[1]);
  for (const [name, A, B, J] of [
    ["kL", p.hipL, p.ankL, p.kneeL],
    ["kR", p.hipR, p.ankR, p.kneeR],
    ["eL", p.shL, p.hands, p.elL],
    ["eR", p.shR, p.hands, p.elR],
  ] as [string, Pt, Pt, Pt][]) {
    const lp = limbParams(A, B, J);
    push(name + "t", lp.t);
    push(name + "o", lp.o);
  }
}
for (const k of ["hipTilt", "spineA", "headA", "shTilt", "handsA"]) CH[k] = unwrap(CH[k]);
CH.clubA = unwrap(CH.clubA, DIRS);

// Stabilise the trunk: a light symmetric 1-2-1 filter on the body-carriage
// channels removes hand-tracing wobble (symmetric, so it adds no lag). The
// holds at either end are left exact.
const smooth = (v: number[]) => v.map((x, i) => (i <= 1 || i >= v.length - 2 ? x : 0.25 * v[i - 1] + 0.5 * x + 0.25 * v[i + 1]));
for (const k of ["hcx", "hcy", "hipW", "hipTilt", "spineA", "headA", "shW", "shTilt", "ankLx", "ankLy", "kLt", "kLo", "kRt", "kRo", "eLt", "eLo", "eRt", "eRo"]) CH[k] = smooth(CH[k]);

const HIP_SCALE = 0.7;
const fromPolar = (o: Pt, a: number, r: number): Pt => [o[0] + Math.cos(a) * r, o[1] + Math.sin(a) * r];



// ── one shared timeline ─────────────────────────────────────────────────
// Every joint must pass through each key pose at the same instant, or the
// lower and upper body drift out of step. So time is mapped to a single
// "key index" s (a smooth, monotone curve through (keyTime, keyIndex)),
// and every channel — hips, legs, torso, arms, club — is interpolated in
// that same s with the same basis. Nothing is eased per joint.

const TS = LOOP.map((k) => k.t);

// Monotone cubic (Fritsch-Butland) through (keyTime, keyIndex): t -> s. Monotone, so
// the swing never runs backwards; zero slope at holds so they ease.
function warp(t: number): number {
  let i = 0;
  while (i < TS.length - 2 && t > TS[i + 1]) i++;
  const h = TS[i + 1] - TS[i] || 1;
  const sl = (j: number) => {
    if (j <= 0 || j >= TS.length - 1) return 0;
    const d0 = 1 / (TS[j] - TS[j - 1] || 1);
    const d1 = 1 / (TS[j + 1] - TS[j] || 1);
    return (2 * d0 * d1) / (d0 + d1);
  };
  const u = Math.min(1, Math.max(0, (t - TS[i]) / h));
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * i + (u3 - 2 * u2 + u) * h * sl(i) + (-2 * u3 + 3 * u2) * (i + 1) + (u3 - u2) * h * sl(i + 1);
}

// Catmull-Rom in key-index space, identical for every channel. Tangent is
// zero at a key that repeats its neighbour (the address and finish holds)
// so those ends settle instead of drifting.
function spline(vals: number[], s: number): number {
  const n = vals.length;
  const i = Math.min(n - 2, Math.max(0, Math.floor(s)));
  const u = Math.min(1, Math.max(0, s - i));
  const tan = (j: number) => {
    if (j <= 0 || j >= n - 1) return 0;
    if (vals[j] === vals[j - 1] || vals[j] === vals[j + 1]) return 0;
    return (vals[j + 1] - vals[j - 1]) / 2;
  };
  const p0 = vals[i];
  const p1 = vals[i + 1];
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * tan(i) + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * tan(i + 1);
}

// The loop ends like a video clip: hold the finish, fade the figure out,
// snap to address, fade back in. Animating the body back from the finish
// to address reads as a strange reverse swing, so it is never shown.
const RETURN_START = (ADDRESS_HOLD + SWING_S + FINISH_HOLD) / DUR;
export const RETURN_MID = RETURN_START + (1 - RETURN_START) / 2;
export function swingOpacity(t: number): number {
  const u = ((t % 1) + 1) % 1;
  if (u < RETURN_START) return 1;
  const k = (u - RETURN_START) / (1 - RETURN_START); // 0..1 over the return
  return Math.abs(1 - 2 * k); // 1 -> 0 at the midpoint -> 1
}

// ── downswing biomechanics ──────────────────────────────────────────────
// The traced keys are sparse through the downswing (20 fps of a ~0.25 s
// move), and with every channel on one clock two things went wrong:
//   1. no kinematic sequence — the hands started down first (casting),
//      hips ~60 ms later;
//   2. the club angle swung ~100° between two keys, so the club spun round
//      the body and bottomed out well behind the ball.
// So the downswing is shaped on top of the traced swing:
//   * kinematic sequence: during the transition and downswing the lower
//     body samples the traced swing LEAD ahead of the arms and the torso
//     LEAD/2 ahead; the offsets ramp in at the top and back out through
//     the follow-through, so the backswing and finish stay locked together;
//   * club: a designed lag-and-release path (world angle of the shaft)
//     from the top to the follow-through key — holds the set while the
//     hands start down, stays up (lag) as they drop, reaches shaft-parallel
//     on the trail side at hip height, releases fastest into impact aimed
//     at the ball, then decelerates into the traced follow-through.
//     Ends and slopes match the traced club, so nothing snaps.

const smoothstep = (e0: number, e1: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
};
const T_TOP = frameT(10); // club fully set at the top
const T_TRANSITION = frameT(9); // lower body begins to unwind here
const T_FOLLOW = frameT(15); // arms extended toward the target
const LEAD = 0.024; // fraction of the loop the lower body runs ahead (~105 ms)
const TORSO_LEAD = 0.016; // torso ahead of the arms, behind the hips
const ARM_HOLD = 0.018; // arms wait at the top (~80 ms) while the hips start

// 0 outside the downswing, 1 through it; ramps in during the transition
// and out slowly after the follow-through (slowly enough that no group's
// clock ever runs backwards).
function seqWeight(u: number): number {
  const on = smoothstep(T_TRANSITION, T_TOP, u);
  const off = 1 - smoothstep(T_FOLLOW - 0.01, T_FOLLOW + 0.14, u);
  return on * off;
}

// The traced rig, with each body group sampled on its own (sequenced) clock.
function rigPose(u: number): Pose & { clubA: number } {
  const w = seqWeight(u);
  const sLow = warp(Math.min(1, u + LEAD * w));
  const sTor = warp(Math.min(1, u + TORSO_LEAD * w));
  // The arms' hold is released during the downswing (they catch up and
  // then slow into impact, which is what whips the club through), not
  // after it — otherwise the hands peak after impact.
  const armW = smoothstep(T_TRANSITION, T_TOP, u) * (1 - smoothstep(T_TOP + 0.01, frameT(12), u));
  const sArm = warp(Math.max(0, u - ARM_HOLD * armW));
  const low = (k: string) => spline(CH[k], sLow);
  const tor = (k: string) => spline(CH[k], sTor);
  const arm = (k: string) => spline(CH[k], sArm);

  const hc: Pt = [low("hcx"), low("hcy")];
  // Narrower than traced: shorts made the source hips look wide, and a
  // mannequin's pelvis should sit inside its shoulders.
  const hw = (low("hipW") / 2) * HIP_SCALE;
  const ht = low("hipTilt");
  const hipL: Pt = [hc[0] - Math.cos(ht) * hw, hc[1] - Math.sin(ht) * hw];
  const hipR: Pt = [hc[0] + Math.cos(ht) * hw, hc[1] + Math.sin(ht) * hw];

  const neck = fromPolar(hc, tor("spineA"), LEN.spine);
  const head = fromPolar(neck, tor("headA"), LEN.head);
  const sw = tor("shW") / 2;
  const st = tor("shTilt");
  const shL: Pt = [neck[0] - Math.cos(st) * sw, neck[1] - Math.sin(st) * sw];
  const shR: Pt = [neck[0] + Math.cos(st) * sw, neck[1] + Math.sin(st) * sw];

  // Hands on their arc round the chest, kept within both arms' reach.
  let hands = fromPolar(neck, arm("handsA"), arm("handsR"));
  for (let pass = 0; pass < 2; pass++) {
    for (const sh of [shL, shR]) {
      if (dist(sh, hands) > ARM * 0.995) hands = fromPolar(sh, ang(sh, hands), ARM * 0.995);
    }
  }
  const elL = limbJoint(shL, hands, arm("eLt"), arm("eLo"));
  const elR = limbJoint(shR, hands, arm("eRt"), arm("eRo"));

  // Lead foot planted; trail foot pivots (rises onto its toe) only.
  const ankR: Pt = ADDR.ankR;
  const ankL: Pt = [low("ankLx"), Math.min(ADDR.ankL[1], low("ankLy"))];
  const kneeL = limbJoint(hipL, ankL, low("kLt"), low("kLo"));
  const kneeR = limbJoint(hipR, ankR, low("kRt"), low("kRo"));

  const clubA = arm("clubA");
  return { head, neck, shL, shR, elL, elR, hands, hipL, hipR, kneeL, kneeR, ankL, ankR, club: fromPolar(hands, clubA, LEN.club), clubA };
}

// ── the arms and club ───────────────────────────────────────────────────
// Read from the same keys, but as three smooth channels over time instead of
// as points: the hands' angle and distance round a fixed swing centre in the
// chest, and the shaft's angle. Each is a monotone cubic through the keys
// (Fritsch–Carlson), so between keys nothing overshoots or doubles back —
// the clubhead traces one clean arc up, one down, one through — and the
// shaft has a fixed length, so the club never stretches.
const CENTRE: Pt = M(285, 285);
const CLUB_L = 88;
const BALL_AT: Pt = M(290, 612);
const ARM_KEYS = (() => {
  const t: number[] = [];
  const phi: number[] = [];
  const r: number[] = [];
  const sh: number[] = [];
  for (const [f, p] of KEYS) {
    t.push(frameT(f));
    phi.push(ang(CENTRE, p.hands));
    r.push(dist(CENTRE, p.hands));
    sh.push(ang(p.hands, p.club));
  }
  // continuous angles: hands and shaft both turn back then through
  const cont = (v: number[]) => {
    for (let i = 1; i < v.length; i++) while (Math.abs(v[i] - v[i - 1]) > Math.PI) v[i] -= Math.sign(v[i] - v[i - 1]) * 2 * Math.PI;
  };
  cont(phi);
  cont(sh);
  // Hold address before the takeaway and the finish after the last key.
  return { t: [0, ...t, 1], phi: [phi[0], ...phi, phi[phi.length - 1]], r: [r[0], ...r, r[r.length - 1]], sh: [sh[0], ...sh, sh[sh.length - 1]] };
})();
function monotoneSlopes(x: number[], y: number[]): number[] {
  const n = x.length;
  const d = x.slice(1).map((xi, i) => (y[i + 1] - y[i]) / (xi - x[i] || 1));
  const m = x.map((_, i) => (i === 0 || i === n - 1 ? 0 : d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i])));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const q = a * a + b * b;
    if (q > 9) {
      m[i] = (3 / Math.sqrt(q)) * a * d[i];
      m[i + 1] = (3 / Math.sqrt(q)) * b * d[i];
    }
  }
  return m;
}
const SLOPES = { phi: monotoneSlopes(ARM_KEYS.t, ARM_KEYS.phi), r: monotoneSlopes(ARM_KEYS.t, ARM_KEYS.r), sh: monotoneSlopes(ARM_KEYS.t, ARM_KEYS.sh) };
function channel(name: "phi" | "r" | "sh", u: number): number {
  const x = ARM_KEYS.t;
  const y = ARM_KEYS[name];
  const m = SLOPES[name];
  let i = 0;
  while (i < x.length - 2 && u > x[i + 1]) i++;
  const h = x[i + 1] - x[i] || 1;
  const v = Math.min(1, Math.max(0, (u - x[i]) / h));
  const v2 = v * v;
  const v3 = v2 * v;
  return (2 * v3 - 3 * v2 + 1) * y[i] + (v3 - 2 * v2 + v) * h * m[i] + (-2 * v3 + 3 * v2) * y[i + 1] + (v3 - v2) * h * m[i + 1];
}
function armsAndClub(u: number): { hands: Pt; club: Pt } {
  const hands = fromPolar(CENTRE, channel("phi", u), channel("r", u));
  return { hands, club: fromPolar(hands, channel("sh", u), CLUB_L) };
}

export function samplePose(t: number): Pose {
  const u0 = ((t % 1) + 1) % 1;
  // During the return window show the finish (fading out), then address
  // (fading in) — never the in-between.
  const u = u0 < RETURN_START ? u0 : u0 < RETURN_MID ? RETURN_START : 0;
  const p = rigPose(u);
  const { hands, club } = armsAndClub(u);
  const elL = limbJoint(p.shL, hands, limbParams(p.shL, p.hands, p.elL).t, limbParams(p.shL, p.hands, p.elL).o);
  const elR = limbJoint(p.shR, hands, limbParams(p.shR, p.hands, p.elR).t, limbParams(p.shR, p.hands, p.elR).o);
  const { clubA: _unused, ...body } = p;
  void _unused;
  return { ...body, hands, elL, elR, club };
}

// Impact: the clubhead reaches the ball (the arms are back at address).
export const IMPACT_T = frameT(13.6);
// The swing trace stops once the club is over the head in the finish: the
// club dropping behind the back afterwards would loop back over the arc.
export const TRACE_END_T = frameT(19);
export const BALL: Pt = [BALL_AT[0], BALL_AT[1] + 1];
export const TOP_POSE = samplePose(TOP_T);
export const JOINT_NAMES = Object.keys(KEYS[0][1]).filter((k) => k !== "club") as JointName[];

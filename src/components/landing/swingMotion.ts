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

// [source frame at 20 fps, pose], in the figure's 200 x 260 box: joints read
// frame by frame off a face-on driver swing (target to the viewer's right),
// scaled x1.25 about the address hip centre, ankles on the ground at y 232.
const KEYS: [number, Pose][] = [
  [3, P({ head: [116, 64], neck: [111, 77], shL: [89, 78], shR: [131, 81], elL: [100, 116], elR: [129, 113], hands: [121, 146], hipL: [79, 124], hipR: [121, 124], kneeL: [74, 177], kneeR: [121, 177], ankL: [65, 232], ankR: [124, 232], club: [164, 254] })],
  [8, P({ head: [114, 64], neck: [110, 76], shL: [80, 78], shR: [121, 80], elL: [56, 106], elR: [76, 102], hands: [31, 128], hipL: [72, 127], hipR: [119, 127], kneeL: [70, 177], kneeR: [121, 177], ankL: [61, 232], ankR: [126, 232], club: [-20, 140] })],
  [10, P({ head: [114, 64], neck: [110, 74], shL: [71, 73], shR: [121, 74], elL: [55, 102], elR: [80, 82], hands: [36, 87], hipL: [69, 127], hipR: [121, 127], kneeL: [64, 178], kneeR: [120, 177], ankL: [60, 232], ankR: [128, 232], club: [-48, 4] })],
  [12, P({ head: [116, 61], neck: [110, 74], shL: [84, 73], shR: [121, 78], elL: [65, 82], elR: [90, 64], hands: [52, 51], hipL: [72, 127], hipR: [112, 127], kneeL: [66, 178], kneeR: [121, 181], ankL: [62, 232], ankR: [125, 232], club: [58, -63] })],
  [14, P({ head: [116, 64], neck: [111, 76], shL: [84, 74], shR: [121, 80], elL: [68, 62], elR: [98, 56], hands: [74, 36], hipL: [75, 127], hipR: [119, 128], kneeL: [66, 176], kneeR: [121, 178], ankL: [64, 232], ankR: [129, 232], club: [182, 2] })],
  [18, P({ head: [110, 61], neck: [110, 76], shL: [81, 74], shR: [121, 80], elL: [80, 60], elR: [104, 64], hands: [96, 40], hipL: [75, 128], hipR: [121, 128], kneeL: [66, 176], kneeR: [119, 181], ankL: [64, 232], ankR: [125, 232], club: [202, 88] })],
  [20, P({ head: [126, 77], neck: [121, 88], shL: [89, 84], shR: [134, 96], elL: [82, 102], elR: [101, 78], hands: [68, 71], hipL: [85, 137], hipR: [129, 137], kneeL: [78, 186], kneeR: [132, 186], ankL: [68, 232], ankR: [132, 232], club: [178, 24] })],
  [21, P({ head: [130, 81], neck: [125, 92], shL: [98, 84], shR: [142, 96], elL: [86, 116], elR: [108, 98], hands: [72, 98], hipL: [94, 143], hipR: [135, 141], kneeL: [80, 186], kneeR: [132, 186], ankL: [62, 230], ankR: [135, 232], club: [11, 18] })],
  [23, P({ head: [130, 78], neck: [129, 92], shL: [101, 92], shR: [132, 98], elL: [132, 117], elR: [146, 124], hands: [155, 147], hipL: [104, 147], hipR: [129, 147], kneeL: [85, 190], kneeR: [125, 192], ankL: [62, 224], ankR: [129, 232], club: [224, 177] })],
  [24, P({ head: [124, 78], neck: [119, 88], shL: [99, 82], shR: [129, 87], elL: [140, 107], elR: [149, 112], hands: [170, 127], hipL: [102, 143], hipR: [129, 141], kneeL: [94, 192], kneeR: [125, 192], ankL: [66, 224], ankR: [129, 232], club: [211, 18] })],
  [26, P({ head: [128, 64], neck: [121, 78], shL: [101, 78], shR: [142, 82], elL: [115, 62], elR: [140, 60], hands: [125, 47], hipL: [108, 137], hipR: [135, 137], kneeL: [88, 186], kneeR: [132, 191], ankL: [66, 224], ankR: [135, 232], club: [49, -26] })],
  [28, P({ head: [124, 61], neck: [121, 74], shL: [101, 74], shR: [142, 82], elL: [95, 52], elR: [130, 52], hands: [96, 40], hipL: [110, 141], hipR: [141, 138], kneeL: [90, 190], kneeR: [132, 192], ankL: [70, 224], ankR: [139, 232], club: [30, 124] })],
  [33, P({ head: [125, 57], neck: [121, 73], shL: [98, 80], shR: [146, 78], elL: [78, 82], elR: [111, 64], hands: [94, 64], hipL: [111, 141], hipR: [146, 141], kneeL: [98, 192], kneeR: [132, 196], ankL: [76, 224], ankR: [135, 232], club: [215, 120] })],
];

// Club shaft angle (radians, screen coords, y down) between consecutive
// keys rotates the way a real swing does: increasing through the backswing
// (head sweeps down-left then up and over), DEcreasing through the
// downswing and follow-through (round the trail side, through the ball,
// up toward the target, then wrapping behind the back). Shortest-path
// interpolation would send the club the wrong way round at the bottom.
// One entry per gap between KEYS: +1 / -1 forces the direction, 0 = shortest.
const CLUB_DIR = [1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1];

// Timing, in seconds within one loop.
const ADDRESS_HOLD = 0.5;
// The clip was filmed at 20 fps samples; play it at 0.75x (a touch of slow
// motion, the way swing analysis is usually shown) so the fast downswing
// doesn't jump between screen frames.
const FPS = 20 * 0.75;
const FIRST_FRAME = 3;
const LAST_FRAME = 33;
const FINISH_HOLD = 1.0;
const RETURN = 0.5;
export const SWING_MS = Math.round((ADDRESS_HOLD + (LAST_FRAME - FIRST_FRAME) / FPS + FINISH_HOLD + RETURN) * 1000);
const DUR = SWING_MS / 1000;

const frameT = (f: number) => (ADDRESS_HOLD + (f - FIRST_FRAME) / FPS) / DUR;
export const TOP_T = frameT(18);
export const FINISH_T = frameT(28);

// Full key list over one normalised loop, including the holds.
const LOOP: { t: number; pose: Pose }[] = [
  { t: 0, pose: KEYS[0][1] },
  ...KEYS.map(([f, pose]) => ({ t: frameT(f), pose })),
  { t: (ADDRESS_HOLD + (LAST_FRAME - FIRST_FRAME) / FPS + FINISH_HOLD) / DUR, pose: KEYS[KEYS.length - 1][1] },
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
const RETURN_START = (ADDRESS_HOLD + (LAST_FRAME - FIRST_FRAME) / FPS + FINISH_HOLD) / DUR;
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
const T_TOP = frameT(18); // club fully set at the top
const T_TRANSITION = frameT(15); // lower body begins to unwind here
const T_FOLLOW = frameT(24); // arms extended toward the target
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
  const armW = smoothstep(T_TRANSITION, T_TOP, u) * (1 - smoothstep(T_TOP + 0.01, frameT(21.2), u));
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

// ── the arms and club: an ideal swing ────────────────────────────────────
// The traced video drove the arms and club too, and its club path
// scribbled: a hook at the top, a different route down than up, and loops
// over the head at the finish. A model swing traces two clean Cs instead —
// one up the trail side (the club comes back down the same line), one up
// the lead side to the finish, mirror images of each other — so the arms
// and club are built from geometry, not the trace:
//   * the hands turn on a circle round a fixed swing centre in the chest
//     (arm angle φ, measured from straight down, + toward the trail side);
//   * the shaft's angle to that arm line — the wrist hinge β — is one smooth,
//     monotone function of φ, so the clubhead's position depends only on φ:
//     back and down share one arc, and the two sides are mirrored past
//     hip height;
//   * φ itself is timed like a pro swing: an even takeaway that settles at
//     the top, a downswing that accelerates all the way to the ball, and a
//     follow-through that bleeds the speed off into the finish.
// The body (hips, legs, torso) still comes from the trace, sequenced from
// the ground up.
const RAD = Math.PI / 180;
const CENTRE: Pt = [108, 92]; // swing centre: upper chest at address
const ARM_R = 54; // hands' distance from the centre
const CLUB_L = 88; // shaft length (hands to clubhead)
const BALL_AT: Pt = [106, 231]; // just forward of centre stance, under the chest
// Address (and impact): the arm angle and hinge that put the clubhead on
// the ball with the hands a little ahead of it (forward shaft lean).
const ADDRESS = (() => {
  const R = dist(CENTRE, BALL_AT);
  const beta = Math.acos((R * R - ARM_R * ARM_R - CLUB_L * CLUB_L) / (2 * ARM_R * CLUB_L));
  const alpha = Math.asin((CLUB_L * Math.sin(beta)) / R);
  const psi = ang(CENTRE, BALL_AT); // screen angle of the ball from the centre
  return { phi: psi - alpha - Math.PI / 2, beta };
})();
// A full swing, after a tour pro's (Tiger Woods' face-on positions):
//   top — hands high over the trail shoulder, shaft parallel to the ground
//         pointing at the target;
//   finish — hands up by the lead ear, the shaft wrapped behind the neck,
//         resting across the shoulders and sloping down to the trail side.
const PHI_TOP = 150 * RAD;
// Finish: hands beside the lead ear (the arms fold in, so they sit closer to
// the swing centre than at impact).
const FIN_HANDS: Pt = [140, 70];
const PHI_FIN = ang(CENTRE, FIN_HANDS) - Math.PI / 2;
const FIN_R = dist(CENTRE, FIN_HANDS);
const FIN_SHAFT = 170 * RAD; // behind the neck, sloping a touch down to the trail side
// Hinge keys (arm angle -> hinge), mirrored either side of the ball:
//   hip height     — shaft parallel to the ground (takeaway / release);
//   lead arm level — shaft vertical, the "L" (set / re-hinge);
//   top / finish   — as above.
const HINGE: [number, number][] = [
  [PHI_FIN, FIN_SHAFT - (Math.PI / 2 + PHI_FIN) - 2 * Math.PI],
  [-95 * RAD, -85 * RAD],
  [-50 * RAD, -40 * RAD],
  [ADDRESS.phi, ADDRESS.beta],
  [50 * RAD, 40 * RAD],
  [95 * RAD, 85 * RAD],
  [PHI_TOP, 120 * RAD],
];
// Monotone cubic (Fritsch–Carlson) through the hinge keys, flat at both ends.
const HINGE_M = (() => {
  const n = HINGE.length;
  const d = HINGE.slice(1).map((k, i) => (k[1] - HINGE[i][1]) / (k[0] - HINGE[i][0]));
  const m = HINGE.map((_, i) => (i === 0 || i === n - 1 ? 0 : d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i])));
  for (let i = 0; i < n - 1; i++) {
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const r = a * a + b * b;
    if (r > 9) {
      m[i] = (3 / Math.sqrt(r)) * a * d[i];
      m[i + 1] = (3 / Math.sqrt(r)) * b * d[i];
    }
  }
  return m;
})();
function hermite(x0: number, x1: number, y0: number, y1: number, m0: number, m1: number, x: number) {
  const h = x1 - x0;
  const v = Math.min(1, Math.max(0, (x - x0) / h));
  const v2 = v * v;
  const v3 = v2 * v;
  return (2 * v3 - 3 * v2 + 1) * y0 + (v3 - 2 * v2 + v) * h * m0 + (-2 * v3 + 3 * v2) * y1 + (v3 - v2) * h * m1;
}
function hinge(phi: number): number {
  let i = 0;
  while (i < HINGE.length - 2 && phi > HINGE[i + 1][0]) i++;
  return hermite(HINGE[i][0], HINGE[i + 1][0], HINGE[i][1], HINGE[i + 1][1], HINGE_M[i], HINGE_M[i + 1], phi);
}
// Arm angle over the loop.
const T_START = frameT(FIRST_FRAME);
const T_IMP = frameT(22.2);
const T_ARM_FIN = frameT(26.2);
// Downswing: constant angular acceleration from rest at the top, so it is
// fastest at the ball (slope = 2 x average). The follow-through starts at
// that same speed and decelerates to rest at the finish.
const DOWN_V = (2 * (ADDRESS.phi - PHI_TOP)) / (T_IMP - T_TOP);
function armAngle(u: number): number {
  if (u <= T_START) return ADDRESS.phi;
  if (u <= T_TOP) {
    const k = (u - T_START) / (T_TOP - T_START);
    return ADDRESS.phi + (PHI_TOP - ADDRESS.phi) * (0.5 - 0.5 * Math.cos(Math.PI * k));
  }
  if (u <= T_IMP) return hermite(T_TOP, T_IMP, PHI_TOP, ADDRESS.phi, 0, DOWN_V, u);
  if (u <= T_ARM_FIN) return hermite(T_IMP, T_ARM_FIN, ADDRESS.phi, PHI_FIN, DOWN_V, 0, u);
  return PHI_FIN;
}
function armsAndClub(u: number): { hands: Pt; club: Pt } {
  const phi = armAngle(u);
  // Arms fold in through the follow-through, past lead-arm-level.
  const r = ARM_R + (FIN_R - ARM_R) * smoothstep(-60 * RAD, PHI_FIN, phi);
  const hands = fromPolar(CENTRE, Math.PI / 2 + phi, r);
  return { hands, club: fromPolar(hands, Math.PI / 2 + phi + hinge(phi), CLUB_L) };
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
export const IMPACT_T = T_IMP;
export const BALL: Pt = [BALL_AT[0], BALL_AT[1] + 1];
export const TOP_POSE = samplePose(TOP_T);
export const JOINT_NAMES = Object.keys(KEYS[0][1]).filter((k) => k !== "club") as JointName[];

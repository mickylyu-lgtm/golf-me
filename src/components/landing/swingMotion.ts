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
//   a swing centre in the chest, the shaft angle, and the trail foot's pivot —
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
// as one piece, and the whole motion is then smoothed over time (see
// "smoothing") so speeds change gradually instead of key to key.

export type JointName =
  | "head" | "neck" | "shL" | "shR" | "elL" | "elR" | "hands"
  | "hipL" | "hipR" | "kneeL" | "kneeR" | "ankL" | "ankR";
export type Pt = readonly [number, number];
export type Pose = Record<JointName, Pt> & { club: Pt };


// [key index, pose]: joints read off a reference face-on swing animation
// (target to the viewer's right), sampled every 1/8 s of the clip, in that
// clip's pixels; M() maps them into the figure's 200 x 260 box with the
// ankles on the ground at y 232. Key 4 is address; 13.6 is impact (clubhead
// on the ball, hands a touch ahead). The top (9-10) is taken a little
// higher, to parallel, after a tour pro's face-on driver swing. The finish
// (19-22) is the classic balanced one for a right-handed golfer: chest and
// hips turned to the target, weight on a straight lead leg, trail heel up,
// hands high above the lead shoulder, the trail arm crossing up under the
// chin with its elbow toward the target, the lead elbow folded up beside
// the head (the arms make a V up to the hands, not two bars across the
// chest), and the club wrapped behind the neck.
const M = (x: number, y: number): [number, number] => [95 + (x - 295) * 0.426, 232 + (y - 605) * 0.426];
type Raw = Record<JointName | "club", [number, number]>;
const R = (o: Raw) => {
  const out: Record<string, [number, number]> = {};
  for (const k of Object.keys(o) as (keyof Raw)[]) out[k] = M(o[k][0], o[k][1]);
  return out as unknown as Pose;
};
const KEYS: [number, Pose][] = [
  [4, R({ head: [275, 207], neck: [278, 245], shL: [240, 255], shR: [325, 255], elL: [248, 330], elR: [318, 330], hands: [290, 405], hipL: [260, 360], hipR: [325, 360], kneeL: [245, 465], kneeR: [340, 465], ankL: [235, 600], ankR: [355, 600], club: [290, 612] })],
  [5, R({ head: [273, 210], neck: [278, 247], shL: [237, 258], shR: [328, 252], elL: [240, 335], elR: [295, 330], hands: [258, 410], hipL: [258, 360], hipR: [327, 360], kneeL: [245, 465], kneeR: [342, 465], ankL: [235, 600], ankR: [355, 600], club: [157, 590] })],
  [6, R({ head: [273, 213], neck: [275, 248], shL: [225, 242], shR: [325, 262], elL: [212, 318], elR: [260, 325], hands: [190, 385], hipL: [255, 360], hipR: [330, 360], kneeL: [245, 465], kneeR: [352, 462], ankL: [235, 600], ankR: [355, 600], club: [-17, 385] })],
  [7, R({ head: [275, 213], neck: [275, 250], shL: [235, 247], shR: [310, 265], elL: [188, 292], elR: [222, 300], hands: [140, 320], hipL: [255, 362], hipR: [328, 362], kneeL: [245, 465], kneeR: [345, 470], ankL: [235, 600], ankR: [355, 600], club: [39, 140] })],
  [8, R({ head: [270, 212], neck: [272, 250], shL: [230, 248], shR: [305, 263], elL: [195, 280], elR: [220, 272], hands: [140, 265], hipL: [255, 364], hipR: [327, 364], kneeL: [240, 465], kneeR: [337, 480], ankL: [235, 601], ankR: [355, 601], club: [172, 61] })],
  [9, R({ head: [270, 212], neck: [270, 250], shL: [225, 250], shR: [300, 262], elL: [215, 235], elR: [240, 215], hands: [180, 160], hipL: [255, 365], hipR: [325, 365], kneeL: [240, 465], kneeR: [330, 488], ankL: [235, 602], ankR: [355, 602], club: [384, 125] })],
  [10, R({ head: [275, 213], neck: [275, 252], shL: [230, 255], shR: [305, 265], elL: [225, 230], elR: [250, 205], hands: [195, 145], hipL: [255, 365], hipR: [325, 365], kneeL: [245, 465], kneeR: [327, 488], ankL: [235, 602], ankR: [355, 602], club: [401, 152] })],
  [11, R({ head: [280, 215], neck: [285, 255], shL: [245, 260], shR: [330, 255], elL: [215, 265], elR: [240, 245], hands: [160, 215], hipL: [265, 355], hipR: [340, 355], kneeL: [250, 455], kneeR: [362, 465], ankL: [235, 602], ankR: [355, 602], club: [345, 122] })],
  [12, R({ head: [280, 215], neck: [285, 255], shL: [250, 265], shR: [355, 270], elL: [240, 300], elR: [270, 290], hands: [165, 305], hipL: [270, 360], hipR: [345, 360], kneeL: [250, 470], kneeR: [362, 470], ankL: [235, 602], ankR: [355, 602], club: [227, 108] })],
  [13, R({ head: [288, 210], neck: [290, 250], shL: [265, 260], shR: [370, 255], elL: [290, 330], elR: [315, 320], hands: [265, 385], hipL: [275, 360], hipR: [350, 360], kneeL: [260, 470], kneeR: [355, 470], ankL: [235, 602], ankR: [355, 602], club: [69, 451] })],
  [13.6, R({ head: [287, 207], neck: [290, 248], shL: [265, 262], shR: [360, 250], elL: [300, 335], elR: [335, 325], hands: [312, 402], hipL: [285, 358], hipR: [355, 355], kneeL: [265, 470], kneeR: [355, 470], ankL: [233, 602], ankR: [355, 602], club: [290, 612] })],
  [15, R({ head: [280, 210], neck: [290, 245], shL: [270, 275], shR: [355, 228], elL: [335, 330], elR: [375, 300], hands: [395, 375], hipL: [305, 355], hipR: [375, 350], kneeL: [270, 470], kneeR: [375, 470], ankL: [225, 598], ankR: [355, 602], club: [500, 395] })],
  [16, R({ head: [283, 210], neck: [295, 245], shL: [285, 270], shR: [370, 225], elL: [375, 315], elR: [400, 272], hands: [440, 340], hipL: [315, 355], hipR: [380, 350], kneeL: [275, 470], kneeR: [375, 470], ankL: [215, 595], ankR: [355, 602], club: [520, 315] })],
  [17, R({ head: [283, 205], neck: [300, 240], shL: [295, 270], shR: [370, 225], elL: [380, 275], elR: [400, 250], hands: [465, 255], hipL: [320, 360], hipR: [375, 365], kneeL: [285, 470], kneeR: [370, 470], ankL: [215, 592], ankR: [355, 602], club: [495, 150] })],
  [18, R({ head: [290, 198], neck: [305, 235], shL: [305, 255], shR: [375, 230], elL: [400, 235], elR: [405, 212], hands: [460, 190], hipL: [330, 362], hipR: [375, 365], kneeL: [290, 460], kneeR: [370, 465], ankL: [215, 588], ankR: [355, 602], club: [410, 5] })],
  [18.5, R({ head: [300, 190], neck: [315, 228], shL: [300, 240], shR: [370, 230], elL: [392, 225], elR: [430, 200], hands: [440, 160], hipL: [335, 356], hipR: [371, 360], kneeL: [285, 455], kneeR: [365, 466], ankL: [212, 582], ankR: [355, 602], club: [294, 14] })],
  [19, R({ head: [308, 183], neck: [322, 222], shL: [302, 230], shR: [372, 224], elL: [385, 205], elR: [428, 180], hands: [420, 135], hipL: [337, 350], hipR: [368, 352], kneeL: [285, 450], kneeR: [360, 468], ankL: [211, 578], ankR: [355, 602], club: [217, 99] })],
  [19.5, R({ head: [315, 178], neck: [328, 218], shL: [304, 222], shR: [371, 222], elL: [382, 205], elR: [424, 162], hands: [400, 120], hipL: [338, 347], hipR: [368, 348], kneeL: [285, 447], kneeR: [358, 470], ankL: [210, 576], ankR: [355, 602], club: [200, 173] })],
  [20, R({ head: [318, 175], neck: [330, 215], shL: [305, 218], shR: [370, 220], elL: [380, 198], elR: [422, 155], hands: [390, 113], hipL: [338, 345], hipR: [368, 345], kneeL: [285, 445], kneeR: [358, 470], ankL: [210, 575], ankR: [355, 602], club: [196, 184] })],
  [22, R({ head: [320, 168], neck: [332, 210], shL: [307, 214], shR: [372, 216], elL: [378, 196], elR: [420, 150], hands: [385, 110], hipL: [340, 345], hipR: [370, 345], kneeL: [285, 445], kneeR: [358, 470], ankL: [210, 575], ankR: [355, 602], club: [195, 191] })],
];

// Timing, in seconds within one loop.
const ADDRESS_HOLD = 0.5;
// Key index -> seconds after the takeaway starts. The reference keys are
// 1/8 s apart, but the hands don't travel evenly between them, and evenly
// spaced keys made the motion speed up and slow down from key to key. So
// each key is re-timed from how far the hands have turned round the chest
// (their angle about the swing centre) along an ideal tempo curve:
//   backswing    — an even ease out of address and into the top (0.9 s);
//   downswing    — constant acceleration from rest at the top, fastest at
//                  the ball (0.32 s, so ~3:1 with the backswing);
//   follow-through — starts at that same speed and bleeds it off into the
//                  finish (0.53 s).
const LAST_FRAME = 22;
const BACK_S = 0.9;
const DOWN_S = 0.32;
const THRU_S = 0.53;
const KEY_SEC: [number, number][] = (() => {
  const c = M(285, 285);
  const a: number[] = [];
  for (const [, p] of KEYS) {
    let v = Math.atan2(p.hands[1] - c[1], p.hands[0] - c[0]);
    if (a.length) while (Math.abs(v - a[a.length - 1]) > Math.PI) v -= Math.sign(v - a[a.length - 1]) * 2 * Math.PI;
    a.push(v);
  }
  const top = a.indexOf(Math.max(...a));
  const imp = KEYS.findIndex(([f]) => f === 13.6);
  const [a0, aTop, aImp, aFin] = [a[0], a[top], a[imp], a[a.length - 1]];
  return KEYS.map(([f], i) => {
    if (i <= top) return [f, (BACK_S * Math.acos(1 - 2 * ((a[i] - a0) / (aTop - a0)))) / Math.PI];
    if (i <= imp) return [f, BACK_S + DOWN_S * Math.sqrt((aTop - a[i]) / (aTop - aImp))];
    return [f, BACK_S + DOWN_S + THRU_S * (1 - Math.cbrt(1 - (aImp - a[i]) / (aImp - aFin)))];
  });
})();
const keySec = (f: number) => {
  let i = 0;
  while (i < KEY_SEC.length - 2 && f > KEY_SEC[i + 1][0]) i++;
  const [f0, t0] = KEY_SEC[i];
  const [f1, t1] = KEY_SEC[i + 1];
  return t0 + ((t1 - t0) * (f - f0)) / (f1 - f0);
};
const SWING_S = keySec(LAST_FRAME);
const FINISH_HOLD = 1.2; // long enough to recognise the finish before it fades
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
// ── rig ─────────────────────────────────────────────────────────────────

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const ang = (a: Pt, b: Pt) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const hipC = (p: Pose): Pt => [(p.hipL[0] + p.hipR[0]) / 2, (p.hipL[1] + p.hipR[1]) / 2];
const median = (v: number[]) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)];
const KP = KEYS.map((k) => k[1]);
const ADDR = KP[0];

// Fixed lengths for the parts that really are rigid in this view.
const LEN = {
  spine: median(KP.map((p) => dist(hipC(p), p.neck))),
  head: median(KP.map((p) => dist(p.neck, p.head))),
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
const unwrap = (vals: number[]) => {
  const out = [vals[0]];
  for (let i = 1; i < vals.length; i++) {
    const d = vals[i] - out[i - 1];
    out.push(out[i - 1] + (((d % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI)); // shortest way round
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
for (const k of ["hipTilt", "spineA", "headA", "shTilt"]) CH[k] = unwrap(CH[k]);

// Stabilise the trunk: a light symmetric 1-2-1 filter on the body-carriage
// channels removes hand-tracing wobble (symmetric, so it adds no lag). The
// holds at either end are left exact.
// ── body motion through the swing ───────────────────────────────────────
// The reference animation barely moves its body until after impact (only
// the arms and club swing), so the figure stood still through the
// backswing and downswing and then lurched into the finish. The body is
// therefore authored here, as offsets from address at the top and at
// impact, and blended through the keys in step with the hands' progress:
//   top    — hips turned (~45°, narrower face-on) and shoulders turned
//            (~90°, narrower, lead shoulder down), weight loaded into the
//            trail side, lead knee folded in, spine leaning slightly back;
//   impact — weight shifted onto the lead side, hips open to the target,
//            trail shoulder down, trail knee driving toward the target,
//            spine tilted behind the ball.
// Through the follow-through the impact offsets fade into the traced
// finish (which does turn the body fully to the target).
{
  const DEG = Math.PI / 180;
  const c = M(285, 285);
  const arm = KEYS.map(([, p]) => Math.atan2(p.hands[1] - c[1], p.hands[0] - c[0]));
  for (let i = 1; i < arm.length; i++) while (Math.abs(arm[i] - arm[i - 1]) > Math.PI) arm[i] -= Math.sign(arm[i] - arm[i - 1]) * 2 * Math.PI;
  const top = arm.indexOf(Math.max(...arm));
  const imp = KEYS.findIndex(([f]) => f === 13.6);
  const last = KEYS.length - 1;
  // [channel, top offset, impact offset, multiplicative?]
  const PLAN: [string, number, number, boolean][] = [
    ["hcx", -3, 3, false],
    ["hcy", 0, 1.5, false],
    ["hipW", 0.72, 0.8, true],
    ["hipTilt", 4 * DEG, -6 * DEG, false],
    ["spineA", -3 * DEG, -7 * DEG, false],
    ["shW", 0.62, 0.86, true],
    ["shTilt", 12 * DEG, -16 * DEG, false],
    ["kRo", 0.13, -0.02, false],
    ["kLo", -0.02, -0.1, false],
  ];
  const ease = (x: number) => x * x * (3 - 2 * x);
  for (const [k, dTop, dImp, mul] of PLAN) {
    const v = CH[k]; // LOOP index = key index + 1
    const a = v[1];
    const at = (d: number) => (mul ? a * d : a + d);
    const tracedImp = v[imp + 1];
    const tracedFin = v[last + 1];
    const T = at(dTop);
    const I = at(dImp);
    for (let i = 1; i <= last; i++) {
      let x: number;
      if (i <= top) x = a + (T - a) * ease((arm[i] - arm[0]) / (arm[top] - arm[0]));
      else if (i <= imp) x = T + (I - T) * ease((arm[top] - arm[i]) / (arm[top] - arm[imp]));
      else {
        // traced follow-through, with the impact offset fading out by the finish
        const r = (arm[imp] - arm[i]) / (arm[imp] - arm[last]);
        x = v[i + 1] + (I - tracedImp) * (1 - ease(r));
      }
      v[i + 1] = x;
    }
    v[last + 2] = tracedFin; // finish hold unchanged
    v[0] = a; // address hold
  }
}

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

const smoothstep = (e0: number, e1: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
};

// Body channels at time u, all on one clock: the reference is an animated
// swing that is already sequenced (hips lead, arms follow), so nothing is
// offset on top of it.
const BODY_CH = ["hcx", "hcy", "hipW", "hipTilt", "spineA", "headA", "shW", "shTilt", "ankLx", "ankLy", "kLt", "kLo", "kRt", "kRo", "eLt", "eLo", "eRt", "eRo"] as const;
// Kinematic sequence: from the top into impact the lower body (pelvis,
// legs) runs ~45 ms ahead of the torso and arms — the hips start down first.
const LOWER = new Set(["hcx", "hcy", "hipW", "hipTilt", "ankLx", "ankLy", "kLt", "kLo", "kRt", "kRo"]);
const T_IMP0 = frameT(13.6);
function bodyChannels(u: number): number[] {
  const lead = (0.045 / DUR) * smoothstep(TOP_T - 0.05, TOP_T + 0.01, u) * (1 - smoothstep(T_IMP0, T_IMP0 + 0.06, u));
  const s = warp(u);
  const sLow = warp(Math.min(1, u + lead));
  return BODY_CH.map((k) => spline(CH[k], LOWER.has(k) ? sLow : s));
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


// Every channel (body and arms) at time u, before smoothing.
function rawChannels(u: number): number[] {
  return [...bodyChannels(u), channel("phi", u), channel("r", u), channel("sh", u)];
}
const NB = BODY_CH.length;
function buildPose(v: number[]): Pose {
  const c = (k: (typeof BODY_CH)[number]) => v[BODY_CH.indexOf(k)];
  const hc: Pt = [c("hcx"), c("hcy")];
  // Narrower than traced: a mannequin's pelvis sits inside its shoulders.
  const hw = (c("hipW") / 2) * HIP_SCALE;
  const ht = c("hipTilt");
  const hipL: Pt = [hc[0] - Math.cos(ht) * hw, hc[1] - Math.sin(ht) * hw];
  const hipR: Pt = [hc[0] + Math.cos(ht) * hw, hc[1] + Math.sin(ht) * hw];
  const neck = fromPolar(hc, c("spineA"), LEN.spine);
  const head = fromPolar(neck, c("headA"), LEN.head);
  const sw = c("shW") / 2;
  const st = c("shTilt");
  const shL: Pt = [neck[0] - Math.cos(st) * sw, neck[1] - Math.sin(st) * sw];
  const shR: Pt = [neck[0] + Math.cos(st) * sw, neck[1] + Math.sin(st) * sw];
  const hands = fromPolar(CENTRE, v[NB], v[NB + 1]);
  const club = fromPolar(hands, v[NB + 2], CLUB_L);
  const elL = limbJoint(shL, hands, c("eLt"), c("eLo"));
  const elR = limbJoint(shR, hands, c("eRt"), c("eRo"));
  // Lead foot planted; trail foot pivots (rises onto its toe) only.
  const ankR: Pt = ADDR.ankR;
  const ankL: Pt = [c("ankLx"), Math.min(ADDR.ankL[1], c("ankLy"))];
  const kneeL = limbJoint(hipL, ankL, c("kLt"), c("kLo"));
  const kneeR = limbJoint(hipR, ankR, c("kRt"), c("kRo"));
  return { head, neck, shL, shR, elL, elR, hands, hipL, hipR, kneeL, kneeR, ankL, ankR, club };
}

// ── smoothing ───────────────────────────────────────────────────────────
// The keys are hand-measured, 1/8 s apart, so between them speeds change in
// small steps — on screen that reads as jerky. The whole motion is baked
// once at 240 samples per second and every channel is smoothed over time
// with a Gaussian: wide (52 ms) through the slow parts, narrow (12 ms)
// around impact so the strike keeps its snap. The holds at either end are
// constant, so they are untouched.
const RATE = 240;
const BAKE_N = Math.ceil(RETURN_START * DUR * RATE) + 1;
const BAKED: number[][] = (() => {
  const keyed = Array.from({ length: BAKE_N }, (_, i) => rawChannels(Math.min(RETURN_START, i / (DUR * RATE))));
  // Re-time each phase by distance travelled, so the hands and club speed
  // up and slow down along one smooth curve instead of key to key. Travel
  // is measured as hands path + 0.3 x clubhead path (the hands alone barely
  // move while the club wraps round the neck in the finish). Every channel
  // is re-sampled on the same new clock, so the body stays coordinated.
  const poses = keyed.map(buildPose);
  const step = (i: number) => (i ? dist(poses[i].hands, poses[i - 1].hands) + 0.3 * dist(poses[i].club, poses[i - 1].club) : 0);
  const raw = keyed.map((row) => row.slice());
  const idx = (u: number) => Math.round(u * DUR * RATE);
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
  const [iStart, iTop, iImp, iEnd] = [idx(frameT(4)), idx(TOP_T), idx(frameT(13.6)), idx(frameT(LAST_FRAME))];
  retime(iStart, iTop, (x) => 0.5 - 0.5 * Math.cos(Math.PI * x)); // even backswing, settling at the top
  const down = retime(iTop, iImp, (x) => x * x); // constant acceleration, fastest at the ball
  // Follow-through: start at the downswing's speed at the ball, then slow
  // into the finish — the exponent makes the two speeds match at impact.
  const thru = travel(iImp, iEnd);
  const k = Math.min(4, Math.max(1.5, (2 * down * (iEnd - iImp)) / ((iImp - iTop) * thru[thru.length - 1])));
  retime(iImp, iEnd, (x) => 1 - (1 - x) ** k);
  const tImp = frameT(13.6) * DUR;
  // Knees and elbows (their bend parameters) are secondary: smoothed twice
  // as much, so they follow the limbs instead of jittering on their own.
  const soft = BODY_CH.map((k) => /^[ke][LR][to]$/.test(k)).concat([false, false, false]);
  const smoothAt = (i: number, sigma: number, c: number) => {
    const span = Math.ceil(3 * sigma * RATE);
    let acc = 0;
    let wSum = 0;
    for (let k = -span; k <= span; k++) {
      const w = Math.exp(-0.5 * (k / (sigma * RATE)) ** 2);
      acc += w * raw[Math.min(BAKE_N - 1, Math.max(0, i + k))][c];
      wSum += w;
    }
    return acc / wSum;
  };
  return raw.map((row, i) => {
    const sigma = 0.012 + 0.04 * smoothstep(0.03, 0.14, Math.abs(i / RATE - tImp));
    return row.map((_, c) => smoothAt(i, soft[c] ? 2 * sigma : sigma, c));
  });
})();
function bakedPose(u: number): Pose {
  const x = Math.min(BAKE_N - 1, Math.max(0, u * DUR * RATE));
  const i = Math.min(BAKE_N - 2, Math.floor(x));
  const f = x - i;
  return buildPose(BAKED[i].map((a, c) => a + (BAKED[i + 1][c] - a) * f));
}

export function samplePose(t: number): Pose {
  const u0 = ((t % 1) + 1) % 1;
  // During the return window show the finish (fading out), then address
  // (fading in) — never the in-between.
  const u = u0 < RETURN_START ? u0 : u0 < RETURN_MID ? RETURN_START : 0;
  return bakedPose(u);
}

// Impact: the moment the (smoothed) clubhead passes closest to the ball.
export const IMPACT_T = (() => {
  let best = frameT(13.6);
  let bestD = Infinity;
  for (let u = frameT(13.6) - 0.03; u <= frameT(13.6) + 0.03; u += 0.0002) {
    const d = dist(bakedPose(u).club, BALL_AT);
    if (d < bestD) [best, bestD] = [u, d];
  }
  return best;
})();
// The clubhead trail is recorded through to the end of the swing.
export const TRACE_END_T = frameT(LAST_FRAME);
export const BALL: Pt = [BALL_AT[0], BALL_AT[1] + 1];
export const TOP_POSE = samplePose(TOP_T);
export const JOINT_NAMES = Object.keys(KEYS[0][1]).filter((k) => k !== "club") as JointName[];

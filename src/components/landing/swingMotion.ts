// Motion for the Caddie demo's illustrated golfer. Pure math, no React, so
// it can be sampled outside the browser (scripts/ checks render it to a
// contact sheet).
//
// Key poses are joint positions read frame by frame off a real face-on
// driver swing filmed at 12 fps (target to the viewer's right). Earlier
// versions slid every joint in a straight line between keys, which made
// limbs stretch, the club change length and the hands cut through the
// body. Here every segment is interpolated as a ROTATION about its parent
// joint (angle + length in polar form) along a smooth cubic spline through
// the keys, so arms, legs and the club sweep in arcs the way a body does:
//   hip centre -> hips -> knees -> ankles
//   hip centre -> neck -> head, shoulders -> elbows
//   neck -> hands (the hands travel on an arc round the chest)
//   hands -> club (unwrapped in the swing's real direction of rotation)

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

// ── polar decomposition ─────────────────────────────────────────────────

type Polar = { a: number; r: number };
const polar = (from: Pt, to: Pt): Polar => ({ a: Math.atan2(to[1] - from[1], to[0] - from[0]), r: Math.hypot(to[0] - from[0], to[1] - from[1]) });
const hipC = (p: Pose): Pt => [(p.hipL[0] + p.hipR[0]) / 2, (p.hipL[1] + p.hipR[1]) / 2];

// Segment = [child, parent getter]. Order matters: parents first.
type Seg = { key: JointName | "club"; parent: (p: Pose) => Pt };
const SEGS: Seg[] = [
  { key: "hipL", parent: hipC },
  { key: "hipR", parent: hipC },
  { key: "kneeL", parent: (p) => p.hipL },
  { key: "kneeR", parent: (p) => p.hipR },
  { key: "ankL", parent: (p) => p.kneeL },
  { key: "ankR", parent: (p) => p.kneeR },
  { key: "neck", parent: hipC },
  { key: "head", parent: (p) => p.neck },
  { key: "shL", parent: (p) => p.neck },
  { key: "shR", parent: (p) => p.neck },
  { key: "elL", parent: (p) => p.shL },
  { key: "elR", parent: (p) => p.shR },
  { key: "hands", parent: (p) => p.neck },
  { key: "club", parent: (p) => p.hands },
];

// Pre-compute, per segment, the unwrapped angle and length at each LOOP key.
type Track = { a: number[]; r: number[] };
const TRACKS: Record<string, Track> = {};
const ROOT: { x: number[]; y: number[] } = { x: [], y: [] };
for (const { pose } of LOOP) {
  const c = hipC(pose);
  ROOT.x.push(c[0]);
  ROOT.y.push(c[1]);
}
for (const seg of SEGS) {
  const a: number[] = [];
  const r: number[] = [];
  LOOP.forEach(({ pose }, i) => {
    const pol = polar(seg.parent(pose), pose[seg.key]);
    r.push(pol.r);
    if (i === 0) {
      a.push(pol.a);
      return;
    }
    const prev = a[i - 1];
    let d = pol.a - prev;
    d = ((d % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; // shortest, in (-π, π]
    const dir = seg.key === "club" ? DIRS[i - 1] : 0;
    if (dir > 0 && d < 0) d += 2 * Math.PI;
    if (dir < 0 && d > 0) d -= 2 * Math.PI;
    a.push(prev + d);
  });
  TRACKS[seg.key] = { a, r };
}


// ── one shared timeline ─────────────────────────────────────────────────
// Every joint must pass through each key pose at the same instant, or the
// lower and upper body drift out of step. So time is mapped to a single
// "key index" s (a smooth, monotone curve through (keyTime, keyIndex)),
// and every channel — hips, legs, torso, arms, club — is interpolated in
// that same s with the same basis. Nothing is eased per joint.

const TS = LOOP.map((k) => k.t);
const IDX = TS.map((_, i) => i);

// Monotone cubic (Fritsch-Butland) through (TS, IDX): t -> s. Monotone, so
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

export function samplePose(t: number): Pose {
  const u0 = ((t % 1) + 1) % 1;
  // During the return window show the finish (fading out), then address
  // (fading in) — never the in-between.
  const u = u0 < RETURN_START ? u0 : u0 < RETURN_MID ? RETURN_START : 0;
  const out: Record<string, Pt> = {};
  const sKey = warp(u);
  const root: Pt = [spline(ROOT.x, sKey), spline(ROOT.y, sKey)];
  const get = (k: string): Pt => out[k];
  const parentOf: Record<string, () => Pt> = {
    hipL: () => root,
    hipR: () => root,
    kneeL: () => get("hipL"),
    kneeR: () => get("hipR"),
    ankL: () => get("kneeL"),
    ankR: () => get("kneeR"),
    neck: () => root,
    head: () => get("neck"),
    shL: () => get("neck"),
    shR: () => get("neck"),
    elL: () => get("shL"),
    elR: () => get("shR"),
    hands: () => get("neck"),
    club: () => get("hands"),
  };
  for (const seg of SEGS) {
    const tr = TRACKS[seg.key];
    const a = spline(tr.a, sKey);
    const r = spline(tr.r, sKey);
    const [px, py] = parentOf[seg.key]();
    out[seg.key] = [px + Math.cos(a) * r, py + Math.sin(a) * r];
  }
  return out as unknown as Pose;
}

// Impact: the lowest point of the clubhead during the downswing. Found by
// sampling once at load; the ball sits exactly there until it's struck.
function findImpact(): { t: number; x: number; y: number } {
  let best = { t: frameT(22), x: 100, y: 0 };
  for (let t = frameT(21); t <= frameT(23); t += 0.0005) {
    const c = samplePose(t).club;
    if (c[1] > best.y) best = { t, x: c[0], y: c[1] };
  }
  return best;
}
const IMPACT = findImpact();
export const IMPACT_T = IMPACT.t;
// The ball sits under the clubhead at address (it is struck at IMPACT_T,
// when the clubhead bottoms out on its way through).
const ADDRESS_CLUB = samplePose(0).club;
export const BALL: Pt = [ADDRESS_CLUB[0], ADDRESS_CLUB[1] + 1];
export const TOP_POSE = samplePose(TOP_T);
export const JOINT_NAMES = Object.keys(KEYS[0][1]).filter((k) => k !== "club") as JointName[];

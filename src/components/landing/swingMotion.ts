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

// [source frame at 12 fps, pose], in the figure's 200 x 260 box.
const KEYS: [number, Pose][] = [
  [0, P({ head: [102, 54], neck: [102, 77], shL: [77, 85], shR: [123, 87], elL: [80, 116], elR: [116, 116], hands: [96, 143], hipL: [77, 133], hipR: [123, 133], kneeL: [69, 179], kneeR: [131, 182], ankL: [55, 230], ankR: [137, 232], club: [108, 240] })],
  [4, P({ head: [100, 54], neck: [102, 76], shL: [75, 85], shR: [123, 87], elL: [64, 110], elR: [100, 112], hands: [62, 136], hipL: [77, 133], hipR: [123, 133], kneeL: [69, 179], kneeR: [131, 182], ankL: [55, 230], ankR: [137, 232], club: [-20, 188] })],
  [7, P({ head: [98, 56], neck: [100, 77], shL: [73, 83], shR: [120, 87], elL: [62, 92], elR: [94, 80], hands: [58, 72], hipL: [77, 133], hipR: [123, 133], kneeL: [70, 179], kneeR: [131, 182], ankL: [55, 230], ankR: [137, 232], club: [12, -6] })],
  [9, P({ head: [98, 59], neck: [100, 79], shL: [78, 77], shR: [125, 85], elL: [73, 62], elR: [108, 56], hands: [88, 40], hipL: [77, 133], hipR: [123, 131], kneeL: [70, 179], kneeR: [131, 182], ankL: [55, 230], ankR: [137, 232], club: [146, -12] })],
  [11, P({ head: [98, 60], neck: [100, 80], shL: [78, 77], shR: [125, 83], elL: [70, 54], elR: [112, 50], hands: [92, 32], hipL: [78, 131], hipR: [123, 130], kneeL: [72, 179], kneeR: [131, 182], ankL: [55, 230], ankR: [137, 232], club: [192, 18] })],
  [13, P({ head: [98, 60], neck: [100, 80], shL: [77, 81], shR: [123, 85], elL: [63, 92], elR: [100, 74], hands: [72, 74], hipL: [80, 133], hipR: [125, 130], kneeL: [75, 179], kneeR: [130, 182], ankL: [55, 230], ankR: [137, 232], club: [160, 6] })],
  [15, P({ head: [100, 62], neck: [102, 80], shL: [81, 83], shR: [127, 87], elL: [86, 112], elR: [118, 110], hands: [106, 138], hipL: [83, 133], hipR: [125, 128], kneeL: [78, 179], kneeR: [130, 179], ankL: [55, 232], ankR: [137, 232], club: [196, 186] })],
  [16, P({ head: [100, 63], neck: [103, 82], shL: [84, 83], shR: [125, 82], elL: [111, 90], elR: [133, 76], hands: [141, 77], hipL: [84, 131], hipR: [123, 128], kneeL: [81, 178], kneeR: [128, 179], ankL: [61, 230], ankR: [137, 232], club: [196, 13] })],
  [18, P({ head: [106, 63], neck: [108, 82], shL: [91, 82], shR: [128, 80], elL: [123, 62], elR: [144, 57], hands: [150, 36], hipL: [92, 130], hipR: [122, 127], kneeL: [92, 176], kneeR: [125, 178], ankL: [68, 226], ankR: [136, 232], club: [52, 52] })],
  [20, P({ head: [108, 62], neck: [109, 82], shL: [96, 84], shR: [124, 80], elL: [88, 62], elR: [110, 52], hands: [68, 46], hipL: [96, 131], hipR: [121, 128], kneeL: [100, 176], kneeR: [126, 179], ankL: [74, 220], ankR: [136, 232], club: [128, 120] })],
  [23, P({ head: [110, 60], neck: [111, 80], shL: [99, 83], shR: [125, 79], elL: [90, 60], elR: [110, 52], hands: [64, 46], hipL: [98, 130], hipR: [121, 128], kneeL: [104, 176], kneeR: [126, 179], ankL: [78, 218], ankR: [136, 232], club: [124, 118] })],
];

// Club shaft angle (radians, screen coords, y down) between consecutive
// keys rotates the way a real swing does: increasing through the backswing
// (head sweeps down-left then up and over), DEcreasing through the
// downswing and follow-through (round the trail side, through the ball,
// up toward the target, then wrapping behind the back). Shortest-path
// interpolation would send the club the wrong way round at the bottom.
// One entry per gap between KEYS: +1 / -1 forces the direction, 0 = shortest.
const CLUB_DIR = [1, 1, 1, 1, -1, -1, -1, -1, -1, 0];

// Timing, in seconds within one loop.
const ADDRESS_HOLD = 0.5;
// The clip was filmed at 12 fps; play it at 0.75x (a touch of slow
// motion, the way swing analysis is usually shown) so the fast downswing
// doesn't jump between screen frames.
const FPS = 12 * 0.75;
const LAST_FRAME = 23;
const FINISH_HOLD = 1.0;
const RETURN = 0.5;
export const SWING_MS = Math.round((ADDRESS_HOLD + LAST_FRAME / FPS + FINISH_HOLD + RETURN) * 1000);
const DUR = SWING_MS / 1000;

const frameT = (f: number) => (ADDRESS_HOLD + f / FPS) / DUR;
export const TOP_T = frameT(11);
export const FINISH_T = frameT(20);

// Full key list over one normalised loop, including the holds.
const LOOP: { t: number; pose: Pose }[] = [
  { t: 0, pose: KEYS[0][1] },
  ...KEYS.map(([f, pose]) => ({ t: frameT(f), pose })),
  { t: (ADDRESS_HOLD + LAST_FRAME / FPS + FINISH_HOLD) / DUR, pose: KEYS[KEYS.length - 1][1] },
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
// Hand-traced keys wobble by a pixel or two frame to frame; on the body
// that reads as jitter. Smooth the swing keys of every body segment with a
// light 1-2-1 filter (holds and the club/hands path left untouched).
const SMOOTH_SKIP = new Set(["hands", "club"]);
const smooth = (v: number[]) => v.map((x, i) => (i <= 1 || i >= v.length - 3 ? x : 0.25 * v[i - 1] + 0.5 * x + 0.25 * v[i + 1]));
for (const seg of SEGS) {
  if (SMOOTH_SKIP.has(seg.key)) continue;
  const tr = TRACKS[seg.key];
  TRACKS[seg.key] = { a: smooth(tr.a), r: smooth(tr.r) };
}
ROOT.x.splice(0, ROOT.x.length, ...smooth(ROOT.x));
ROOT.y.splice(0, ROOT.y.length, ...smooth(ROOT.y));

// ── cubic Hermite (Catmull-Rom with non-uniform knots) ──────────────────

const TS = LOOP.map((k) => k.t);
function spline(vals: number[], t: number): number {
  let i = 0;
  while (i < TS.length - 2 && t > TS[i + 1]) i++;
  const t0 = TS[i];
  const t1 = TS[i + 1];
  const p0 = vals[i];
  const p1 = vals[i + 1];
  // Tangents: centred finite differences; zero at holds (equal neighbours)
  // and at the loop ends, so every hold eases in and out.
  // Monotone (Fritsch-Butland) tangents: the curve never overshoots a
  // key, so limbs don't wobble past a position and come back; zero at
  // holds, direction changes and the loop ends, so those ease in and out.
  const tan = (j: number) => {
    if (j <= 0 || j >= TS.length - 1) return 0;
    const d0 = (vals[j] - vals[j - 1]) / (TS[j] - TS[j - 1] || 1);
    const d1 = (vals[j + 1] - vals[j]) / (TS[j + 1] - TS[j] || 1);
    if (d0 * d1 <= 0) return 0;
    return (2 * d0 * d1) / (d0 + d1);
  };
  const h = t1 - t0 || 1;
  const s = Math.min(1, Math.max(0, (t - t0) / h));
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * h * tan(i) + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * h * tan(i + 1);
}

// The loop ends like a video clip: hold the finish, fade the figure out,
// snap to address, fade back in. Animating the body back from the finish
// to address reads as a strange reverse swing, so it is never shown.
const RETURN_START = (ADDRESS_HOLD + LAST_FRAME / FPS + FINISH_HOLD) / DUR;
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
  const root: Pt = [spline(ROOT.x, u), spline(ROOT.y, u)];
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
    const a = spline(tr.a, u);
    const r = spline(tr.r, u);
    const [px, py] = parentOf[seg.key]();
    out[seg.key] = [px + Math.cos(a) * r, py + Math.sin(a) * r];
  }
  return out as unknown as Pose;
}

// Impact: the lowest point of the clubhead during the downswing. Found by
// sampling once at load; the ball sits exactly there until it's struck.
function findImpact(): { t: number; x: number; y: number } {
  let best = { t: frameT(14), x: 100, y: 0 };
  for (let t = frameT(13); t <= frameT(15); t += 0.0005) {
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

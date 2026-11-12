// The swing the Caddie processing screen plays while an analysis runs: a
// face-on, right-handed golfer drawn the way Caddie's own pose overlay draws
// a real swing (joints as dots, bones as lines), so the wait previews what
// the result will look like.
//
// Pure and deterministic. Eight key positions (address, takeaway, halfway
// back, top, delivery, impact, follow-through, finish) are written as body
// ANGLES, not as points, then turned into joint positions with fixed bone
// lengths (forward kinematics for the lead arm and club, a two-bone reach
// for the trail arm), so the limbs never stretch or shrink between frames.
// Each angle is eased between the key positions with a monotone cubic, so
// the motion is continuous through every key position (no stop-start) and
// never overshoots. The result is sampled once, here, into SMIL keyframe
// lists: the browser then plays the loop by itself, with no JavaScript per
// frame.

/** SVG viewBox the coordinates live in. */
export const SCENE_W = 320;
export const SCENE_H = 180;
export const GROUND_Y = 150;
/** Where the golfer stands (between the feet). */
export const STANCE_X = 104;
export const BALL = { x: STANCE_X + 4, y: GROUND_Y - 2.4, r: 2.4 };

// Apparent (on-screen, face-on) bone lengths.
const UPPER_ARM = 18.5;
const FOREARM = 17.5;
const CLUB = 34.5;
const NECK_TO_HEAD = 10.5;
export const HEAD_R = 6.2;

/** Seconds for one loop, fade-in to fade-out. */
export const LOOP_S = 6.4;

interface KeyPose {
  /** Seconds into the loop. */
  t: number;
  /** Pelvis centre. */
  px: number;
  py: number;
  /** Half the apparent hip width (narrows as the hips turn). */
  hipHalf: number;
  /** Hip line tilt, degrees (+ = lead hip higher). */
  hipTilt: number;
  /** Spine lean from vertical, degrees (- = top of spine away from the target). */
  spine: number;
  /** Apparent spine length (shorter when bent over the ball). */
  spineLen: number;
  /** Half the apparent shoulder width (narrows as the shoulders turn). */
  shHalf: number;
  /** Shoulder line tilt, degrees (+ = lead shoulder higher). */
  shTilt: number;
  /** Lead upper-arm direction, degrees: 0 = straight down, + = toward the target. */
  leadArm: number;
  /** Lead elbow bend, degrees, added to the forearm. */
  leadElbow: number;
  /** Club shaft direction, same convention, unwrapped (it turns past 360). */
  club: number;
  /** Knees, absolute. */
  tkx: number;
  tky: number;
  lkx: number;
  lky: number;
  /** Trail heel lift (finish rolls onto the trail toe). */
  heel: number;
}

const X = STANCE_X;
// Hand-tuned against real face-on swing frames: the trail shoulder sits low
// at address, the lead arm stays long to the top, the club is short of
// parallel there, the hips lead the downswing, the shaft leans forward at
// impact and the golfer finishes tall on the lead side.
const ADDRESS: Omit<KeyPose, "t"> = { px: X, py: 106, hipHalf: 9, hipTilt: 2, spine: -7, spineLen: 25, shHalf: 12.5, shTilt: 11, leadArm: -10, leadElbow: 0, club: -2, tkx: X - 13, tky: 129, lkx: X + 13, lky: 129, heel: 0 };
const KEYS: KeyPose[] = [
  { t: 0, ...ADDRESS },
  { t: 0.85, ...ADDRESS },
  // Takeaway: club parallel to the ground, hands by the trail thigh.
  { t: 1.32, px: X - 1.5, py: 106, hipHalf: 8.4, hipTilt: 1, spine: -8, spineLen: 25.5, shHalf: 10.5, shTilt: 6, leadArm: -42, leadElbow: 0, club: -92, tkx: X - 13, tky: 129, lkx: X + 11.5, lky: 129.5, heel: 0 },
  // Halfway back: lead arm parallel, club pointing up.
  { t: 1.78, px: X - 2, py: 106, hipHalf: 7.4, hipTilt: 0, spine: -9, spineLen: 26, shHalf: 8, shTilt: 0, leadArm: -96, leadElbow: -4, club: -182, tkx: X - 13, tky: 129, lkx: X + 9, lky: 130, heel: 0 },
  // Top: shoulders fully turned, club just short of parallel.
  { t: 2.34, px: X - 2.5, py: 106, hipHalf: 6.6, hipTilt: -2, spine: -10, spineLen: 26.5, shHalf: 6, shTilt: -6, leadArm: -128, leadElbow: -6, club: -258, tkx: X - 13, tky: 129, lkx: X + 7, lky: 130.5, heel: 0 },
  // Delivery: hips lead, the wrists keep their angle (lag).
  { t: 2.74, px: X + 2.5, py: 106.5, hipHalf: 7.6, hipTilt: -3, spine: -10, spineLen: 25.5, shHalf: 8.5, shTilt: 4, leadArm: -78, leadElbow: -2, club: -168, tkx: X - 10, tky: 129.5, lkx: X + 13, lky: 128.5, heel: 0 },
  // Impact: hips open, hands ahead, shaft leaning forward.
  { t: 2.92, px: X + 4, py: 106.5, hipHalf: 6.8, hipTilt: -4, spine: -9, spineLen: 25, shHalf: 11, shTilt: 12, leadArm: -2, leadElbow: 0, club: -7, tkx: X - 8, tky: 130, lkx: X + 14, lky: 128, heel: 1.5 },
  // Follow-through: both arms long toward the target, club up.
  { t: 3.14, px: X + 6, py: 106, hipHalf: 6, hipTilt: -3, spine: -3, spineLen: 26.5, shHalf: 5, shTilt: 6, leadArm: 80, leadElbow: 42, club: 176, tkx: X - 4, tky: 130.5, lkx: X + 14.5, lky: 127.5, heel: 4 },
  // Finish: tall, chest to the target, club behind the neck.
  { t: 3.62, px: X + 8, py: 105, hipHalf: 5.6, hipTilt: -1, spine: 3, spineLen: 29, shHalf: 6, shTilt: -2, leadArm: 118, leadElbow: 92, club: 292, tkx: X - 3, tky: 131, lkx: X + 14.5, lky: 127, heel: 8 },
  { t: LOOP_S, px: X + 8, py: 105, hipHalf: 5.6, hipTilt: -1, spine: 3, spineLen: 29, shHalf: 6, shTilt: -2, leadArm: 118, leadElbow: 92, club: 292, tkx: X - 3, tky: 131, lkx: X + 14.5, lky: 127, heel: 8 },
];
/** Seconds into the loop of each named position, for the phase timeline. */
export const PHASE_TIMES = { address: 0.85, top: 2.34, impact: 2.92, finish: 3.62 } as const;
export const IMPACT_S = PHASE_TIMES.impact;
/** The golfer fades in over this, at the start of the loop... */
export const FADE_IN_S = 0.4;
/** ...and out from here to the end, so the loop restarts unseen. */
export const FADE_OUT_FROM_S = 5.85;

type NumKey = Exclude<keyof KeyPose, "t">;
const PARAMS = Object.keys(ADDRESS) as NumKey[];

// Fritsch-Carlson monotone cubic: smooth through every knot, never
// overshoots, and flat wherever two neighbouring knots are equal (the holds).
function monotoneSlopes(ts: number[], ys: number[]): number[] {
  const n = ts.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (ts[i + 1] - ts[i]));
  const m: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] === 0 || d[i] === 0 || Math.sign(d[i - 1]) !== Math.sign(d[i])) m[i] = 0;
    else {
      const w1 = 2 * (ts[i + 1] - ts[i]) + (ts[i] - ts[i - 1]);
      const w2 = ts[i + 1] - ts[i] + 2 * (ts[i] - ts[i - 1]);
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return m;
}

const TS = KEYS.map((k) => k.t);
const SLOPES = Object.fromEntries(PARAMS.map((p) => [p, monotoneSlopes(TS, KEYS.map((k) => k[p]))])) as Record<NumKey, number[]>;

function poseAt(t: number): Omit<KeyPose, "t"> {
  let i = 0;
  while (i < KEYS.length - 2 && t > TS[i + 1]) i++;
  const h = TS[i + 1] - TS[i];
  const s = Math.min(1, Math.max(0, (t - TS[i]) / h));
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
  const h10 = s ** 3 - 2 * s ** 2 + s;
  const h01 = -2 * s ** 3 + 3 * s ** 2;
  const h11 = s ** 3 - s ** 2;
  const out = {} as Omit<KeyPose, "t">;
  for (const p of PARAMS) {
    out[p] = h00 * KEYS[i][p] + h10 * h * SLOPES[p][i] + h01 * KEYS[i + 1][p] + h11 * h * SLOPES[p][i + 1];
  }
  return out;
}

export interface Pt {
  x: number;
  y: number;
}
const rad = (deg: number) => (deg * Math.PI) / 180;
/** 0 deg = straight down, + = toward the target (screen right). */
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const along = (from: Pt, deg: number, len: number): Pt => ({ x: from.x + Math.sin(rad(deg)) * len, y: from.y + Math.cos(rad(deg)) * len });

// Elbow for a two-bone reach from shoulder to hands. Of the two solutions
// it takes the lower one: a trail elbow folds toward the ground all swing.
function reach(shoulder: Pt, hands: Pt, a: number, b: number): Pt {
  const dx = hands.x - shoulder.x;
  const dy = hands.y - shoulder.y;
  const dist = Math.min(a + b - 0.01, Math.max(Math.abs(a - b) + 0.01, Math.hypot(dx, dy)));
  const along1 = (a * a - b * b + dist * dist) / (2 * dist);
  const off = Math.sqrt(Math.max(0, a * a - along1 * along1));
  const ux = dx / Math.hypot(dx, dy);
  const uy = dy / Math.hypot(dx, dy);
  const one = { x: shoulder.x + ux * along1 - uy * off, y: shoulder.y + uy * along1 + ux * off };
  const two = { x: shoulder.x + ux * along1 + uy * off, y: shoulder.y + uy * along1 - ux * off };
  return one.y >= two.y ? one : two;
}

export interface Skeleton {
  head: Pt;
  neck: Pt;
  trailShoulder: Pt;
  leadShoulder: Pt;
  trailElbow: Pt;
  leadElbow: Pt;
  hands: Pt;
  clubHead: Pt;
  trailHip: Pt;
  leadHip: Pt;
  trailKnee: Pt;
  leadKnee: Pt;
  trailAnkle: Pt;
  leadAnkle: Pt;
}

export function skeletonAt(t: number): Skeleton {
  const q = poseAt(((t % LOOP_S) + LOOP_S) % LOOP_S);
  const pelvis = { x: q.px, y: q.py };
  const hipDy = Math.sin(rad(q.hipTilt)) * q.hipHalf;
  const trailHip = { x: pelvis.x - q.hipHalf, y: pelvis.y + hipDy };
  const leadHip = { x: pelvis.x + q.hipHalf, y: pelvis.y - hipDy };
  const neck = { x: pelvis.x + Math.sin(rad(q.spine)) * q.spineLen, y: pelvis.y - Math.cos(rad(q.spine)) * q.spineLen };
  const head = { x: neck.x + Math.sin(rad(q.spine)) * NECK_TO_HEAD * 0.7, y: neck.y - NECK_TO_HEAD };
  const shDy = Math.sin(rad(q.shTilt)) * q.shHalf;
  const leadShoulder = { x: neck.x + q.shHalf, y: neck.y + 1.5 - shDy };
  const leadElbow = along(leadShoulder, q.leadArm, UPPER_ARM);
  const hands = along(leadElbow, q.leadArm + q.leadElbow, FOREARM);
  // Through the ball the trail shoulder turns toward the target; seen face-on
  // it slides toward the hands. Drawn that way, the trail arm never stretches.
  const trailAt = { x: neck.x - q.shHalf, y: neck.y + 1.5 + shDy };
  const reachMax = UPPER_ARM + FOREARM - 0.05;
  const toHands = dist(trailAt, hands);
  const pull = toHands > reachMax ? (toHands - reachMax) / toHands : 0;
  const trailShoulder = { x: trailAt.x + (hands.x - trailAt.x) * pull, y: trailAt.y + (hands.y - trailAt.y) * pull };
  const trailElbow = reach(trailShoulder, hands, UPPER_ARM, FOREARM);
  const clubHead = along(hands, q.club, CLUB);
  const trailAnkle = { x: X - 14 + q.heel * 0.35, y: GROUND_Y - q.heel };
  const leadAnkle = { x: X + 14, y: GROUND_Y };
  return {
    head,
    neck,
    trailShoulder,
    leadShoulder,
    trailElbow,
    leadElbow,
    hands,
    clubHead,
    trailHip,
    leadHip,
    trailKnee: { x: q.tkx, y: q.tky },
    leadKnee: { x: q.lkx, y: q.lky },
    trailAnkle,
    leadAnkle,
  };
}

const f = (n: number) => (Math.round(n * 10) / 10).toString();
const M = (p: Pt) => `M${f(p.x)} ${f(p.y)}`;
const L = (p: Pt) => `L${f(p.x)} ${f(p.y)}`;

/** Every bone, one path. Same command layout every frame (SMIL needs that). */
export function bonesPath(s: Skeleton): string {
  return [
    M(s.trailAnkle) + L(s.trailKnee) + L(s.trailHip) + L(s.leadHip) + L(s.leadKnee) + L(s.leadAnkle),
    M(s.trailShoulder) + L(s.leadShoulder),
    M({ x: (s.trailHip.x + s.leadHip.x) / 2, y: (s.trailHip.y + s.leadHip.y) / 2 }) + L(s.neck),
    M(s.leadShoulder) + L(s.leadElbow) + L(s.hands),
    M(s.trailShoulder) + L(s.trailElbow) + L(s.hands),
  ].join("");
}

/** Every joint as a zero-length segment: round caps draw them as dots. */
export function jointsPath(s: Skeleton): string {
  return [s.trailShoulder, s.leadShoulder, s.trailElbow, s.leadElbow, s.hands, s.trailHip, s.leadHip, s.trailKnee, s.leadKnee, s.trailAnkle, s.leadAnkle]
    .map((p) => `${M(p)}h0`)
    .join("");
}

export function clubPath(s: Skeleton): string {
  return M(s.hands) + L(s.clubHead);
}

export interface SmilTrack {
  keyTimes: string;
  values: string;
}

/** Sample times: the knots, plus ~30 per second while the golfer moves. */
export function sampleTimes(): number[] {
  const times = new Set<number>([0, LOOP_S]);
  for (const k of KEYS) times.add(k.t);
  const moveFrom = KEYS[1].t;
  const moveTo = KEYS[KEYS.length - 2].t;
  for (let t = moveFrom; t < moveTo; t += 1 / 30) times.add(Math.round(t * 1000) / 1000);
  return [...times].sort((a, b) => a - b);
}

export function smilTrack(map: (s: Skeleton) => string): SmilTrack {
  const times = sampleTimes();
  return {
    keyTimes: times.map((t) => (t / LOOP_S).toFixed(4)).join(";"),
    // The last key time is the end of the loop itself, not the start of the next.
    values: times.map((t) => map(skeletonAt(Math.min(t, LOOP_S - 1e-6)))).join(";"),
  };
}

/** The figure is drawn in its own units and placed into the scene by this. */
export const FIGURE = { x: 92, y: 151, scale: 1.3 };
export const FIGURE_TRANSFORM = `translate(${FIGURE.x} ${FIGURE.y}) scale(${FIGURE.scale}) translate(${-STANCE_X} ${-GROUND_Y})`;
const BALL_IN_SCENE = { x: FIGURE.x + (BALL.x - STANCE_X) * FIGURE.scale, y: FIGURE.y + (BALL.y - GROUND_Y) * FIGURE.scale };

/** The ball's flight in scene units: a mid-iron launch toward the target, out of frame. */
export const TRACER_D = `M${f(BALL_IN_SCENE.x)} ${f(BALL_IN_SCENE.y)} C ${f(BALL_IN_SCENE.x + 90)} ${f(BALL_IN_SCENE.y - 52)}, ${f(BALL_IN_SCENE.x + 165)} ${f(BALL_IN_SCENE.y - 150)}, ${SCENE_W + 8} ${f(BALL_IN_SCENE.y - 112)}`;

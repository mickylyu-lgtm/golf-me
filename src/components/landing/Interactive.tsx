import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { Check, Play, RotateCcw, Sparkles, Target, Users, Video } from "lucide-react";
import { CaddieNavIcon } from "../icons/CaddieNavIcon";
import { AppStoreButton } from "./AppStoreButton";
import { DEFAULT_MOCK_GOLFERS, GolfersScreen, PhoneFrame, RoundsScreen, CaddieScreen, ScoreRing } from "./PhoneMock";
import type { MockGolfer } from "./PhoneMock";
import { useLocale } from "../../i18n/LocaleContext";
import { samplePose, swingOpacity, SWING_MS, TOP_T, IMPACT_T, FINISH_T, BALL, TOP_POSE, JOINT_NAMES, RETURN_MID, TRACE_END_T } from "./swingMotion";
import type { JointName, Pose, Pt } from "./swingMotion";

// Interactive demos for the public landing page. Each one is a small,
// self-contained toy that explains one part of the product by letting the
// visitor do it: re-rank golfers, fill a foursome, run a swing analysis.
// Rules shared by all of them:
//   - the first render is pure (no window/document reads), so the
//     build-time prerender (react-dom/server) produces sensible markup and
//     the page is useful before any JS has run;
//   - everything is illustrative — names, scores and timings are examples,
//     never real users or real Caddie output;
//   - timers are cleared on unmount and animations collapse under
//     prefers-reduced-motion via the global rule in index.css.

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// ── Hero: auto-rotating tabs + pointer tilt ─────────────────────────────

type HeroTab = "rounds" | "golfers" | "caddie";
const HERO_TABS: HeroTab[] = ["rounds", "golfers", "caddie"];
const ROTATE_MS = 5000;

export function HeroShowcase() {
  const { t } = useLocale();
  const [tab, setTab] = useState<HeroTab>("rounds");
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0); // restarts the progress bar animation
  const [tilt, setTilt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Auto-advance; a manual tap pauses rotation for a while so the visitor
  // can actually read the screen they chose.
  useEffect(() => {
    if (paused || prefersReducedMotion()) return;
    const id = window.setTimeout(() => {
      setTab((cur) => HERO_TABS[(HERO_TABS.indexOf(cur) + 1) % HERO_TABS.length]);
      setCycle((c) => c + 1);
    }, ROTATE_MS);
    return () => window.clearTimeout(id);
  }, [tab, cycle, paused]);

  useEffect(() => {
    if (!paused) return;
    const id = window.setTimeout(() => setPaused(false), 12000);
    return () => window.clearTimeout(id);
  }, [paused]);

  const choose = (next: HeroTab) => {
    setTab(next);
    setCycle((c) => c + 1);
    setPaused(true);
  };

  // Desktop only (pointer: fine): the phone leans toward the cursor.
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ x: -py * 10, y: px * 14 });
  };
  const onLeave = () => setTilt({ x: 0, y: 0 });

  const tabs: { id: HeroTab; label: string; icon: ReactNode }[] = [
    { id: "rounds", label: t("landing.hero.tabRounds"), icon: <Target size={14} /> },
    { id: "golfers", label: t("landing.hero.tabGolfers"), icon: <Users size={14} /> },
    { id: "caddie", label: t("landing.hero.tabCaddie"), icon: <CaddieNavIcon size={15} /> },
  ];

  return (
    <div className="mx-auto flex w-fit flex-col items-center">
      <div role="tablist" aria-label={t("landing.hero.mockLabel")} className="mb-5 flex rounded-full border border-white/15 bg-white/10 p-1 text-xs font-semibold backdrop-blur-sm">
        {tabs.map((h) => (
          <button
            key={h.id}
            role="tab"
            aria-selected={tab === h.id}
            onClick={() => choose(h.id)}
            className={`relative flex items-center gap-1.5 overflow-hidden rounded-full px-3.5 py-1.5 transition ${
              tab === h.id ? "bg-white text-fairway-900 shadow-sm" : "text-fairway-100 hover:text-white"
            }`}
          >
            {tab === h.id && !paused && (
              <span
                key={cycle}
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-fairway-500"
                style={{ animation: `hero-progress ${ROTATE_MS}ms linear forwards` }}
              />
            )}
            {h.icon} {h.label}
          </button>
        ))}
      </div>
      <div
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        className="animate-float"
        style={{ perspective: "1200px" } as CSSProperties}
      >
        <div
          style={{
            transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
            transition: "transform 240ms ease-out",
            transformStyle: "preserve-3d",
          }}
        >
          <PhoneFrame>
            <div key={tab} className="animate-pop">
              {tab === "rounds" && <RoundsScreen />}
              {tab === "golfers" && <GolfersScreen />}
              {tab === "caddie" && <CaddieScreen />}
            </div>
          </PhoneFrame>
        </div>
      </div>
      <style>{`@keyframes hero-progress { from { transform: scaleX(0) } to { transform: scaleX(1) } }`}</style>
      <p className="mt-4 text-[11px] text-fairway-200/70">{t("landing.hero.mockLabel")}</p>
    </div>
  );
}

// ── Find partners: preference chips re-rank the golfer list ─────────────

type Level = "beginner" | "mid" | "low";
type When = "weekends" | "weeknights";
type Style = "casual" | "competitive";

interface Candidate extends MockGolfer {
  level: Level;
  when: When[];
  style: Style;
}

const CANDIDATES: Candidate[] = [
  { ...DEFAULT_MOCK_GOLFERS[0], level: "mid", when: ["weekends"], style: "casual" },
  { ...DEFAULT_MOCK_GOLFERS[1], level: "beginner", when: ["weeknights"], style: "casual" },
  { ...DEFAULT_MOCK_GOLFERS[2], level: "beginner", when: ["weekends", "weeknights"], style: "casual" },
  { ...DEFAULT_MOCK_GOLFERS[3], level: "low", when: ["weekends", "weeknights"], style: "competitive" },
  { initials: "MO", tone: "bg-violet-600", name: "Maya O.", meta: "Handicap 11 · Weekends · Jersey City", match: "", level: "mid", when: ["weekends"], style: "competitive" },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        active ? "border-fairway-800 bg-fairway-800 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-fairway-300 hover:text-fairway-800"
      }`}
    >
      {children}
    </button>
  );
}

export function MatchDemo() {
  const { t } = useLocale();
  const [level, setLevel] = useState<Level>("beginner");
  const [when, setWhen] = useState<When>("weekends");
  const [style, setStyle] = useState<Style>("casual");

  const scored = CANDIDATES.map((c) => {
    let score = 40;
    if (c.level === level) score += 30;
    else if ((c.level === "mid" && level !== "mid") || (level === "mid" && c.level !== "mid")) score += 12;
    if (c.when.includes(when)) score += 20;
    if (c.style === style) score += 10;
    return { ...c, score };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map<MockGolfer>((c) => ({ ...c, match: c.score >= 85 ? "Great Match" : c.score >= 70 ? "Strong Match" : c.score >= 50 ? "Good Match" : "Possible Match" }));

  const group = (label: string, children: ReactNode) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      {children}
    </div>
  );

  return (
    <div className="relative">
      <div aria-hidden="true" className="absolute inset-x-8 bottom-4 top-24 rounded-[3rem] bg-gradient-to-br from-fairway-100 to-sun-100" />
      <div className="relative mx-auto mb-5 w-full max-w-sm space-y-2 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm backdrop-blur">
        <p className="text-xs font-bold text-fairway-800">{t("landing.demo.tryIt")}</p>
        {group(
          "Level",
          (["beginner", "mid", "low"] as Level[]).map((l) => (
            <Chip key={l} active={level === l} onClick={() => setLevel(l)}>
              {l === "beginner" ? "Beginner" : l === "mid" ? "Mid handicap" : "Low handicap"}
            </Chip>
          )),
        )}
        {group(
          "When",
          (["weekends", "weeknights"] as When[]).map((w) => (
            <Chip key={w} active={when === w} onClick={() => setWhen(w)}>
              {w === "weekends" ? "Weekends" : "Weeknights"}
            </Chip>
          )),
        )}
        {group(
          "Style",
          (["casual", "competitive"] as Style[]).map((s) => (
            <Chip key={s} active={style === s} onClick={() => setStyle(s)}>
              {s === "casual" ? "Casual & social" : "Competitive"}
            </Chip>
          )),
        )}
      </div>
      <PhoneFrame className="relative">
        <GolfersScreen golfers={scored} />
      </PhoneFrame>
    </div>
  );
}

// ── Rounds: fill the foursome ───────────────────────────────────────────

const SEATS = [
  { initials: "PR", tone: "bg-fairway-700", name: "Priya (host)" },
  { initials: "TM", tone: "bg-sky-600", name: "Tom" },
  { initials: "YOU", tone: "bg-sun-500", name: "You" },
  { initials: "AK", tone: "bg-rose-500", name: "Aiko" },
];

export function FoursomeDemo() {
  const { t } = useLocale();
  // 0 = host only ... 4 = full. Starts at 2 so "Join" is the obvious move.
  const [joined, setJoined] = useState(2);
  const [toast, setToast] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const join = () => {
    if (joined >= 4) return;
    setJoined(3);
    setToast("You're in. Priya's been notified 🏌️");
    later(() => setJoined(4), 1800);
    later(() => setToast("Aiko just took the last spot — round full!"), 1900);
    later(() => setToast(null), 5200);
  };
  const reset = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    setJoined(2);
    setToast(null);
  };

  const remaining = 4 - joined;
  const full = remaining === 0;

  return (
    <div className="relative mx-auto max-w-sm">
      <div aria-hidden="true" className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-fairway-50 to-fairway-100" />
      <p className="mb-3 text-xs font-bold text-fairway-800">{t("landing.demo.tryIt")}</p>
      <div className={`rounded-3xl border bg-white p-4 shadow-md transition ${full ? "border-fairway-400 ring-4 ring-fairway-100" : "border-slate-100"}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-extrabold leading-tight text-slate-900">Van Cortlandt Park Golf Course</p>
            <p className="mt-0.5 text-xs text-slate-500">SAT · 7:40 AM · 6 mi away · ~$45</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${full ? "bg-fairway-800 text-white" : "bg-fairway-100 text-fairway-800"}`}>
            {full ? "Round full" : `${remaining} spot${remaining === 1 ? "" : "s"} remaining`}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["Casual & Social", "Walking", "Beginner-Friendly"].map((tg) => (
            <span key={tg} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              {tg}
            </span>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          {SEATS.map((s, i) => {
            const filled = i < joined;
            return (
              <div key={s.name} className="flex flex-col items-center gap-1.5">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-full text-[11px] font-bold ${
                    filled ? `${s.tone} text-white animate-seat-fill` : "border-2 border-dashed border-slate-300 text-slate-300"
                  }`}
                  style={filled ? { animationDelay: `${i * 60}ms` } : undefined}
                >
                  {filled ? s.initials : i + 1}
                </div>
                <span className={`text-[10px] font-semibold ${filled ? "text-slate-700" : "text-slate-300"}`}>{filled ? s.name : "Open"}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={joined}>
          <div className="h-full rounded-full bg-gradient-to-r from-fairway-500 to-fairway-700 transition-[width] duration-700 ease-out" style={{ width: `${(joined / 4) * 100}%` }} />
        </div>

        <div className="mt-4 flex items-center gap-2">
          {full ? (
            <button type="button" onClick={reset} className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-slate-200 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50">
              <RotateCcw size={14} /> {t("landing.demo.replay")}
            </button>
          ) : (
            <button type="button" onClick={join} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-fairway-900 py-2.5 text-sm font-bold text-white shadow-md shadow-fairway-900/20 transition hover:-translate-y-px hover:bg-fairway-800">
              {joined === 2 ? "Join Round" : "Joining…"}
            </button>
          )}
        </div>
        <p className={`mt-3 min-h-[1.25rem] text-center text-xs font-medium transition ${toast ? "text-fairway-800" : "text-transparent"}`} aria-live="polite">
          {toast ?? " "}
        </p>
      </div>
    </div>
  );
}

// ── Caddie: run an analysis ─────────────────────────────────────────────

type Phase = "idle" | "uploading" | "pose" | "scoring" | "done";

const FEEDBACK = ["Strong tempo through transition.", "Hips open slightly early at the top.", "Try: hold the turn one beat longer."];

// The golfer's motion lives in ./swingMotion (pure math: key poses traced
// from a real swing, each limb rotated about its parent joint along a
// smooth spline). This file only draws it.
type Joint = JointName;
const JOINTS = JOINT_NAMES;

// Drives the swing loop with requestAnimationFrame while `playing`; when
// paused it rests at the top of the backswing (where the angle callouts
// are measured). First render is the top pose too, so the prerender shows
// a finished-looking frame. This deliberately does NOT stop under
// prefers-reduced-motion: the swing is the content of this demo, not
// decoration, and it is small and slow (one swing every ~3.5 s).
function useSwingPose(playing: boolean): { pose: Pose; progress: number } {
  const [state, setState] = useState<{ pose: Pose; progress: number }>({ pose: TOP_POSE, progress: TOP_T });
  useEffect(() => {
    if (!playing) {
      setState({ pose: TOP_POSE, progress: TOP_T });
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) % SWING_MS) / SWING_MS;
      setState({ pose: samplePose(t), progress: t });
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [playing]);
  return state;
}

const BONES: [Joint, Joint][] = [
  ["head", "neck"],
  ["neck", "shL"],
  ["neck", "shR"],
  ["shL", "elL"],
  ["elL", "hands"],
  ["shR", "elR"],
  ["elR", "hands"],
  ["shL", "hipL"],
  ["shR", "hipR"],
  ["hipL", "hipR"],
  ["hipL", "kneeL"],
  ["kneeL", "ankL"],
  ["hipR", "kneeR"],
  ["kneeR", "ankR"],
];
const PHASES = ["Address", "Top", "Impact", "Finish"];

// ── mannequin rendering ─────────────────────────────────────────────────
// A glossy studio mannequin on a dark stage (after the "swing decoded"
// style): every limb is a shaded capsule lit from the upper left, joints
// are ball joints, the floor reflects the figure, and the club leaves a
// fan of positions coloured by clubhead speed. Everything is drawn from
// the rig in ./swingMotion. No SVG filters, masks or CSS transform
// animations on anything that moves (they caused lag/ghosting before).

const FLOOR_Y = 246; // scene y of the stage floor
// The rig's figure box -> scene: scaled and placed so the whole club arc
// (backswing up past the head, follow-through out to the right) stays on
// the stage with the feet on the floor.
const FIG_S = 0.86;
const FIG_DX = 62;
const FIG_DY = 41;
const FIG_T = `translate(${FIG_DX} ${FIG_DY}) scale(${FIG_S})`;
const toScene = (q: Pt): Pt => [q[0] * FIG_S + FIG_DX, q[1] * FIG_S + FIG_DY];
const LIGHT = [-0.6, -0.8]; // direction the light comes FROM (unit-ish)

// Club fan: every club position over one swing, precomputed once, with the
// clubhead speed between samples (for colour).
const FAN_STEP = 0.0015; // fine enough that the traced arc is a smooth curve, not a polygon
const FAN: { t: number; hands: Pt; club: Pt; speed: number }[] = (() => {
  const out: { t: number; hands: Pt; club: Pt; speed: number }[] = [];
  let prev: Pt | null = null;
  for (let t = 0; t <= TRACE_END_T; t += FAN_STEP) {
    const p = samplePose(t);
    const speed = prev ? Math.hypot(p.club[0] - prev[0], p.club[1] - prev[1]) : 0;
    out.push({ t, hands: p.hands, club: p.club, speed });
    prev = p.club;
  }
  return out;
})();
const FAN_MAX = Math.max(...FAN.map((f) => f.speed)) || 1;
// Clubhead speed -> one of a few colour bands: green (slow) -> gold -> coral.
const BAND_COLOURS = ["#4ade80", "#86d36a", "#c4c454", "#f4b942", "#f6935a", "#f87171"];
const speedBand = (v: number) => Math.min(BAND_COLOURS.length - 1, Math.floor((v / FAN_MAX) * BAND_COLOURS.length));

// A capsule (rounded limb) from a to b with radius r: a rounded bar drawn
// along +x in its own frame and rotated into place, filled with ONE shared
// gradient (#mq-limb, light edge at the top of the bar). If the bar's top
// would face away from the light it is mirrored, so every limb is lit from
// the upper left. No per-frame gradient definitions — creating ~30 new
// gradients every frame dropped the page to ~27 fps.
function Capsule({ a, b, r }: { a: Pt; b: Pt; r: number }) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  const th = Math.atan2(dy, dx);
  // the bar's local "up" (0,-1) in world space is (sin th, -cos th)
  const flip = Math.sin(th) * LIGHT[0] - Math.cos(th) * LIGHT[1] < 0 ? -1 : 1;
  return (
    <rect
      x={-r}
      y={-r}
      width={L + 2 * r}
      height={2 * r}
      rx={r}
      fill="url(#mq-limb)"
      transform={`translate(${a[0]} ${a[1]}) rotate(${(th * 180) / Math.PI}) scale(1 ${flip})`}
    />
  );
}
const Ball = ({ c, r }: { c: Pt; r: number }) => <circle cx={c[0]} cy={c[1]} r={r} fill="url(#mq-ball)" />;

function Mannequin({ J, clubInFront }: { J: Pose; clubInFront: boolean }) {
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const hipC = mid(J.hipL, J.hipR);
  const chest = mid(J.shL, J.shR);
  const headAng = (Math.atan2(J.head[1] - J.neck[1], J.head[0] - J.neck[0]) * 180) / Math.PI + 90;
  const club = (
    <g>
      <line x1={J.hands[0]} y1={J.hands[1]} x2={J.club[0]} y2={J.club[1]} stroke="#d7dcd8" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx={J.club[0]} cy={J.club[1]} r="4.5" fill="#2a2f2c" stroke="#9aa39c" strokeWidth="1" />
    </g>
  );
  return (
    <g>
      {!clubInFront && club}
      {/* legs (trail leg behind) */}
      <Capsule a={J.hipL} b={J.kneeL} r={7.4} />
      <Capsule a={J.kneeL} b={J.ankL} r={5.8} />
      <Ball c={J.kneeL} r={6.2} />
      <ellipse cx={J.ankL[0] - 3} cy={J.ankL[1] + 5} rx="10" ry="4.5" fill="url(#mq-ball)" />
      <Capsule a={J.hipR} b={J.kneeR} r={7.4} />
      <Capsule a={J.kneeR} b={J.ankR} r={5.8} />
      <Ball c={J.kneeR} r={6.2} />
      <ellipse cx={J.ankR[0] + 3} cy={J.ankR[1] + 5} rx="10" ry="4.5" fill="url(#mq-ball)" />
      {/* pelvis + torso */}
      <Capsule a={J.hipL} b={J.hipR} r={7.5} />
      <Capsule a={hipC} b={[(hipC[0] + chest[0]) / 2, (hipC[1] + chest[1]) / 2]} r={7.5} />
      <path
        d={`M${J.shL[0]} ${J.shL[1]} Q${chest[0]} ${chest[1] - 6} ${J.shR[0]} ${J.shR[1]} Q${J.shR[0] + 2} ${(J.shR[1] + hipC[1]) / 2} ${(chest[0] + hipC[0]) / 2 + 10} ${(chest[1] + hipC[1]) / 2 + 6} L${(chest[0] + hipC[0]) / 2 - 10} ${(chest[1] + hipC[1]) / 2 + 6} Q${J.shL[0] - 2} ${(J.shL[1] + hipC[1]) / 2} ${J.shL[0]} ${J.shL[1]} Z`}
        fill="url(#mq-chest)"
      />
      <Ball c={J.hipL} r={6.5} />
      <Ball c={J.hipR} r={6.5} />
      {/* neck + head */}
      <Capsule a={J.neck} b={mid(J.neck, J.head)} r={4.5} />
      <ellipse cx={J.head[0]} cy={J.head[1]} rx="10.5" ry="13" fill="url(#mq-ball)" transform={`rotate(${headAng} ${J.head[0]} ${J.head[1]})`} />
      {/* arms (trail arm behind the lead arm) */}
      <Ball c={J.shL} r={6.6} />
      <Capsule a={J.shL} b={J.elL} r={5} />
      <Capsule a={J.elL} b={J.hands} r={4.2} />
      <Ball c={J.elL} r={4.6} />
      <Ball c={J.shR} r={6.6} />
      <Capsule a={J.shR} b={J.elR} r={5} />
      <Capsule a={J.elR} b={J.hands} r={4.2} />
      <Ball c={J.elR} r={4.6} />
      <Ball c={J.hands} r={4.8} />
      {clubInFront && club}
    </g>
  );
}

const CAPTIONS: Record<Phase, { text: string; accent: boolean }> = {
  idle: { text: "YOUR SWING, DECODED.", accent: false },
  uploading: { text: "READING YOUR SWING", accent: false },
  pose: { text: "TRACKING YOUR BODY", accent: false },
  scoring: { text: "MEASURING EVERY POSITION", accent: false },
  done: { text: "HIPS OPEN EARLY AT THE TOP.", accent: true },
};

// Typewriter caption: retypes whenever the phase changes.
function useTyped(text: string): string {
  const [n, setN] = useState(text.length);
  useEffect(() => {
    setN(0);
    const id = window.setInterval(() => setN((k) => (k >= text.length ? k : k + 1)), 38);
    return () => window.clearInterval(id);
  }, [text]);
  return text.slice(0, n);
}

function SwingScene({ phase, pose, progress }: { phase: Phase; pose: Pose; progress: number }) {
  const J = pose;
  const showPose = phase === "pose" || phase === "scoring" || phase === "done";
  const showAngles = phase === "scoring" || phase === "done";
  const op = swingOpacity(progress);
  const caption = CAPTIONS[phase];
  const typed = useTyped(caption.text);
  // Ball: on the tee until impact, in flight briefly, then gone until the
  // loop fades back in at address.
  const ballOnTee = progress < IMPACT_T || progress >= RETURN_MID;
  const ballStruck = progress > IMPACT_T && progress < IMPACT_T + 0.18;
  // Club in front of the body while the hands are low (address through the
  // follow-through), behind it at the top and the finish.
  const clubInFront = J.hands[1] > J.neck[1] + 28;
  const fanPaths = useMemo(() => {
    const fan = progress < RETURN_MID ? FAN.filter((f) => f.t <= progress) : [];
    const arcs: string[] = BAND_COLOURS.map(() => "");
    fan.forEach((f, i) => {
      if (i > 0) {
        const p = fan[i - 1].club;
        arcs[speedBand(f.speed)] += `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${f.club[0].toFixed(1)} ${f.club[1].toFixed(1)}`;
      }
    });
    return { arcs };
  }, [progress]);
  const hipC: Pt = toScene([(J.hipL[0] + J.hipR[0]) / 2, (J.hipL[1] + J.hipR[1]) / 2]);
  return (
    <svg viewBox="0 0 400 300" className="h-full w-full" role="img" aria-label="A mannequin golfer swinging on a dark stage, with Caddie's pose analysis overlay">
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
        <linearGradient id="mq-limb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.3" stopColor="#eef1ec" />
          <stop offset="0.75" stopColor="#a9b3ad" />
          <stop offset="1" stopColor="#6f7a74" />
        </linearGradient>
        <radialGradient id="mq-chest" cx="0.38" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#dfe4df" />
          <stop offset="1" stopColor="#8d9791" />
        </radialGradient>
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
        <clipPath id="gm-clip">
          <rect width="400" height="300" />
        </clipPath>
      </defs>

      <g clipPath="url(#gm-clip)">
        {/* stage: spotlight from above, floor, light pool */}
        <rect width="400" height="300" fill="url(#mq-stage)" />
        <path d="M128 -10 L213 -10 L293 250 L48 250 Z" fill="url(#mq-cone)" />
        <ellipse cx="158" cy={FLOOR_Y + 4} rx="110" ry="14" fill="url(#mq-pool)" />
        <line x1="0" y1={FLOOR_Y} x2="400" y2={FLOOR_Y} stroke="#ffffff" strokeOpacity="0.06" />

        {/* reflection: the figure mirrored in the floor, then the floor
            gradient painted over it so it fades out with depth */}
        <g transform={`translate(0 ${2 * FLOOR_Y}) scale(1 -1)`} opacity={0.22 * op}>
          <g transform={FIG_T}>
            <Mannequin J={J} clubInFront={clubInFront} />
          </g>
        </g>
        <rect x="0" y={FLOOR_Y} width="400" height={300 - FLOOR_Y} fill="url(#mq-floor)" />

        {/* typewriter caption */}
        <text x="200" y="26" textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="10.5" fontWeight="700" letterSpacing="1.2" fill={caption.accent ? "#f87171" : "#e8ece9"}>
          {typed}
          <tspan fill={caption.accent ? "#f87171" : "#e8ece9"} opacity={typed.length < caption.text.length ? 1 : 0.6}>
            ▍
          </tspan>
        </text>

        {/* ball on the tee (gone after impact until the next address) */}
        {ballOnTee && <circle cx={toScene(BALL)[0]} cy={toScene(BALL)[1]} r="3" fill="#f8faf8" />}
        {ballStruck && <circle cx={toScene(BALL)[0] + (progress - IMPACT_T) * 900} cy={toScene(BALL)[1] - (progress - IMPACT_T) * 1100} r="2.4" fill="#f8faf8" opacity="0.9" />}

        <g transform={FIG_T} opacity={op}>
          {/* the arc the clubhead has traced so far this swing, coloured by
              speed (one path per colour band, so it stays cheap) */}
          {fanPaths.arcs.map((d, band) => (d ? <path key={band} d={d} stroke={BAND_COLOURS[band]} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.75" /> : null))}
          <Mannequin J={J} clubInFront={clubInFront} />
        </g>

        {/* coaching glow on the hips once the analysis lands */}
        {phase === "done" && <circle cx={hipC[0]} cy={hipC[1] - 4} r="30" fill="url(#mq-heat)" className="animate-halo-pulse" opacity={op} />}

        {/* pose overlay */}
        {showPose && (
          // No CSS transform animations or SVG filters anywhere in this
          // overlay (they lagged / ghosted on moving joints in Chrome).
          <g transform={FIG_T} className="animate-fade-in" opacity={op}>
            {BONES.map(([a, b]) => (
              <line key={`${a}-${b}`} x1={J[a][0]} y1={J[a][1]} x2={J[b][0]} y2={J[b][1]} stroke="url(#gm-bone)" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
            ))}
            {JOINTS.map((k) => (
              <g key={k} transform={`translate(${J[k][0]} ${J[k][1]})`}>
                <circle cx="0" cy="0" r="5.5" fill="#f4b942" opacity="0.18" />
                <circle cx="0" cy="0" r="3.4" fill="#f4b942" />
                <circle cx="0" cy="0" r="1.4" fill="#fff7e0" />
              </g>
            ))}
          </g>
        )}

        {/* angle callouts */}
        {showAngles && (
          <g className="animate-fade-in" fontFamily="Inter, system-ui, sans-serif" fontWeight="700">
            {[
              { x: 252, y: 58, label: "Shoulder turn", value: "94°", ok: true },
              { x: 252, y: 128, label: "Hip turn", value: "46°", ok: false },
              { x: 252, y: 198, label: "Knee flex", value: "22°", ok: true },
            ].map((c) => (
              <g key={c.label}>
                <rect x={c.x - 10} y={c.y - 2} width="140" height="26" rx="13" fill="#0b1a10" fillOpacity="0.85" stroke={c.ok ? "#4ade80" : "#f87171"} strokeOpacity="0.7" />
                <text x={c.x} y={c.y + 15} fontSize="10" fill="#dcfce7" fontWeight="500">
                  {c.label}
                </text>
                <text x={c.x + 122} y={c.y + 15} fontSize="11" fill={c.ok ? "#86efac" : "#fca5a5"} textAnchor="end">
                  {c.value}
                </text>
              </g>
            ))}
          </g>
        )}
      </g>
    </svg>
  );
}

export function CaddieDemo() {
  const { t } = useLocale();
  const [phase, setPhase] = useState<Phase>("idle");
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const run = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    setPhase("uploading");
    const steps: [Phase, number][] = [
      ["pose", 1000],
      ["scoring", 2600],
      ["done", 4000],
    ];
    steps.forEach(([p, ms]) => timers.current.push(window.setTimeout(() => setPhase(p), ms)));
  };
  const reset = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    setPhase("idle");
  };

  const stepLabel: Record<Phase, string> = {
    idle: "Ready to analyze",
    uploading: "Uploading 7-iron swing…",
    pose: "Detecting body positions",
    scoring: "Scoring the swing",
    done: "Analysis saved to your history",
  };
  const stepIndex = ["uploading", "pose", "scoring", "done"].indexOf(phase);
  // The figure keeps swinging in every state; the pose overlay tracks it
  // frame by frame and the callouts sit alongside.
  const { pose, progress } = useSwingPose(true);
  // Scrubber: follows the swing while it plays (address -> finish spans
  // the first 72% of the cycle), parks on "Top" once the result is in.
  // Scrubber: piecewise map of the cycle onto the four evenly spaced phase
  // ticks (Address 0, Top 1/3, Impact 2/3, Finish 1), so the playhead sits
  // on "Top" exactly when the figure is at the top, etc.
  const marks: [number, number][] = [
    [0, 0],
    [TOP_T, 100 / 3],
    [IMPACT_T, 200 / 3],
    [FINISH_T, 100],
  ];
  const mapPlayhead = (t: number) => {
    for (let i = 0; i < marks.length - 1; i++) {
      const [ta, pa] = marks[i];
      const [tb, pb] = marks[i + 1];
      if (t <= tb) return pa + ((Math.max(t, ta) - ta) / (tb - ta)) * (pb - pa);
    }
    return 100;
  };
  const playhead = mapPlayhead(progress);

  const metrics = [
    { label: "Tempo", value: "3.1 : 1", pct: 86, ok: true },
    { label: "Shoulder turn", value: "94°", pct: 90, ok: true },
    { label: "Hip timing", value: "early", pct: 58, ok: false },
  ];

  return (
    <div className="mx-auto w-full max-w-md">
      <p className="mb-3 text-xs font-bold text-sun-300">{t("landing.demo.tryIt")}</p>
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0b1a10] shadow-2xl shadow-black/40 ring-1 ring-white/5">
        {/* video frame */}
        <div className="relative aspect-[4/3]">
          <SwingScene phase={phase} pose={pose} progress={progress} />
          {phase === "uploading" && <div aria-hidden="true" className="absolute inset-x-0 h-px bg-sun-300/90 shadow-[0_0_14px_3px_rgba(246,201,111,0.6)] animate-scan" />}
          {(phase === "uploading" || phase === "pose") && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:24px_24px]" />
          )}
          {phase === "done" && (
            <div className="absolute right-3 top-3 rounded-2xl bg-white/95 p-2 text-slate-900 shadow-lg animate-pop">
              <ScoreRing score={81} size={72} />
            </div>
          )}
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
            <Video size={12} /> 7 Iron · 0:04
          </div>
          {phase !== "idle" && phase !== "done" && (
            <div className="absolute left-3 top-10 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-semibold text-fairway-200 backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" /> {phase === "pose" ? "POSE DETECTION" : "LIVE"}
            </div>
          )}
          {/* scrubber with swing phases */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8">
            <div className="relative h-1.5 rounded-full bg-white/20">
              <div className="h-full rounded-full bg-sun-300 transition-[width] duration-700 ease-out" style={{ width: `${playhead}%` }} />
              {PHASES.map((p, i) => (
                <span key={p} aria-hidden="true" className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-white/50" style={{ left: `${(i / (PHASES.length - 1)) * 100}%` }} />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[9.5px] font-semibold uppercase tracking-wider text-white/70">
              {PHASES.map((p, i) => (
                <span key={p} className={Math.abs(playhead - (i / (PHASES.length - 1)) * 100) < 17 ? "text-sun-300" : ""}>
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* status, metrics, feedback */}
        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-white" aria-live="polite">
              {phase === "done" ? <Check size={15} className="text-fairway-300" /> : phase === "idle" ? <Sparkles size={15} className="text-sun-300" /> : <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sun-300 border-t-transparent" />}
              {stepLabel[phase]}
            </p>
            <div className="flex gap-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`h-1.5 w-6 rounded-full transition ${stepIndex > i ? "bg-fairway-400" : "bg-white/15"}`} />
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {metrics.map((m, i) => {
              const live = phase === "done";
              return (
                <div key={m.label} className={`rounded-2xl border p-2.5 transition ${live ? "border-white/10 bg-white/5" : "border-white/5 bg-white/[0.03]"}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-fairway-200/70">{m.label}</p>
                  <p className={`mt-1 text-base font-extrabold tabular-nums ${live ? (m.ok ? "text-white" : "text-sun-300") : "text-white/25"}`}>{live ? m.value : "—"}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                    <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${m.ok ? "bg-fairway-400" : "bg-sun-400"}`} style={{ width: live ? `${m.pct}%` : "0%", transitionDelay: `${i * 120}ms` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <ul className="mt-4 min-h-[4.5rem] space-y-1.5 text-sm text-fairway-100">
            {phase === "done" ? (
              FEEDBACK.map((line, i) => (
                <li key={line} className="flex items-start gap-2 animate-slide-up" style={{ animationDelay: `${i * 220}ms`, animationFillMode: "backwards" }}>
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sun-300" /> {line}
                </li>
              ))
            ) : (
              <li className="text-fairway-200/70">{phase === "idle" ? "Caddie tracks your body positions through the swing, scores it out of 100 and tells you what to work on." : "Working…"}</li>
            )}
          </ul>
          <div className="mt-4 flex gap-2">
            {phase === "idle" ? (
              <button type="button" onClick={run} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-sun-400 py-2.5 text-sm font-bold text-fairway-950 shadow-md transition hover:-translate-y-px hover:bg-sun-300">
                <Play size={14} /> Analyze a Swing
              </button>
            ) : phase === "done" ? (
              <button type="button" onClick={reset} className="flex flex-1 items-center justify-center gap-2 rounded-full border border-white/20 py-2.5 text-sm font-bold text-white transition hover:bg-white/10">
                <RotateCcw size={14} /> {t("landing.demo.replay")}
              </button>
            ) : (
              <button type="button" disabled className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white/10 py-2.5 text-sm font-bold text-white/60">
                Analyzing…
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[11px] text-fairway-200/60">{t("landing.caddie.ringCaption")}</p>
    </div>
  );
}

// ── NYC: course ticker ──────────────────────────────────────────────────

export function CourseTicker({ items }: { items: string[] }) {
  const doubled = [...items, ...items];
  return (
    // The track is absolutely positioned inside a fixed-height box so its
    // (very wide) intrinsic width never reaches the grid column — a block
    // child with overflow:hidden still contributes its full content width
    // to a grid item's min-content size, which stretched the whole page.
    <div className="relative mt-3 h-12 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]" aria-hidden="true">
      <div className="absolute left-0 top-0 flex h-full w-max items-center gap-3 px-3 animate-marquee hover:[animation-play-state:paused]">
        {doubled.map((c, i) => (
          <span key={`${c}-${i}`} className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-fairway-50 px-3 py-1 text-sm font-medium text-fairway-800">
            <span className="h-1.5 w-1.5 rounded-full bg-fairway-500" /> {c}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Mobile: floating App Store bar after the hero ───────────────────────

export function FloatingCta() {
  const { t } = useLocale();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > 640);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-all duration-300 sm:hidden ${
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
      }`}
    >
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-fairway-950/95 p-2.5 pl-4 text-white shadow-2xl shadow-black/40 backdrop-blur">
        <span className="text-sm font-bold">{t("landing.cta.floating")}</span>
        <AppStoreButton size="sm" placement="floating" />
      </div>
    </div>
  );
}

// ── Nav: which section is on screen ─────────────────────────────────────

export function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.2, 0.5] },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);
  return active;
}

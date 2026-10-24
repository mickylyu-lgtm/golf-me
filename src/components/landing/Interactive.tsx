import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { Check, Play, RotateCcw, Sparkles, Target, Users, Video } from "lucide-react";
import { CaddieNavIcon } from "../icons/CaddieNavIcon";
import { AppStoreButton } from "./AppStoreButton";
import { DEFAULT_MOCK_GOLFERS, GolfersScreen, PhoneFrame, RoundsScreen, CaddieScreen, ScoreRing } from "./PhoneMock";
import type { MockGolfer } from "./PhoneMock";
import { useLocale } from "../../i18n/LocaleContext";

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

// Face-on golfer in a 200x260 box, as four key poses of one swing. Limbs
// are thick round-capped strokes between joints, so the same joint table
// drives both the drawn figure and Caddie's pose overlay — the skeleton
// tracks the moving body exactly. The scene tweens between poses with an
// ease on each segment (useSwingPose below).
type Pose = Record<Joint, readonly [number, number]> & { club: readonly [number, number] };
type JointName =
  | "head" | "neck" | "shL" | "shR" | "elL" | "elR" | "hands"
  | "hipL" | "hipR" | "kneeL" | "kneeR" | "ankL" | "ankR";
type Joint = JointName;

const POSE_ADDRESS: Pose = {
  head: [100, 46], neck: [100, 66], shL: [78, 76], shR: [122, 76],
  elL: [84, 108], elR: [116, 108], hands: [100, 142],
  hipL: [84, 134], hipR: [116, 134], kneeL: [76, 182], kneeR: [124, 182], ankL: [66, 232], ankR: [134, 232],
  club: [62, 238],
};
const POSE_TOP: Pose = {
  head: [104, 40], neck: [104, 62], shL: [82, 70], shR: [126, 70],
  elL: [114, 58], elR: [146, 76], hands: [150, 44],
  hipL: [88, 134], hipR: [120, 134], kneeL: [80, 182], kneeR: [128, 182], ankL: [70, 232], ankR: [140, 232],
  club: [60, 14],
};
const POSE_IMPACT: Pose = {
  head: [100, 44], neck: [100, 64], shL: [80, 74], shR: [122, 70],
  elL: [92, 106], elR: [122, 102], hands: [102, 142],
  hipL: [90, 132], hipR: [118, 128], kneeL: [80, 182], kneeR: [124, 182], ankL: [66, 232], ankR: [134, 232],
  club: [60, 238],
};
const POSE_FINISH: Pose = {
  head: [96, 40], neck: [98, 62], shL: [84, 74], shR: [118, 70],
  elL: [72, 52], elR: [86, 40], hands: [60, 36],
  hipL: [92, 132], hipR: [116, 130], kneeL: [82, 182], kneeR: [116, 180], ankL: [68, 232], ankR: [128, 226],
  club: [116, -6],
};
// (pose, time in the cycle 0..1). Address -> top is the slow part,
// top -> impact the fast part, then the finish holds before resetting.
const SWING: [Pose, number][] = [
  [POSE_ADDRESS, 0],
  [POSE_TOP, 0.38],
  [POSE_IMPACT, 0.56],
  [POSE_FINISH, 0.72],
  [POSE_FINISH, 0.86],
  [POSE_ADDRESS, 1],
];
const SWING_MS = 3200;
const JOINTS = Object.keys(POSE_TOP).filter((k) => k !== "club") as Joint[];

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function tweenPose(t: number): Pose {
  for (let i = 0; i < SWING.length - 1; i++) {
    const [a, ta] = SWING[i];
    const [b, tb] = SWING[i + 1];
    if (t >= ta && t <= tb) {
      const k = tb === ta ? 0 : easeInOut((t - ta) / (tb - ta));
      const out = {} as Record<string, readonly [number, number]>;
      for (const key of [...JOINTS, "club"] as (Joint | "club")[]) {
        out[key] = [a[key][0] + (b[key][0] - a[key][0]) * k, a[key][1] + (b[key][1] - a[key][1]) * k];
      }
      return out as Pose;
    }
  }
  return POSE_ADDRESS;
}

// Drives the swing loop with requestAnimationFrame while `playing`; when
// paused it rests at the top of the backswing (where the angle callouts
// are measured). First render is the top pose too, so the prerender shows
// a finished-looking frame. Reduced-motion users get the still frame.
function useSwingPose(playing: boolean): { pose: Pose; progress: number } {
  const [state, setState] = useState<{ pose: Pose; progress: number }>({ pose: POSE_TOP, progress: 0.38 });
  useEffect(() => {
    if (!playing || prefersReducedMotion()) {
      setState({ pose: POSE_TOP, progress: 0.38 });
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) % SWING_MS) / SWING_MS;
      setState({ pose: tweenPose(t), progress: t });
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

function SwingScene({ phase, pose, progress }: { phase: Phase; pose: Pose; progress: number }) {
  const J = pose;
  const showPose = phase === "pose" || phase === "scoring" || phase === "done";
  const showAngles = phase === "scoring" || phase === "done";
  const ballStruck = phase !== "done" && progress > 0.56 && progress < 0.98;
  const limb = (a: Joint, b: Joint, w: number) => (
    <line key={`${a}${b}`} x1={J[a][0]} y1={J[a][1]} x2={J[b][0]} y2={J[b][1]} stroke="url(#gm-body)" strokeWidth={w} strokeLinecap="round" />
  );
  // Club: shaft from the hands toward the pose's club point, head at the end.
  const [cx, cy] = J.club;
  const ang = Math.atan2(cy - J.hands[1], cx - J.hands[0]);
  const len = Math.hypot(cx - J.hands[0], cy - J.hands[1]);
  const hx = J.hands[0] + Math.cos(ang) * (len - 6);
  const hy = J.hands[1] + Math.sin(ang) * (len - 6);
  return (
    <svg viewBox="0 0 400 300" className="h-full w-full" role="img" aria-label="Illustration of a golfer at the top of the backswing with Caddie's pose analysis overlay">
      <defs>
        <linearGradient id="gm-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b2a18" />
          <stop offset="0.55" stopColor="#1b4a2d" />
          <stop offset="1" stopColor="#3f8a4a" />
        </linearGradient>
        <radialGradient id="gm-sun" cx="0.78" cy="0.42" r="0.45">
          <stop offset="0" stopColor="#f6c96f" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#f4b942" stopOpacity="0.12" />
          <stop offset="1" stopColor="#f4b942" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gm-grass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2e8f45" />
          <stop offset="1" stopColor="#176a30" />
        </linearGradient>
        <linearGradient id="gm-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1c2e24" />
          <stop offset="1" stopColor="#060f0a" />
        </linearGradient>
        <linearGradient id="gm-bone" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#bbf7d0" />
          <stop offset="1" stopColor="#4ade80" />
        </linearGradient>
        <filter id="gm-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="gm-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <clipPath id="gm-clip">
          <rect width="400" height="300" rx="0" />
        </clipPath>
      </defs>

      <g clipPath="url(#gm-clip)">
        {/* sky + low sun */}
        <rect width="400" height="300" fill="url(#gm-sky)" />
        <rect width="400" height="300" fill="url(#gm-sun)" />
        <circle cx="312" cy="126" r="26" fill="#f6c96f" opacity="0.9" />
        <circle cx="312" cy="126" r="44" fill="#f6c96f" opacity="0.12" filter="url(#gm-soft)" />
        {/* distant treeline */}
        <g fill="#0d2d1a" opacity="0.9">
          <ellipse cx="40" cy="182" rx="60" ry="26" />
          <ellipse cx="110" cy="176" rx="48" ry="30" />
          <ellipse cx="330" cy="184" rx="70" ry="24" />
          <ellipse cx="390" cy="178" rx="50" ry="30" />
        </g>
        <g fill="#123b22">
          <ellipse cx="70" cy="190" rx="54" ry="18" />
          <ellipse cx="350" cy="192" rx="62" ry="16" />
        </g>
        {/* fairway with mown stripes, in perspective */}
        <rect x="0" y="196" width="400" height="104" fill="url(#gm-grass)" />
        <g fill="#ffffff" opacity="0.07">
          <path d="M-20 300 L60 196 L92 196 L40 300 Z" />
          <path d="M100 300 L150 196 L182 196 L160 300 Z" />
          <path d="M220 300 L240 196 L272 196 L280 300 Z" />
          <path d="M340 300 L330 196 L362 196 L400 300 Z" />
        </g>
        {/* flag on the far green */}
        <g>
          <ellipse cx="250" cy="206" rx="34" ry="5" fill="#4fc169" opacity="0.6" />
          <line x1="250" y1="206" x2="250" y2="168" stroke="#f8faf8" strokeWidth="1.5" />
          <path d="M250 168 L268 174 L250 180 Z" fill="#f4b942" />
        </g>
        {/* tee box glow + shadow */}
        <ellipse cx="105" cy="250" rx="54" ry="9" fill="#031208" opacity="0.5" filter="url(#gm-soft)" />

        {/* ball on the tee (gone after impact until the next address) */}
        {!ballStruck && <circle cx="62" cy="241" r="3.2" fill="#f8faf8" />}
        {ballStruck && <circle cx={62 + (progress - 0.56) * 420} cy={241 - (progress - 0.56) * 520} r="2.6" fill="#f8faf8" opacity="0.9" />}

        {/* golfer: club first so the shaft sits behind the body */}
        <g transform="translate(0 6)">
          <line x1={J.hands[0]} y1={J.hands[1]} x2={hx} y2={hy} stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
          <ellipse cx={hx} cy={hy} rx="7" ry="4" fill="#1f2937" stroke="#9ca3af" strokeWidth="1" transform={`rotate(${(ang * 180) / Math.PI + 90} ${hx} ${hy})`} />
          {/* torso */}
          <path
            d={`M${J.shL[0]} ${J.shL[1] - 4} C${J.shL[0] - 4} ${(J.shL[1] + J.hipL[1]) / 2} ${J.hipL[0] - 6} ${J.hipL[1] - 18} ${J.hipL[0]} ${J.hipL[1] + 4} L${J.hipR[0]} ${J.hipR[1] + 4} C${J.hipR[0] + 6} ${J.hipR[1] - 18} ${J.shR[0] + 4} ${(J.shR[1] + J.hipR[1]) / 2} ${J.shR[0]} ${J.shR[1] - 4} Z`}
            fill="url(#gm-body)"
          />
          {/* legs */}
          {limb("hipL", "kneeL", 17)}
          {limb("kneeL", "ankL", 15)}
          {limb("hipR", "kneeR", 17)}
          {limb("kneeR", "ankR", 15)}
          {/* shoes */}
          <ellipse cx={J.ankL[0] - 2} cy={J.ankL[1] + 6} rx="15" ry="6" fill="#0a1510" />
          <ellipse cx={J.ankR[0] + 4} cy={J.ankR[1] + 6} rx="15" ry="6" fill="#0a1510" />
          {/* arms */}
          {limb("shL", "elL", 13)}
          {limb("elL", "hands", 12)}
          {limb("shR", "elR", 13)}
          {limb("elR", "hands", 12)}
          <circle cx={J.hands[0]} cy={J.hands[1]} r="8" fill="#0d1a12" />
          {/* head + cap */}
          <circle cx={J.head[0]} cy={J.head[1]} r="15" fill="url(#gm-body)" />
          <path d={`M${J.head[0] - 17} ${J.head[1] - 4} C${J.head[0] - 12} ${J.head[1] - 18} ${J.head[0] + 14} ${J.head[1] - 18} ${J.head[0] + 18} ${J.head[1] - 4} Z`} fill="#0b1a10" />
          <path d={`M${J.head[0] - 18} ${J.head[1] - 3} L${J.head[0] + 22} ${J.head[1] - 3} L${J.head[0] + 26} ${J.head[1] + 1} L${J.head[0] - 20} ${J.head[1] + 1} Z`} fill="#0b1a10" />
          {/* rim light from the sun */}
          <path d={`M${J.shR[0]} ${J.shR[1]} C${J.shR[0] + 4} ${J.shR[1] + 22} ${J.hipR[0] + 8} ${J.hipR[1] - 16} ${J.hipR[0]} ${J.hipR[1] + 4}`} stroke="#f6c96f" strokeWidth="2" strokeOpacity="0.35" fill="none" strokeLinecap="round" />
          <line x1={J.kneeR[0]} y1={J.kneeR[1]} x2={J.ankR[0]} y2={J.ankR[1]} stroke="#f6c96f" strokeWidth="2" strokeOpacity="0.3" strokeLinecap="round" />
        </g>

        {/* pose overlay */}
        {showPose && (
          <g transform="translate(0 6)" className="animate-pop">
            {BONES.map(([a, b]) => (
              <line key={`${a}-${b}`} x1={J[a][0]} y1={J[a][1]} x2={J[b][0]} y2={J[b][1]} stroke="url(#gm-bone)" strokeWidth="2.4" strokeLinecap="round" opacity="0.95" />
            ))}
            {JOINTS.map((k, i) => (
              <g key={k} filter="url(#gm-glow)">
                <circle cx={J[k][0]} cy={J[k][1]} r="4.6" fill="#f4b942" className="animate-pose-pulse" style={{ animationDelay: `${i * 70}ms`, transformBox: "fill-box", transformOrigin: "center" }} />
                <circle cx={J[k][0]} cy={J[k][1]} r="1.8" fill="#fff7e0" />
              </g>
            ))}
            {/* spine + shoulder + hip guides */}
            <line x1={J.neck[0]} y1={J.neck[1]} x2={(J.hipL[0] + J.hipR[0]) / 2} y2={(J.hipL[1] + J.hipR[1]) / 2} stroke="#ffffff" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            <line x1={J.shL[0]} y1={J.shL[1]} x2={J.shR[0]} y2={J.shR[1]} stroke="#ffffff" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            <line x1={J.hipL[0]} y1={J.hipL[1]} x2={J.hipR[0]} y2={J.hipR[1]} stroke="#ffffff" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
          </g>
        )}

        {/* angle callouts */}
        {showAngles && (
          <g className="animate-slide-up" fontFamily="Inter, system-ui, sans-serif" fontWeight="700">
            {[
              { x: 178, y: 58, label: "Shoulder turn", value: "94°", ok: true },
              { x: 178, y: 128, label: "Hip turn", value: "46°", ok: true },
              { x: 178, y: 198, label: "Knee flex", value: "22°", ok: false },
            ].map((c) => (
              <g key={c.label}>
                <line x1={c.x - 14} y1={c.y + 10} x2={c.x - 44} y2={c.y + 10} stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1" />
                <rect x={c.x - 10} y={c.y - 2} width="112" height="26" rx="13" fill="#0b1a10" fillOpacity="0.85" stroke={c.ok ? "#4ade80" : "#f4b942"} strokeOpacity="0.6" />
                <text x={c.x} y={c.y + 15} fontSize="10" fill="#dcfce7" fontWeight="500">
                  {c.label}
                </text>
                <text x={c.x + 98} y={c.y + 15} fontSize="11" fill={c.ok ? "#86efac" : "#f6c96f"} textAnchor="end">
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
  // The figure swings continuously until the analysis lands, then rests at
  // the top of the backswing so the angle callouts match what's drawn.
  const { pose, progress } = useSwingPose(phase !== "done");
  // Scrubber: follows the swing while it plays (address -> finish spans
  // the first 72% of the cycle), parks on "Top" once the result is in.
  const playhead = phase === "done" ? 38 : Math.min(100, (progress / 0.72) * 100);

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

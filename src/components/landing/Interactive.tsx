import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { Check, Play, RotateCcw, Sparkles, Target, Users, Video } from "lucide-react";
import { CaddieNavIcon } from "../icons/CaddieNavIcon";
import { AppStoreButton } from "./AppStoreButton";
import { DEFAULT_MOCK_GOLFERS, GolfersScreen, PhoneFrame, RoundsScreen, CaddieScreen } from "./PhoneMock";
import type { MockGolfer } from "./PhoneMock";
import { useLocale } from "../../i18n/LocaleContext";
import { TOP_T, IMPACT_T, FINISH_T } from "./swingMotion";
import { FLOOR_Y, mountSwing } from "./swingRenderer";

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

// The golfer's motion lives in ./swingMotion (a 3D skeleton keyed in joint
// terms) and is drawn by ./swingRenderer, which animates the SVG directly
// rather than through React state (see the note there).
const PHASES = ["Address", "Top", "Impact", "Finish"];

const ANGLES = [
  { label: "Shoulder turn", value: "94°", ok: true },
  { label: "Hip turn", value: "46°", ok: false },
  { label: "Knee flex", value: "22°", ok: true },
];

// Compact score badge for the demo's header row (the large ScoreRing is
// too tall to sit beside the clip chips on a phone).
function ScoreBadge({ score, shown }: { score: number; shown: boolean }) {
  const c = 2 * Math.PI * 15;
  return (
    <div className={`flex shrink-0 items-center gap-1.5 rounded-full bg-white/95 py-1 pl-1 pr-2.5 text-slate-900 shadow-lg ${shown ? "animate-pop" : "invisible"}`} aria-hidden={!shown}>
      <svg viewBox="0 0 36 36" width="26" height="26" className="-rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r="15" fill="none" stroke="#e2e8f0" strokeWidth="4" />
        <circle cx="18" cy="18" r="15" fill="none" stroke="#16a34a" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <span className="text-base font-extrabold leading-none tabular-nums">{score}</span>
      <span className="text-[10px] font-semibold leading-none text-slate-400">/100</span>
    </div>
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

// Scrubber: piecewise map of the cycle onto the four evenly spaced phase
// ticks (Address 0, Top 1/3, Impact 2/3, Finish 1), so the playhead sits on
// "Top" exactly when the figure is at the top, etc.
const PLAYHEAD_MARKS: [number, number][] = [
  [0, 0],
  [TOP_T, 100 / 3],
  [IMPACT_T, 200 / 3],
  [FINISH_T, 100],
];
function playheadAt(t: number): number {
  for (let i = 0; i < PLAYHEAD_MARKS.length - 1; i++) {
    const [ta, pa] = PLAYHEAD_MARKS[i];
    const [tb, pb] = PLAYHEAD_MARKS[i + 1];
    if (t <= tb) return pa + ((Math.max(t, ta) - ta) / (tb - ta)) * (pb - pa);
  }
  return 100;
}

// The stage's static backdrop (spotlight, floor, light pool) — its own SVG
// layer under the animated one, so it is painted once, not every frame.
function StageBackdrop() {
  return (
    <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full" aria-hidden="true">
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
      </defs>
      <rect width="400" height="300" fill="url(#mq-stage)" />
      <path d="M128 -10 L213 -10 L293 250 L48 250 Z" fill="url(#mq-cone)" />
      <ellipse cx="158" cy={FLOOR_Y + 4} rx="110" ry="14" fill="url(#mq-pool)" />
      <rect x="0" y={FLOOR_Y} width="400" height={300 - FLOOR_Y} fill="url(#mq-floor)" />
      <line x1="0" y1={FLOOR_Y} x2="400" y2={FLOOR_Y} stroke="#ffffff" strokeOpacity="0.06" />
    </svg>
  );
}

// The swing stage and its scrubber. React renders these once; the swing
// itself (figure, trail, ball, pose overlay) and the playhead are animated
// by mountSwing directly. React only re-renders here when the analysis
// phase changes or the highlighted phase label changes (4 times a loop).
// `between` is rendered between the stage and the scrubber.
function SwingPlayer({ phase, leftHanded, between }: { phase: Phase; leftHanded: boolean; between: ReactNode }) {
  const sceneRef = useRef<SVGGElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [activePhase, setActivePhase] = useState(0);
  useEffect(() => {
    const root = sceneRef.current;
    if (!root) return;
    let shown = -1;
    return mountSwing(root, {
      overlay: () => {
        const p = phaseRef.current;
        return { pose: p === "pose" || p === "scoring" || p === "done", heat: p === "done" };
      },
      onProgress: (t) => {
        const playhead = playheadAt(t);
        if (barRef.current) barRef.current.style.width = `${playhead}%`;
        const nearest = Math.min(PHASES.length - 1, Math.round((playhead / 100) * (PHASES.length - 1)));
        if (nearest !== shown) {
          shown = nearest;
          setActivePhase(nearest);
        }
      },
    });
  }, []);
  return (
    <>
      {/* stage: static backdrop + the animated layer */}
      <div className="relative aspect-[4/3] overflow-hidden">
        <StageBackdrop />
        <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full" role="img" aria-label="A mannequin golfer swinging on a dark stage, with Caddie's pose analysis overlay">
          <defs>
            <linearGradient id="mq-limb" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.3" stopColor="#eef1ec" />
              <stop offset="0.75" stopColor="#a9b3ad" />
              <stop offset="1" stopColor="#6f7a74" />
            </linearGradient>
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
          </defs>
          {/* leftHanded mirrors the swing about the stage's centre */}
          <g ref={sceneRef} transform={leftHanded ? "translate(400 0) scale(-1 1)" : undefined} />
        </svg>
        {phase === "uploading" && <div aria-hidden="true" className="absolute inset-x-0 h-px bg-sun-300/90 shadow-[0_0_14px_3px_rgba(246,201,111,0.6)] animate-scan" />}
        {(phase === "uploading" || phase === "pose") && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:24px_24px]" />
        )}
      </div>

      {between}

      {/* scrubber with swing phases */}
      <div className="px-4 pb-1 pt-3">
        <div className="relative h-1.5 rounded-full bg-white/20">
          <div ref={barRef} className="h-full rounded-full bg-sun-300" style={{ width: "0%" }} />
          {PHASES.map((p, i) => (
            <span key={p} aria-hidden="true" className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-white/50" style={{ left: `${(i / (PHASES.length - 1)) * 100}%` }} />
          ))}
        </div>
        {/* each label sits under its tick (the ends are aligned to the edges) */}
        <div className="relative mt-1.5 h-3.5 text-[9.5px] font-semibold uppercase tracking-wider text-white/70">
          {PHASES.map((p, i) => (
            <span
              key={p}
              className={`absolute top-0 whitespace-nowrap ${i === 0 ? "" : i === PHASES.length - 1 ? "-translate-x-full" : "-translate-x-1/2"} ${i === activePhase ? "text-sun-300" : ""}`}
              style={{ left: `${(i / (PHASES.length - 1)) * 100}%` }}
            >
              {p}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

export function CaddieDemo({ leftHanded = false }: { leftHanded?: boolean }) {
  const { t } = useLocale();
  const [phase, setPhase] = useState<Phase>("idle");
  const caption = CAPTIONS[phase];
  const typed = useTyped(caption.text);
  const showAngles = phase === "scoring" || phase === "done";
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
  // Measurements: their own row under the stage (space reserved, so the
  // card doesn't jump when they appear). Built here — it only changes with
  // the phase — and handed to SwingPlayer to place between stage and scrubber.
  const measurements = (
    <div className={`grid grid-cols-3 gap-1.5 px-3 pt-3 transition-opacity duration-500 ${showAngles ? "opacity-100" : "opacity-0"}`} aria-hidden={!showAngles}>
      {ANGLES.map((c) => (
        <div key={c.label} className={`flex min-w-0 flex-col justify-between rounded-xl border bg-white/[0.04] px-2 py-1.5 ${c.ok ? "border-fairway-400/40" : "border-red-400/50"}`}>
          <p className="text-[9.5px] font-semibold uppercase leading-tight tracking-wide text-fairway-200/80">{c.label}</p>
          <p className={`text-sm font-extrabold tabular-nums ${c.ok ? "text-fairway-300" : "text-red-300"}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );

  const metrics = [
    { label: "Tempo", value: "3.1 : 1", pct: 86, ok: true },
    { label: "Shoulder turn", value: "94°", pct: 90, ok: true },
    { label: "Hip timing", value: "early", pct: 58, ok: false },
  ];

  return (
    <div className="mx-auto w-full max-w-md">
      <p className="mb-3 text-xs font-bold text-sun-300">{t("landing.demo.tryIt")}</p>
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0b1a10] shadow-2xl shadow-black/40 ring-1 ring-white/5">
        {/* Header row: clip info + live status (left), score (right). The
            score slot is always reserved, so nothing shifts when it lands. */}
        <div className="flex items-center justify-between gap-2 px-3 pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-semibold text-white">
              <Video size={12} /> 7 Iron · 0:04
            </span>
            {phase !== "idle" && phase !== "done" && (
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-fairway-200">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" /> {phase === "pose" ? "Pose detection" : "Live"}
              </span>
            )}
          </div>
          <ScoreBadge score={81} shown={phase === "done"} />
        </div>

        {/* Phase heading (typewriter), its own line */}
        <p className={`flex min-h-[2.25rem] items-center justify-center px-4 text-center font-mono text-[11px] font-bold uppercase leading-tight tracking-[0.14em] ${caption.accent ? "text-[#f87171]" : "text-[#e8ece9]"}`} aria-live="polite">
          <span>
            {typed}
            <span className={typed.length < caption.text.length ? "" : "opacity-60"} aria-hidden="true">
              ▍
            </span>
          </span>
        </p>

        <SwingPlayer phase={phase} leftHanded={leftHanded} between={measurements} />

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

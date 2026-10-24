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

// Pose landmarks over a simple side-on silhouette, in a 100x160 box.
const POSE: [number, number][] = [
  [52, 22], // head
  [50, 46], // shoulder
  [36, 70], // lead hand
  [60, 68], // trail elbow
  [48, 86], // hip
  [40, 120], // knee
  [44, 150], // ankle
  [62, 118], // trail knee
  [66, 150], // trail ankle
];
const BONES: [number, number][] = [
  [0, 1],
  [1, 2],
  [1, 3],
  [1, 4],
  [4, 5],
  [5, 6],
  [4, 7],
  [7, 8],
];

export function CaddieDemo() {
  const { t } = useLocale();
  const [phase, setPhase] = useState<Phase>("idle");
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const run = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    setPhase("uploading");
    const steps: [Phase, number][] = [
      ["pose", 900],
      ["scoring", 2600],
      ["done", 3900],
    ];
    steps.forEach(([p, ms]) => timers.current.push(window.setTimeout(() => setPhase(p), ms)));
  };
  const reset = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    setPhase("idle");
  };

  const stepLabel: Record<Phase, string> = {
    idle: "Ready",
    uploading: "Uploading 7-iron swing…",
    pose: "Detecting body positions",
    scoring: "Scoring the swing",
    done: "Analysis saved to your history",
  };
  const showPose = phase === "pose" || phase === "scoring" || phase === "done";

  return (
    <div className="mx-auto w-full max-w-md">
      <p className="mb-3 text-xs font-bold text-sun-300">{t("landing.demo.tryIt")}</p>
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-2xl shadow-black/30 backdrop-blur-sm">
        {/* "video" area */}
        <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-b from-fairway-800 via-fairway-900 to-fairway-950">
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-fairway-500/30 to-transparent" />
          <svg viewBox="0 0 100 160" className="absolute left-1/2 top-1/2 h-[88%] -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
            {/* silhouette */}
            <path
              d="M52 14a8 8 0 1 1 0 16a8 8 0 0 1 0-16zM44 32h16l6 20-4 22 6 40-4 34h-8l-2-34-6-16-4 16-4 34h-8l2-36 6-38-4-20z"
              fill="#0f3a22"
              stroke="#4fc169"
              strokeOpacity="0.35"
            />
            {/* club */}
            <path d="M36 70 L18 128" stroke="#e4e9e1" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
            {showPose && (
              <g className="animate-pop">
                {BONES.map(([a, b]) => (
                  <line key={`${a}-${b}`} x1={POSE[a][0]} y1={POSE[a][1]} x2={POSE[b][0]} y2={POSE[b][1]} stroke="#86efac" strokeWidth="1.4" strokeLinecap="round" />
                ))}
                {POSE.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r="2.6" fill="#f4b942" className="animate-pose-pulse" style={{ animationDelay: `${i * 90}ms`, transformBox: "fill-box", transformOrigin: "center" }} />
                ))}
              </g>
            )}
          </svg>
          {phase === "uploading" && <div aria-hidden="true" className="absolute inset-x-6 h-px bg-sun-300/80 shadow-[0_0_12px_2px_rgba(246,201,111,0.6)] animate-scan" />}
          {phase === "done" && (
            <div className="absolute right-3 top-3 rounded-2xl bg-white/95 p-2 text-slate-900 shadow-lg animate-pop">
              <ScoreRing score={81} size={72} />
            </div>
          )}
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
            <Video size={12} /> 7 Iron · 0:04
          </div>
        </div>

        {/* status + feedback */}
        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-white" aria-live="polite">
              {phase === "done" ? <Check size={15} className="text-fairway-300" /> : phase === "idle" ? <Sparkles size={15} className="text-sun-300" /> : <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sun-300 border-t-transparent" />}
              {stepLabel[phase]}
            </p>
            <div className="flex gap-1" aria-hidden="true">
              {(["uploading", "pose", "scoring"] as Phase[]).map((p, i) => {
                const idx = ["uploading", "pose", "scoring", "done"].indexOf(phase);
                const on = idx > i || phase === "done";
                return <span key={p} className={`h-1.5 w-6 rounded-full transition ${on ? "bg-fairway-400" : "bg-white/15"}`} />;
              })}
            </div>
          </div>
          <ul className="mt-3 min-h-[4.5rem] space-y-1.5 text-sm text-fairway-100">
            {phase === "done" ? (
              FEEDBACK.map((line, i) => (
                <li key={line} className="flex items-start gap-2 animate-slide-up" style={{ animationDelay: `${i * 220}ms`, animationFillMode: "backwards" }}>
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sun-300" /> {line}
                </li>
              ))
            ) : (
              <li className="text-fairway-200/70">{phase === "idle" ? "Caddie scores your swing out of 100 and tells you what to work on." : "Working…"}</li>
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
    <div className="relative mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white py-3 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]" aria-hidden="true">
      <div className="flex w-max gap-3 animate-marquee hover:[animation-play-state:paused]">
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

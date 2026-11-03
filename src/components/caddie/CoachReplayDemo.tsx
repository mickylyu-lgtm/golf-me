import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import { buildCoachPlan } from "../../lib/coachReplay";
import type { CoachCheckpointId, CoachMoment } from "../../lib/coachReplay";
import { demoCoachFindings, demoCoachSummary } from "../../data/caddieCoachDemo";
import { ADDRESS_T, FINISH_T, IMPACT_T, SWING_MS, TOP_T } from "../landing/swingMotion";
import { mountSwing } from "../landing/swingRenderer";
import { StageBackdrop, SwingFigureDefs } from "../landing/swingStage";
import { CoachModeSwitch, CoachReplayCard, CoachReplayStrip, CoachSummaryCard } from "./CoachReplayCard";

// Coach Replay for the demo account, over the landing page's animated demo
// golfer instead of a real swing video (demo accounts have none). The same
// card, strip and plan builder as the real replay; only the clock differs:
// mountSwing draws whatever loop position `at()` returns, so pausing is
// just not advancing it.

// Slow motion, like the real replay's Slow Mode (0.25x there; the rig's
// swing is shorter than a real clip, so a little quicker reads better).
const SLOW = 0.4;
const toSeconds = (u: number) => (u * SWING_MS) / 1000;
// The demo's freeze points, as loop positions. Address freezes partway into
// the address hold (the pose is still), the rest on the rig's own key frames.
const CHECKPOINT_U: Record<CoachCheckpointId, number> = { address: ADDRESS_T * 0.6, top: TOP_T, impact: IMPACT_T, finish: FINISH_T };

export function CoachReplayDemo() {
  const { t } = useLocale();
  const plan = useMemo(() => {
    const moments: CoachMoment[] = (Object.keys(CHECKPOINT_U) as CoachCheckpointId[]).map((id) => ({
      id,
      timeSeconds: toSeconds(CHECKPOINT_U[id]),
      label: id,
      approximate: false,
      source: "demo.swingMotion",
    }));
    return { ...buildCoachPlan("demo", moments, demoCoachFindings()), summary: demoCoachSummary() };
  }, []);
  const checkpoints = plan.checkpoints;
  // The closing card shows once a coached pass ends, until Done or Watch again.
  const [summaryOpen, setSummaryOpen] = useState(false);
  const marks = useMemo(() => checkpoints.map((c) => (c.timeSeconds * 1000) / SWING_MS), [checkpoints]);

  const sceneRef = useRef<SVGGElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [coachOn, setCoachOn] = useState(true);
  // The clock lives in refs: it is read and advanced inside mountSwing's
  // animation frame, never through React state.
  const clock = useRef({ u: 0, running: false, lastNow: 0, consumed: new Set<number>(), skipped: false, coachOn: true, loop: false });

  useEffect(() => {
    const root = sceneRef.current;
    if (!root) return;
    const c = clock.current;
    const freezeIn = (from: number, to: number): number | null => {
      if (!c.coachOn || c.skipped) return null;
      for (let i = 0; i < marks.length; i++) if (!c.consumed.has(i) && marks[i] >= from && marks[i] <= to) return i;
      return null;
    };
    const advance = (): number => {
      const now = performance.now();
      const dt = c.lastNow ? Math.min(100, now - c.lastNow) : 0;
      c.lastNow = now;
      if (!c.running) return c.u;
      let next = c.u + (dt * SLOW) / SWING_MS;
      if (next >= 1) {
        // One coached pass ends back at address, waiting for Watch again.
        // Coach mode off loops like the landing page.
        next -= 1;
        c.consumed.clear();
        c.skipped = false;
        if (!c.loop) {
          c.u = 0;
          c.running = false;
          setPlaying(false);
          setFinished(true);
          setSummaryOpen(true);
          return 0;
        }
      }
      const hit = freezeIn(c.u, next);
      if (hit !== null) {
        c.consumed.add(hit);
        c.u = marks[hit];
        c.running = false;
        setPlaying(false);
        setActiveIndex(hit);
        return c.u;
      }
      c.u = next;
      return c.u;
    };
    return mountSwing(root, {
      overlay: () => ({ pose: true, heat: false }),
      at: advance,
      onProgress: (u) => {
        if (barRef.current) barRef.current.style.transform = `scaleX(${u})`;
      },
    });
  }, [marks]);

  const resume = useCallback(() => {
    const c = clock.current;
    setActiveIndex(null);
    setFinished(false);
    setSummaryOpen(false);
    c.lastNow = 0;
    c.running = true;
    setPlaying(true);
  }, []);
  const skip = useCallback(() => {
    clock.current.skipped = true;
    resume();
  }, [resume]);

  function toggleCoach() {
    const c = clock.current;
    const next = !coachOn;
    setCoachOn(next);
    c.coachOn = next;
    c.loop = !next;
    c.consumed.clear();
    c.skipped = false;
    setActiveIndex(null);
    setFinished(false);
    setSummaryOpen(false);
    if (next) {
      // Back to the start, ready to coach from address.
      c.u = 0;
      c.running = false;
      setPlaying(false);
    } else {
      c.running = true;
      setPlaying(true);
    }
  }

  const active = activeIndex === null ? null : checkpoints[activeIndex];

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-2xl bg-brand-forest-deep">
        <div className="relative aspect-[4/3]">
          <StageBackdrop />
          <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full" role="img" aria-label={t("coachReplay.demoBadge")}>
            <defs>
              <SwingFigureDefs />
            </defs>
            <g ref={sceneRef} />
          </svg>
          <span className="absolute left-3 top-3 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80 backdrop-blur-sm">
            {t("coachReplay.demoBadge")}
          </span>
        </div>
        {/* progress, with a gold tick at each checkpoint */}
        <div className="px-4 pb-3 pt-1">
          <div className="relative h-1 rounded-full bg-white/15">
            <div ref={barRef} className="h-full origin-left rounded-full bg-white/60" style={{ transform: "scaleX(0)" }} />
            {coachOn &&
              marks.map((m, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand-forest-deep ${
                    activeIndex === i ? "bg-brand-gold" : "bg-brand-gold/70"
                  }`}
                  style={{ left: `${m * 100}%` }}
                />
              ))}
          </div>
        </div>
      </div>

      {coachOn &&
        (active ? (
          <CoachReplayCard key={activeIndex} checkpoint={active} index={activeIndex ?? 0} total={checkpoints.length} onContinue={resume} onSkip={skip} />
        ) : summaryOpen && plan.summary ? (
          <CoachSummaryCard summary={plan.summary} onReplay={resume} onDone={() => setSummaryOpen(false)} />
        ) : (
          <CoachReplayStrip count={checkpoints.length} playing={playing} onPlay={resume} playLabelKey={finished ? "coachReplay.watchAgain" : "coachReplay.playShort"} />
        ))}

      <div className="flex justify-end">
        <CoachModeSwitch on={coachOn} onToggle={toggleCoach} />
      </div>
    </div>
  );
}

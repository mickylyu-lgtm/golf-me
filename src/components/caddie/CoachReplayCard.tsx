import { useEffect, useState } from "react";
import { CircleCheck, Dumbbell, Play, RotateCcw, Target } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/locales/en";
import { coachDwellMs } from "../../lib/coachReplay";
import type { CoachCheckpoint, CoachClaim, CoachMomentLabel, CoachSummary, CoachText } from "../../lib/coachReplay";
import { usePrefersReducedMotion } from "../loading/loaderState";

// The freeze card Coach Replay shows at each checkpoint, plus the slim strip
// that holds its place between freezes. Presentational only: the player
// (CaddieSwingReplay's video, or CoachReplayDemo's golfer) owns the clock
// and says which checkpoint is up.

const MOMENT_LABEL_KEYS: Record<CoachMomentLabel, TranslationKey> = {
  address: "swingAnalysis.address",
  top: "swingAnalysis.topOfBackswing",
  impact: "swingAnalysis.impact",
  follow_through: "swingAnalysis.followThrough",
  finish: "coachReplay.finish",
};

// Both cards are flex columns that may shrink (min-h-0) inside a slot with
// a capped height: the player caps it so a card never covers the clip
// (below the video inline, a bottom band in fullscreen). Only the body
// scrolls; the header and Continue/Done always stay on screen.
const CARD_CLASS =
  "relative flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white p-3.5 shadow-[0_14px_34px_-14px_rgba(14,39,23,0.5)] ring-1 ring-black/[0.04] animate-coach-card-in";
const CARD_BODY_CLASS = "mt-2.5 min-h-0 overflow-y-auto overscroll-contain";
// Fades the last line when the body has more below, so it reads as scrollable.
const CARD_BODY_MORE_CLASS = "[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]";

// Whether the capped body has content hidden below its fold (not yet
// scrolled to the end). Re-checked on resize and scroll.
function useHasMoreBelow() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 2);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, [el]);
  return [setEl, more] as const;
}

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;
const textOf = (t: T, text: CoachText) => (text.kind === "key" ? t(text.key) : text.text);
const claimLength = (t: T, c: CoachClaim | undefined) => (c ? (c.title ? textOf(t, c.title).length : 0) + textOf(t, c.body).length : 0);

function Claim({ claim, t }: { claim: CoachClaim; t: T }) {
  return (
    <p className="text-[13px] leading-snug text-slate-700">
      {claim.title && <span className="font-semibold text-slate-900">{textOf(t, claim.title)} · </span>}
      {textOf(t, claim.body)}
    </p>
  );
}

export interface CoachReplayCardProps {
  checkpoint: CoachCheckpoint;
  index: number;
  total: number;
  onContinue: () => void;
  onSkip: () => void;
}

export function CoachReplayCard({ checkpoint, index, total, onContinue, onSkip }: CoachReplayCardProps) {
  const { t } = useLocale();
  const reducedMotion = usePrefersReducedMotion();
  // Tapping the card holds it: the swing waits until Continue. Under
  // reduced motion it always waits (nothing moves on its own).
  const [held, setHeld] = useState(false);
  // A card whose text runs past its capped height waits for Continue: it
  // shouldn't move on before the golfer has scrolled to read the rest.
  const [bodyRef, moreBelow] = useHasMoreBelow();
  const [everOverflowed, setEverOverflowed] = useState(false);
  useEffect(() => {
    if (moreBelow) setEverOverflowed(true);
  }, [moreBelow]);
  const autoContinue = !reducedMotion && !held && !everOverflowed;
  const dwellMs = coachDwellMs(claimLength(t, checkpoint.good) + claimLength(t, checkpoint.fix) + claimLength(t, checkpoint.cue));

  useEffect(() => {
    if (!autoContinue) return;
    const id = window.setTimeout(onContinue, dwellMs);
    return () => window.clearTimeout(id);
  }, [autoContinue, dwellMs, onContinue]);

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t(MOMENT_LABEL_KEYS[checkpoint.label])}
      onClick={() => setHeld(true)}
      className={CARD_CLASS}
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-forest">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold" />
          <span className="truncate">{t(MOMENT_LABEL_KEYS[checkpoint.label])}</span>
          {checkpoint.approximate && (
            <span className="shrink-0 rounded-full bg-sun-50 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-sun-700">
              {t("coachReplay.approximate")}
            </span>
          )}
        </p>
        <p className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-400">{t("coachReplay.step", { current: index + 1, total })}</p>
      </div>

      {/* Header and buttons stay put; only this middle part scrolls when the
          slot caps the card's height (so it never grows over the clip). */}
      <div ref={bodyRef} className={`${CARD_BODY_CLASS} ${moreBelow ? CARD_BODY_MORE_CLASS : ""}`}>
      <div className="flex flex-col gap-2">
        {checkpoint.good && (
          <div className="flex items-start gap-2">
            <CircleCheck size={17} aria-hidden="true" className="mt-px shrink-0 text-fairway-600" />
            <div className="min-w-0">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-fairway-700">{t("coachReplay.doingWell")}</p>
              <Claim claim={checkpoint.good} t={t} />
            </div>
          </div>
        )}
        <div className="flex items-start gap-2">
          <Target size={17} aria-hidden="true" className={`mt-px shrink-0 ${checkpoint.fix ? "text-sun-600" : "text-slate-300"}`} />
          <div className="min-w-0">
            <p className={`text-[10.5px] font-bold uppercase tracking-wide ${checkpoint.fix ? "text-sun-700" : "text-slate-400"}`}>{t("coachReplay.toFix")}</p>
            {checkpoint.fix ? <Claim claim={checkpoint.fix} t={t} /> : <p className="text-[13px] leading-snug text-slate-500">{t("coachReplay.nothingFlagged")}</p>}
          </div>
        </div>
      </div>

      {checkpoint.cue && (
        <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-brand-forest px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-brand-gold">{t("coachReplay.remember")}</span>
          <span className="min-w-0 text-sm font-semibold text-white">{textOf(t, checkpoint.cue.body)}</span>
        </div>
      )}
      </div>

      <div className="mt-3 flex shrink-0 items-center justify-between gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSkip();
          }}
          className="min-h-9 rounded-full px-3 text-xs font-semibold text-slate-500 transition-colors duration-150 hover:text-slate-800"
        >
          {t("coachReplay.skip")}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onContinue();
          }}
          className="flex min-h-9 items-center gap-1.5 rounded-full bg-brand-forest px-4 text-xs font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-brand-forest-deep"
        >
          {t("coachReplay.continue")}
          <Play size={12} aria-hidden="true" className="fill-current" />
        </button>
      </div>

      {autoContinue && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-brand-gold animate-coach-dwell"
          style={{ animationDuration: `${dwellMs}ms` }}
        />
      )}
    </div>
  );
}

// The closing card, once a coached pass reaches the end: what to work on
// (the main focus when no freeze carried it, the top work_on items) and the
// drill. No auto-dismiss: there's nothing left to play into.
export function CoachSummaryCard({ summary, onReplay, onDone }: { summary: CoachSummary; onReplay: () => void; onDone: () => void }) {
  const { t } = useLocale();
  const work: { claim: CoachClaim; labelKey: TranslationKey }[] = summary.focus ? [{ claim: summary.focus, labelKey: "coachReplay.mainFocus" }] : [];
  for (const claim of summary.workOn) work.push({ claim, labelKey: "coachReplay.workOn" });
  const [bodyRef, moreBelow] = useHasMoreBelow();
  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t("coachReplay.summaryTitle")}
      className={CARD_CLASS}
    >
      <p className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-forest">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold" />
        {t("coachReplay.summaryTitle")}
      </p>

      <div ref={bodyRef} className={`${CARD_BODY_CLASS} flex flex-col gap-2 ${moreBelow ? CARD_BODY_MORE_CLASS : ""}`}>
        {work.map(({ claim, labelKey }) => (
          <div key={claim.source} className="flex items-start gap-2">
            <Target size={17} aria-hidden="true" className="mt-px shrink-0 text-sun-600" />
            <div className="min-w-0">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-sun-700">{t(labelKey)}</p>
              <Claim claim={claim} t={t} />
            </div>
          </div>
        ))}
        {summary.drill && (
          <div className="flex items-start gap-2">
            <Dumbbell size={17} aria-hidden="true" className="mt-px shrink-0 text-fairway-600" />
            <div className="min-w-0">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-fairway-700">{t("coachReplay.drill")}</p>
              <p className="text-[13px] font-semibold leading-snug text-slate-900">{textOf(t, summary.drill.name)}</p>
              {summary.drill.steps.length > 0 && (
                <ol className="mt-0.5 list-decimal pl-4 text-[12.5px] leading-snug text-slate-600">
                  {summary.drill.steps.map((step, i) => (
                    <li key={i}>{textOf(t, step)}</li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex shrink-0 items-center justify-between gap-2">
        <button
          onClick={onReplay}
          className="flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-slate-500 transition-colors duration-150 hover:text-slate-800"
        >
          <RotateCcw size={12} aria-hidden="true" />
          {t("coachReplay.watchAgain")}
        </button>
        <button
          onClick={onDone}
          className="flex min-h-9 items-center gap-1.5 rounded-full bg-brand-forest px-4 text-xs font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-brand-forest-deep"
        >
          {t("coachReplay.done")}
        </button>
      </div>
    </div>
  );
}

// Between freezes: what Coach Replay is, how many moments it will stop on,
// and a play button while the swing is stopped.
export function CoachReplayStrip({
  count,
  playing,
  onPlay,
  playLabelKey = "coachReplay.playShort",
}: {
  count: number;
  playing: boolean;
  onPlay: () => void;
  playLabelKey?: TranslationKey;
}) {
  const { t } = useLocale();
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-white px-3.5 py-2.5 shadow-[0_8px_24px_-14px_rgba(14,39,23,0.45)] ring-1 ring-black/[0.04]">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-bold text-brand-forest">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold" />
          {t("coachReplay.title")}
        </p>
        <p className="pl-3 text-xs text-slate-500">{count > 0 ? t("coachReplay.momentsHint", { count }) : t("coachReplay.summaryOnlyHint")}</p>
      </div>
      {!playing && (
        <button
          onClick={onPlay}
          aria-label={`${t(playLabelKey)}: ${t("coachReplay.title")}`}
          className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand-forest px-4 text-xs font-semibold text-white transition-colors duration-150 hover:bg-brand-forest-deep"
        >
          <Play size={12} aria-hidden="true" className="fill-current" />
          {t(playLabelKey)}
        </button>
      )}
    </div>
  );
}

// The "Coach mode" on/off switch, shared by the real replay and the demo.
export function CoachModeSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { t } = useLocale();
  return (
    <button role="switch" aria-checked={on} onClick={onToggle} className="flex min-h-9 items-center gap-2 rounded-full px-1 text-xs font-semibold text-slate-600">
      {t("coachReplay.coachMode")}
      <span aria-hidden="true" className={`relative h-5 w-9 rounded-full transition-colors duration-200 ${on ? "bg-brand-forest" : "bg-slate-200"}`}>
        <span
          className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
            on ? "translate-x-[18px] ring-2 ring-brand-gold/60" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

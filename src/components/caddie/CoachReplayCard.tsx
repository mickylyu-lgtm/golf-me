import { useEffect, useState } from "react";
import { CircleCheck, Dumbbell, Play, RotateCcw, Target } from "lucide-react";
import type { ReactNode } from "react";
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

// Both cards are a fixed, compact shape that never scrolls (Micky,
// 2026-11-03): the phase label, one line per finding, the cue in at most
// two lines, and 44px buttons. Longer text is cut with an ellipsis; the full
// text is in the results below the replay. Kept small enough to fit the
// player's capped slot (below the video inline, a bottom band in
// fullscreen) at 375x667 with the longest stored text, so the card never
// covers the clip.
const CARD_CLASS =
  "relative flex flex-col overflow-hidden rounded-2xl bg-white p-3 shadow-[0_14px_34px_-14px_rgba(14,39,23,0.5)] ring-1 ring-black/[0.04] animate-coach-card-in";
const BUTTON_ROW_CLASS = "mt-2 flex items-center justify-between gap-2";
const SECONDARY_BUTTON_CLASS =
  "flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-slate-500 transition-colors duration-150 hover:text-slate-800";
const PRIMARY_BUTTON_CLASS =
  "flex min-h-11 items-center gap-1.5 rounded-full bg-brand-forest px-5 text-[13px] font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-brand-forest-deep";

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;
const textOf = (t: T, text: CoachText) => (text.kind === "key" ? t(text.key) : text.text);
const claimLength = (t: T, c: CoachClaim | undefined) => (c ? (c.title ? textOf(t, c.title).length : 0) + textOf(t, c.body).length : 0);

// One finding: a small label, then the claim on ONE line (title · body, cut
// with an ellipsis). The full sentence carries on in the results below.
function FindingRow({ icon, label, labelClass, children }: { icon: ReactNode; label: string; labelClass: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      {icon}
      <div className="min-w-0 flex-1">
        <p className={`text-[10.5px] font-bold uppercase leading-[14px] tracking-wide ${labelClass}`}>{label}</p>
        {children}
      </div>
    </div>
  );
}

function ClaimLine({ claim, t }: { claim: CoachClaim; t: T }) {
  const full = `${claim.title ? `${textOf(t, claim.title)} · ` : ""}${textOf(t, claim.body)}`;
  return (
    <p data-coach-text className="truncate text-[13px] leading-[18px] text-slate-700" title={full}>
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
  const autoContinue = !reducedMotion && !held;
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
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase leading-4 tracking-wider text-brand-forest">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold" />
          <span className="truncate">{t(MOMENT_LABEL_KEYS[checkpoint.label])}</span>
          {checkpoint.approximate && (
            <span className="shrink-0 rounded-full bg-sun-50 px-1.5 text-[10px] font-semibold normal-case leading-4 tracking-normal text-sun-700">
              {t("coachReplay.approximate")}
            </span>
          )}
        </p>
        <p className="shrink-0 text-[11px] font-semibold leading-4 tabular-nums text-slate-400">{t("coachReplay.step", { current: index + 1, total })}</p>
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {checkpoint.good && (
          <FindingRow
            icon={<CircleCheck size={17} aria-hidden="true" className="mt-px shrink-0 text-fairway-600" />}
            label={t("coachReplay.doingWell")}
            labelClass="text-fairway-700"
          >
            <ClaimLine claim={checkpoint.good} t={t} />
          </FindingRow>
        )}
        <FindingRow
          icon={<Target size={17} aria-hidden="true" className={`mt-px shrink-0 ${checkpoint.fix ? "text-sun-600" : "text-slate-300"}`} />}
          label={t("coachReplay.toFix")}
          labelClass={checkpoint.fix ? "text-sun-700" : "text-slate-400"}
        >
          {checkpoint.fix ? (
            <ClaimLine claim={checkpoint.fix} t={t} />
          ) : (
            <p data-coach-text className="truncate text-[13px] leading-[18px] text-slate-500">
              {t("coachReplay.nothingFlagged")}
            </p>
          )}
        </FindingRow>
      </div>

      {checkpoint.cue && (
        // The label runs inline with the cue, so the cue gets the card's full
        // width: at most two lines (90 characters fits).
        // (Padding on the wrapper, clamp on the text: a clamped element with
        // its own padding lets a third line show through the padding.)
        <div className="mt-2.5 rounded-xl bg-brand-forest px-3 py-2">
          <p data-coach-text className="line-clamp-2 text-[13px] font-semibold leading-[18px] text-white">
            <span className="mr-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-gold">{t("coachReplay.remember")}</span>
            {textOf(t, checkpoint.cue.body)}
          </p>
        </div>
      )}

      <div className={BUTTON_ROW_CLASS}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSkip();
          }}
          className={SECONDARY_BUTTON_CLASS}
        >
          {t("coachReplay.skip")}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onContinue();
          }}
          className={PRIMARY_BUTTON_CLASS}
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
// drill's name, one line each. The drill's steps are in the results below.
// No auto-dismiss: there's nothing left to play into.
export function CoachSummaryCard({ summary, onReplay, onDone }: { summary: CoachSummary; onReplay: () => void; onDone: () => void }) {
  const { t } = useLocale();
  const work: { claim: CoachClaim; labelKey: TranslationKey }[] = summary.focus ? [{ claim: summary.focus, labelKey: "coachReplay.mainFocus" }] : [];
  for (const claim of summary.workOn) work.push({ claim, labelKey: "coachReplay.workOn" });
  return (
    <div role="dialog" aria-live="polite" aria-label={t("coachReplay.summaryTitle")} className={CARD_CLASS}>
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase leading-4 tracking-wider text-brand-forest">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold" />
        {t("coachReplay.summaryTitle")}
      </p>

      <div className="mt-2 flex flex-col gap-1.5">
        {work.map(({ claim, labelKey }) => (
          <FindingRow key={claim.source} icon={<Target size={17} aria-hidden="true" className="mt-px shrink-0 text-sun-600" />} label={t(labelKey)} labelClass="text-sun-700">
            <ClaimLine claim={claim} t={t} />
          </FindingRow>
        ))}
        {summary.drill && (
          <FindingRow icon={<Dumbbell size={17} aria-hidden="true" className="mt-px shrink-0 text-fairway-600" />} label={t("coachReplay.drill")} labelClass="text-fairway-700">
            <p data-coach-text className="truncate text-[13px] font-semibold leading-[18px] text-slate-900">
              {textOf(t, summary.drill.name)}
            </p>
          </FindingRow>
        )}
      </div>

      <div className={BUTTON_ROW_CLASS}>
        <button onClick={onReplay} className={SECONDARY_BUTTON_CLASS}>
          <RotateCcw size={13} aria-hidden="true" />
          {t("coachReplay.watchAgain")}
        </button>
        <button onClick={onDone} className={PRIMARY_BUTTON_CLASS}>
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

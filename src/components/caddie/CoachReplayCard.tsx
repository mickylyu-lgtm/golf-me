import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleCheck, Dumbbell, Play, RotateCcw, Target } from "lucide-react";
import type { ReactNode } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/locales/en";
import { coachDwellMs } from "../../lib/coachReplay";
import type { CoachCheckpoint, CoachClaim, CoachMomentLabel, CoachSummary, CoachText } from "../../lib/coachReplay";
import { COACH_CARD_MAX_SCREEN_FRACTION, paginateWithSentences, splitSentences } from "../../lib/coachPaging";
import type { PageItem } from "../../lib/coachPaging";
import { usePrefersReducedMotion } from "../loading/loaderState";

// The freeze card Coach Replay shows at each checkpoint, plus the slim strip
// that holds its place between freezes. Presentational only: the player
// (CaddieSwingReplay's video, or CoachReplayDemo's golfer) owns the clock
// and says which checkpoint is up.
//
// Cards show the FULL feedback (no ellipsis, no line clamp) and never
// scroll (Micky, 2026-11-03). When a card's content is taller than
// COACH_CARD_MAX_SCREEN_FRACTION of the screen, it is split into pages
// shown one after the other ("Doing well", then "One thing to fix" + its
// cue; for the summary: focus, work-on items, drill). Whether to split is
// decided from measured heights (CoachPageMeasurer), not character counts.
// A single finding taller than a whole page is split between sentences
// (paginateWithSentences); its label repeats on each page it spans.

const MOMENT_LABEL_KEYS: Record<CoachMomentLabel, TranslationKey> = {
  address: "swingAnalysis.address",
  top: "swingAnalysis.topOfBackswing",
  impact: "swingAnalysis.impact",
  follow_through: "swingAnalysis.followThrough",
  finish: "coachReplay.finish",
};

const CARD_CLASS =
  "relative flex flex-col overflow-hidden rounded-2xl bg-white p-3 shadow-[0_14px_34px_-14px_rgba(14,39,23,0.5)] ring-1 ring-black/[0.04] animate-coach-card-in";
// Space between two blocks on a page; kept in sync with paginateBlocks' gap.
const BLOCK_GAP_PX = 8;
const BODY_CLASS = "mt-2 flex flex-col gap-2";
const BUTTON_ROW_CLASS = "mt-2 flex items-center justify-between gap-2";
const SECONDARY_BUTTON_CLASS =
  "flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-slate-500 transition-colors duration-150 hover:text-slate-800";
const PRIMARY_BUTTON_CLASS =
  "flex min-h-11 items-center gap-1.5 rounded-full bg-brand-forest px-5 text-[13px] font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-brand-forest-deep";
const TEXT_CLASS = "text-[13px] leading-[18px]";

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;
const textOf = (t: T, text: CoachText) => (text.kind === "key" ? t(text.key) : text.text);
// A run of sentences [from, to) of a claim's body; undefined = all of it.
type Range = readonly [number, number];
const bodyOf = (t: T, c: CoachClaim, range?: Range) => {
  const body = textOf(t, c.body);
  return range ? splitSentences(body).slice(range[0], range[1]).join("").trim() : body;
};
const showsTitle = (range?: Range) => !range || range[0] === 0;
const claimLength = (t: T, c: CoachClaim | undefined, range?: Range) =>
  c ? (c.title && showsTitle(range) ? textOf(t, c.title).length : 0) + bodyOf(t, c, range).length : 0;
const sentenceCount = (t: T, c: CoachClaim | undefined) => (c ? splitSentences(textOf(t, c.body)).length : 0);
const rangeOf = (item: PageItem): { block: number; range?: Range } => (typeof item === "number" ? { block: item } : { block: item.block, range: [item.from, item.to] });

// ── Blocks ──────────────────────────────────────────────────────────────
// A card is a list of blocks; `group` keeps blocks together on one page
// when they fit (the fix and its cue).

export type CheckpointBlockId = "good" | "fix" | "cue";
export interface CardBlock<Id extends string> {
  id: Id;
  group: number;
}

function checkpointBlocks(checkpoint: CoachCheckpoint): CardBlock<CheckpointBlockId>[] {
  const blocks: CardBlock<CheckpointBlockId>[] = [];
  if (checkpoint.good) blocks.push({ id: "good", group: 0 });
  blocks.push({ id: "fix", group: 1 });
  if (checkpoint.cue) blocks.push({ id: "cue", group: 1 });
  return blocks;
}

export type SummaryBlockId = "focus" | `work-${number}` | "drill-name" | "drill-steps";

function summaryBlocks(summary: CoachSummary): CardBlock<SummaryBlockId>[] {
  const blocks: CardBlock<SummaryBlockId>[] = [];
  if (summary.focus) blocks.push({ id: "focus", group: 0 });
  summary.workOn.forEach((_, i) => blocks.push({ id: `work-${i}`, group: 1 }));
  if (summary.drill) {
    blocks.push({ id: "drill-name", group: 2 });
    if (summary.drill.steps.length > 0) blocks.push({ id: "drill-steps", group: 2 });
  }
  return blocks;
}

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

// The claim in full: title · body, wrapping as needed. With a range, only
// those sentences of the body (the title goes with the first).
function ClaimText({ claim, t, range }: { claim: CoachClaim; t: T; range?: Range }) {
  return (
    <p data-coach-text className={`${TEXT_CLASS} text-slate-700`}>
      {claim.title && showsTitle(range) && <span className="font-semibold text-slate-900">{textOf(t, claim.title)} · </span>}
      {bodyOf(t, claim, range)}
    </p>
  );
}

// The claim a checkpoint block shows, for the blocks that can be split by sentence.
const checkpointClaim = (checkpoint: CoachCheckpoint, id: CheckpointBlockId) => (id === "good" ? checkpoint.good : id === "fix" ? checkpoint.fix : undefined);

function CheckpointBlockView({ checkpoint, id, t, range }: { checkpoint: CoachCheckpoint; id: CheckpointBlockId; t: T; range?: Range }) {
  if (id === "good" && checkpoint.good) {
    return (
      <FindingRow icon={<CircleCheck size={17} aria-hidden="true" className="mt-px shrink-0 text-fairway-600" />} label={t("coachReplay.doingWell")} labelClass="text-fairway-700">
        <ClaimText claim={checkpoint.good} t={t} range={range} />
      </FindingRow>
    );
  }
  if (id === "fix") {
    return (
      <FindingRow
        icon={<Target size={17} aria-hidden="true" className={`mt-px shrink-0 ${checkpoint.fix ? "text-sun-600" : "text-slate-300"}`} />}
        label={t("coachReplay.toFix")}
        labelClass={checkpoint.fix ? "text-sun-700" : "text-slate-400"}
      >
        {checkpoint.fix ? (
          <ClaimText claim={checkpoint.fix} t={t} range={range} />
        ) : (
          <p data-coach-text className={`${TEXT_CLASS} text-slate-500`}>
            {t("coachReplay.nothingFlagged")}
          </p>
        )}
      </FindingRow>
    );
  }
  if (id === "cue" && checkpoint.cue) {
    return (
      <div className="rounded-xl bg-brand-forest px-3 py-2">
        <p data-coach-text className={`${TEXT_CLASS} font-semibold text-white`}>
          <span className="mr-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-gold">{t("coachReplay.remember")}</span>
          {textOf(t, checkpoint.cue.body)}
        </p>
      </div>
    );
  }
  return null;
}

const summaryClaim = (summary: CoachSummary, id: SummaryBlockId) =>
  id === "focus" ? summary.focus : id.startsWith("work-") ? summary.workOn[Number(id.slice("work-".length))] : undefined;

function SummaryBlockView({ summary, id, t, range }: { summary: CoachSummary; id: SummaryBlockId; t: T; range?: Range }) {
  const workIcon = <Target size={17} aria-hidden="true" className="mt-px shrink-0 text-sun-600" />;
  if (id === "focus" && summary.focus) {
    return (
      <FindingRow icon={workIcon} label={t("coachReplay.mainFocus")} labelClass="text-sun-700">
        <ClaimText claim={summary.focus} t={t} range={range} />
      </FindingRow>
    );
  }
  if (id.startsWith("work-")) {
    const claim = summary.workOn[Number(id.slice("work-".length))];
    if (!claim) return null;
    return (
      <FindingRow icon={workIcon} label={t("coachReplay.workOn")} labelClass="text-sun-700">
        <ClaimText claim={claim} t={t} range={range} />
      </FindingRow>
    );
  }
  if (id === "drill-name" && summary.drill) {
    return (
      <FindingRow icon={<Dumbbell size={17} aria-hidden="true" className="mt-px shrink-0 text-fairway-600" />} label={t("coachReplay.drill")} labelClass="text-fairway-700">
        <p data-coach-text className={`${TEXT_CLASS} font-semibold text-slate-900`}>
          {textOf(t, summary.drill.name)}
        </p>
      </FindingRow>
    );
  }
  if (id === "drill-steps" && summary.drill) {
    // Its own label, so it still reads right when paging puts the steps on
    // a page after the drill's name.
    return (
      <FindingRow icon={<Dumbbell size={17} aria-hidden="true" className="mt-px shrink-0 text-fairway-600" />} label={t("coachReplay.drillSteps")} labelClass="text-fairway-700">
        <ol className="list-decimal pl-4">
          {summary.drill.steps.map((step, i) => (
            <li key={i} data-coach-text className={`${TEXT_CLASS} text-slate-600`}>
              {textOf(t, step)}
            </li>
          ))}
        </ol>
      </FindingRow>
    );
  }
  return null;
}

// ── Measuring ───────────────────────────────────────────────────────────

// Pages per card, as block indices (or a sentence range of one block): one
// list of pages per checkpoint, plus the summary's.
export interface CoachPageLayout {
  checkpoints: PageItem[][][];
  summary: PageItem[][];
}

function CardHeader({ label, approximate, step, t }: { label: string; approximate?: boolean; step?: string; t: T }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase leading-4 tracking-wider text-brand-forest">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold" />
        <span>{label}</span>
        {approximate && (
          <span className="shrink-0 rounded-full bg-sun-50 px-1.5 text-[10px] font-semibold normal-case leading-4 tracking-normal text-sun-700">{t("coachReplay.approximate")}</span>
        )}
      </p>
      {step && <p className="shrink-0 text-[11px] font-semibold leading-4 tabular-nums text-slate-400">{step}</p>}
    </div>
  );
}

// An invisible copy of every card's blocks, laid out at the real card width
// (put it inside the card's slot), measured and paginated. Re-measured when
// its size changes (width, fonts, language) and when the screen height
// changes (rotation), since the budget is a share of the screen.
export function CoachPageMeasurer({
  checkpoints,
  summary,
  onLayout,
}: {
  checkpoints: CoachCheckpoint[];
  summary?: CoachSummary;
  onLayout: (layout: CoachPageLayout) => void;
}) {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef("");
  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const budget = Math.floor(window.innerHeight * COACH_CARD_MAX_SCREEN_FRACTION);
    const chromeOf = (name: string) => (root.querySelector(`[data-measure-chrome="${name}"]`) as HTMLElement | null)?.offsetHeight ?? 0;
    const heightOf = (key: string) => (root.querySelector(`[data-measure-block="${key}"]`) as HTMLElement | null)?.offsetHeight ?? 0;
    // Each block's height, plus each sentence's on its own when it has several.
    const measured = (prefix: string, blocks: { group: number }[], claimAt: (i: number) => CoachClaim | undefined) =>
      blocks.map((b, i) => {
        const n = sentenceCount(t, claimAt(i));
        const sentenceHeights = n > 1 ? Array.from({ length: n }, (_, s) => heightOf(`${prefix}-${i}-s${s}`)) : undefined;
        return { group: b.group, height: heightOf(`${prefix}-${i}`), sentenceHeights };
      });
    const checkpointPages = checkpoints.map((c, ci) => {
      const blocks = checkpointBlocks(c);
      return paginateWithSentences(
        measured(`c${ci}`, blocks, (i) => checkpointClaim(c, blocks[i].id)),
        budget - chromeOf("checkpoint"),
        BLOCK_GAP_PX,
      );
    });
    let summaryPages: PageItem[][] = [];
    if (summary) {
      const blocks = summaryBlocks(summary);
      summaryPages = paginateWithSentences(
        measured("s", blocks, (i) => summaryClaim(summary, blocks[i].id)),
        budget - chromeOf("summary"),
        BLOCK_GAP_PX,
      );
    }
    const layout = { checkpoints: checkpointPages, summary: summaryPages };
    const key = JSON.stringify(layout);
    if (key !== lastRef.current) {
      lastRef.current = key;
      onLayout(layout);
    }
  }, [checkpoints, summary, onLayout, t]);

  useLayoutEffect(() => {
    lastRef.current = "";
    measure();
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [measure, t]);

  return (
    // h-0 + overflow-hidden: laid out at full size for measuring, but takes
    // no space and adds nothing to the page's scroll height.
    <div aria-hidden="true" className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
      <div ref={rootRef}>
        {/* Card chrome without a body: padding, header, the body's top
            margin and the button row. Content budget = screen share - this. */}
        <div data-measure-chrome="checkpoint" className={CARD_CLASS}>
          <CardHeader label="Aa" approximate step="1 of 1" t={t} />
          <div className="mt-2" />
          <div className={BUTTON_ROW_CLASS}>
            <span className={PRIMARY_BUTTON_CLASS}>Aa</span>
          </div>
        </div>
        <div data-measure-chrome="summary" className={CARD_CLASS}>
          <CardHeader label="Aa" step="1 of 1" t={t} />
          <div className="mt-2" />
          <div className={BUTTON_ROW_CLASS}>
            <span className={PRIMARY_BUTTON_CLASS}>Aa</span>
          </div>
        </div>
        {/* Blocks at the card's content width (the card's p-3 inset). */}
        <div className="px-3">
          {checkpoints.map((c, ci) =>
            checkpointBlocks(c).map((b, i) => (
              <div key={`c${ci}-${i}`}>
                <div data-measure-block={`c${ci}-${i}`}>
                  <CheckpointBlockView checkpoint={c} id={b.id} t={t} />
                </div>
                {sentenceCount(t, checkpointClaim(c, b.id)) > 1 &&
                  splitSentences(textOf(t, checkpointClaim(c, b.id)!.body)).map((_, s) => (
                    <div key={s} data-measure-block={`c${ci}-${i}-s${s}`}>
                      <CheckpointBlockView checkpoint={c} id={b.id} t={t} range={[s, s + 1]} />
                    </div>
                  ))}
              </div>
            )),
          )}
          {summary &&
            summaryBlocks(summary).map((b, i) => (
              <div key={`s-${i}`}>
                <div data-measure-block={`s-${i}`}>
                  <SummaryBlockView summary={summary} id={b.id} t={t} />
                </div>
                {sentenceCount(t, summaryClaim(summary, b.id)) > 1 &&
                  splitSentences(textOf(t, summaryClaim(summary, b.id)!.body)).map((_, s) => (
                    <div key={s} data-measure-block={`s-${i}-s${s}`}>
                      <SummaryBlockView summary={summary} id={b.id} t={t} range={[s, s + 1]} />
                    </div>
                  ))}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// Clamp a stored page index to what the (possibly re-measured) layout has.
function usePage(pageCount: number) {
  const [page, setPage] = useState(0);
  const current = Math.min(page, Math.max(0, pageCount - 1));
  return [current, setPage] as const;
}

// ── Cards ───────────────────────────────────────────────────────────────

export interface CoachReplayCardProps {
  checkpoint: CoachCheckpoint;
  // This card's pages (block indices, or a sentence range of one block),
  // from CoachPageMeasurer. Undefined: everything on one page (the demo's
  // short fixed copy).
  pages?: PageItem[][];
  // Step numbering across the whole replay: this card's first page is
  // step `stepOffset + 1` of `stepTotal`.
  stepOffset: number;
  stepTotal: number;
  onContinue: () => void;
  onSkip: () => void;
}

export function CoachReplayCard({ checkpoint, pages, stepOffset, stepTotal, onContinue, onSkip }: CoachReplayCardProps) {
  const { t } = useLocale();
  const reducedMotion = usePrefersReducedMotion();
  const blocks = checkpointBlocks(checkpoint);
  const cardPages: PageItem[][] = pages && pages.length > 0 ? pages : [blocks.map((_, i) => i)];
  const [page, setPage] = usePage(cardPages.length);
  const visible = (cardPages[page] ?? []).map(rangeOf).flatMap(({ block, range }) => (blocks[block] ? [{ ...blocks[block], range }] : []));
  const isLastPage = page >= cardPages.length - 1;
  // Each key moment holds long enough to read, then the swing carries on by
  // itself (Micky, 2026-11-08: it must not just stay paused). Tapping the
  // card holds this page until Continue. Reduced motion keeps the timing but
  // drops the moving countdown bar.
  const [heldPage, setHeldPage] = useState<number | null>(null);
  const autoContinue = heldPage !== page;
  const pageTextLength = visible.reduce((n, b) => n + claimLength(t, b.id === "cue" ? checkpoint.cue : checkpointClaim(checkpoint, b.id), b.range), 0);
  const dwellMs = coachDwellMs(pageTextLength);

  const next = useCallback(() => {
    if (isLastPage) onContinue();
    else setPage(page + 1);
  }, [isLastPage, onContinue, page, setPage]);

  useEffect(() => {
    if (!autoContinue) return;
    const id = window.setTimeout(next, dwellMs);
    return () => window.clearTimeout(id);
  }, [autoContinue, dwellMs, next]);

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t(MOMENT_LABEL_KEYS[checkpoint.label])}
      onClick={() => setHeldPage(page)}
      className={CARD_CLASS}
    >
      <CardHeader
        label={t(MOMENT_LABEL_KEYS[checkpoint.label])}
        approximate={checkpoint.approximate}
        step={t("coachReplay.step", { current: stepOffset + page + 1, total: Math.max(stepTotal, stepOffset + cardPages.length) })}
        t={t}
      />

      <div key={page} className={BODY_CLASS}>
        {visible.map((b) => (
          <CheckpointBlockView key={b.id} checkpoint={checkpoint} id={b.id} t={t} range={b.range} />
        ))}
      </div>

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
            next();
          }}
          className={PRIMARY_BUTTON_CLASS}
        >
          {t("coachReplay.continue")}
          <Play size={12} aria-hidden="true" className="fill-current" />
        </button>
      </div>

      {autoContinue && !reducedMotion && (
        <span
          key={`dwell-${page}`}
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
// drill with its steps, paged like the checkpoint cards when it's long.
// No auto-dismiss: there's nothing left to play into.
export function CoachSummaryCard({ summary, pages, onReplay, onDone }: { summary: CoachSummary; pages?: PageItem[][]; onReplay: () => void; onDone: () => void }) {
  const { t } = useLocale();
  const blocks = summaryBlocks(summary);
  const cardPages: PageItem[][] = pages && pages.length > 0 ? pages : [blocks.map((_, i) => i)];
  const [page, setPage] = usePage(cardPages.length);
  const visible = (cardPages[page] ?? []).map(rangeOf).flatMap(({ block, range }) => (blocks[block] ? [{ ...blocks[block], range }] : []));
  const isLastPage = page >= cardPages.length - 1;
  return (
    <div role="dialog" aria-live="polite" aria-label={t("coachReplay.summaryTitle")} className={CARD_CLASS}>
      <CardHeader
        label={t("coachReplay.summaryTitle")}
        step={cardPages.length > 1 ? t("coachReplay.step", { current: page + 1, total: cardPages.length }) : undefined}
        t={t}
      />

      <div key={page} className={BODY_CLASS}>
        {visible.map((b) => (
          <SummaryBlockView key={b.id} summary={summary} id={b.id} t={t} range={b.range} />
        ))}
      </div>

      <div className={BUTTON_ROW_CLASS}>
        <button onClick={onReplay} className={SECONDARY_BUTTON_CLASS}>
          <RotateCcw size={13} aria-hidden="true" />
          {t("coachReplay.watchAgain")}
        </button>
        {isLastPage ? (
          <button onClick={onDone} className={PRIMARY_BUTTON_CLASS}>
            {t("coachReplay.done")}
          </button>
        ) : (
          <button onClick={() => setPage(page + 1)} className={PRIMARY_BUTTON_CLASS}>
            {t("coachReplay.continue")}
            <Play size={12} aria-hidden="true" className="fill-current" />
          </button>
        )}
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

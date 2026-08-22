import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import { useTutorial } from "../../context/TutorialContext";
import { TUTORIAL_LAST_INDEX, TUTORIAL_STEPS } from "../../lib/tutorialSteps";

const SPOTLIGHT_PADDING = 8;
const CARD_MAX_WIDTH = 340;
const CARD_MARGIN = 16;

function findVisibleTarget(targetId: string): HTMLElement | null {
  const candidates = document.querySelectorAll(`[data-tutorial-id="${targetId}"]`);
  for (const el of candidates) {
    // Both BottomNav (mobile) and SideNav (desktop) tag the same ids;
    // offsetParent is null for the one hidden via Tailwind's responsive
    // classes, so this always picks whichever copy is actually on screen.
    if ((el as HTMLElement).offsetParent !== null) return el as HTMLElement;
  }
  return null;
}

// Fixed, centered card style for steps with no spotlight target (the
// opening welcome and closing screens -- neither points at one widget, so
// there's nothing to position relative to).
const CENTERED_CARD_STYLE: CSSProperties = {
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: `min(${CARD_MAX_WIDTH}px, calc(100vw - ${CARD_MARGIN * 2}px))`,
};

function cardStyleForRect(rect: DOMRect): CSSProperties {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const width = Math.min(CARD_MAX_WIDTH, viewportW - CARD_MARGIN * 2);
  const spaceBelow = viewportH - rect.bottom;
  const spaceAbove = rect.top;
  const placeBelow = spaceBelow > 160 && spaceBelow >= spaceAbove;

  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(CARD_MARGIN, Math.min(left, viewportW - width - CARD_MARGIN));

  return {
    left,
    width,
    ...(placeBelow
      ? { top: Math.min(rect.bottom + CARD_MARGIN, viewportH - CARD_MARGIN) }
      : { top: Math.max(CARD_MARGIN, rect.top - CARD_MARGIN), transform: "translateY(-100%)" }),
  };
}

export function TutorialOverlay() {
  const { t } = useLocale();
  const { active, stepIndex, next, back, skip } = useTutorial();
  const step = TUTORIAL_STEPS[stepIndex];
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!active || !step.targetId) {
      setRect(null);
      return;
    }
    const targetId = step.targetId;
    // Nav-tab targets are position:fixed (always on screen); the Community
    // target is a normal in-flow element that can sit well below the fold
    // depending on how much Home content is above it -- scrollIntoView
    // covers that case too (a no-op for anything already visible).
    const measure = () => {
      const el = findVisibleTarget(targetId);
      if (!el) {
        setRect(null);
        return;
      }
      el.scrollIntoView({ block: "center", behavior: "auto" });
      setRect(el.getBoundingClientRect());
    };
    measure();
    // A step change can mean a real route swap (nav-tab targets, already
    // mounted and stationary -- resolved by the immediate call above) or a
    // RootTabCarousel slide to a different panel (the Community target,
    // which visibly moves during that ~260ms transition) -- these two
    // delayed re-measures catch the settled position (post-scroll,
    // post-slide) either way without an open-ended poll.
    const t1 = window.setTimeout(measure, 80);
    const t2 = window.setTimeout(measure, 320);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [active, step, stepIndex]);

  if (!active) return null;

  const isLastStep = stepIndex === TUTORIAL_LAST_INDEX;
  const isFirstStep = stepIndex === 0;
  // Progress only counts the 5 real feature steps, not this closing screen.
  const showProgress = !isLastStep && stepIndex > 0;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={t(step.titleKey)}>
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-white transition-all duration-300 ease-out"
          style={{
            top: rect.top - SPOTLIGHT_PADDING,
            left: rect.left - SPOTLIGHT_PADDING,
            width: rect.width + SPOTLIGHT_PADDING * 2,
            height: rect.height + SPOTLIGHT_PADDING * 2,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.72)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-900/72 transition-opacity duration-300 ease-out" />
      )}

      {/* Blocks every tap on the real (shaded) interface underneath --
          nothing but this overlay's own controls below is interactive
          while the tutorial is active, so a coach mark can never trigger a
          real send/upload/create action by accident. */}
      <div className="absolute inset-0" />

      <div
        className="absolute flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-xl shadow-slate-900/20"
        style={rect ? cardStyleForRect(rect) : CENTERED_CARD_STYLE}
      >
        {showProgress && (
          <p className="text-xs font-bold uppercase tracking-wide text-fairway-600">
            {t("tutorial.progress", { current: stepIndex + 1, total: TUTORIAL_LAST_INDEX })}
          </p>
        )}
        <div>
          <h3 className="text-base font-bold text-slate-900">{t(step.titleKey)}</h3>
          <p className="mt-1 text-sm text-slate-600">{t(step.textKey)}</p>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          {!isLastStep ? (
            <button
              onClick={skip}
              className="text-xs font-semibold text-slate-400 underline-offset-2 transition-colors duration-150 hover:text-slate-600 hover:underline"
            >
              {t("tutorial.skip")}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {!isFirstStep && !isLastStep && (
              <button
                onClick={back}
                className="rounded-full px-3 py-2 text-sm font-semibold text-slate-500 transition-colors duration-150 hover:bg-slate-100"
              >
                {t("tutorial.back")}
              </button>
            )}
            <button
              onClick={next}
              className="rounded-full bg-fairway-600 px-5 py-2 text-sm font-bold text-white shadow-sm shadow-fairway-900/10 transition-all duration-150 hover:bg-fairway-700"
            >
              {isLastStep ? t("tutorial.startExploring") : t("tutorial.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

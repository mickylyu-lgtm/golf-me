import { useLayoutEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import { useTutorial } from "../../context/TutorialContext";
import { watchTutorialTarget, type TutorialRect } from "../../lib/tutorialSpotlight";
import { TUTORIAL_LAST_INDEX, TUTORIAL_STEPS } from "../../lib/tutorialSteps";

const SPOTLIGHT_PADDING = 8;
const CARD_MAX_WIDTH = 340;
const CARD_MARGIN = 16;

// Fixed, centered card style for steps with no spotlight target (the
// opening welcome and closing screens -- neither points at one widget, so
// there's nothing to position relative to).
const CENTERED_CARD_STYLE: CSSProperties = {
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: `min(${CARD_MAX_WIDTH}px, calc(100vw - ${CARD_MARGIN * 2}px))`,
};

// Opt-in explanatory step only: retain access to controls on short screens
// or enlarged text without scrolling the Settings page behind the card.
const SCROLLABLE_CENTERED_CARD_STYLE: CSSProperties = {
  ...CENTERED_CARD_STYLE,
  maxHeight: "calc(100dvh - 32px)",
  overflowY: "auto",
  overscrollBehavior: "contain",
};

function cardStyleForRect(rect: TutorialRect): CSSProperties {
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
  const [measurement, setMeasurement] = useState<{ targetId: string | null; rect: TutorialRect | null }>({ targetId: null, rect: null });
  const rect = active && measurement.targetId === step.targetId ? measurement.rect : null;
  // Retain the same cutout node/geometry between steps. A temporarily absent
  // lazy-page target fades to a full scrim instead of remounting or flashing.
  const spotlightRect = measurement.rect;

  useLayoutEffect(() => {
    if (!active || !step.targetId) {
      setMeasurement({ targetId: null, rect: null });
      return;
    }
    const targetId = step.targetId;
    return watchTutorialTarget(targetId, (nextRect) => {
      setMeasurement(previous => nextRect
        ? { targetId, rect: nextRect }
        : { ...previous, targetId: null });
    });
  }, [active, step.targetId]);

  if (!active) return null;

  const isLastStep = stepIndex === TUTORIAL_LAST_INDEX;
  const isFirstStep = stepIndex === 0;
  // Keep the existing progress and final-step controls.
  const showProgress = !isLastStep && stepIndex > 0;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={t(step.titleKey)}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-slate-900/72 transition-opacity duration-200 motion-reduce:transition-none"
        style={{ opacity: rect ? 0 : 1 }}
      />
      <div
        aria-hidden="true"
        data-tutorial-spotlight=""
        className="pointer-events-none absolute left-0 top-0 rounded-2xl ring-2 ring-fixed-white transition-[transform,width,height,opacity] duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{
          transform: `translate3d(${(spotlightRect?.left ?? 0) - SPOTLIGHT_PADDING}px, ${(spotlightRect?.top ?? 0) - SPOTLIGHT_PADDING}px, 0)`,
          width: (spotlightRect?.width ?? 0) + SPOTLIGHT_PADDING * 2,
          height: (spotlightRect?.height ?? 0) + SPOTLIGHT_PADDING * 2,
          opacity: rect ? 1 : 0,
          boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.72)",
        }}
      />

      {/* Blocks every tap on the real (shaded) interface underneath --
          nothing but this overlay's own controls below is interactive
          while the tutorial is active, so a coach mark can never trigger a
          real send/upload/create action by accident. */}
      <div className="absolute inset-0" />

      <div
        className="absolute flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-xl shadow-slate-900/20 transition-[top,left,transform] duration-300 ease-out motion-reduce:transition-none"
        style={step.cardPlacement === "center" ? SCROLLABLE_CENTERED_CARD_STYLE : rect ? cardStyleForRect(rect) : CENTERED_CARD_STYLE}
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

        <div className={"flex items-center justify-between gap-3 pt-1" + (step.cardPlacement === "center" ? " flex-wrap" : "")}>
          {!isLastStep ? (
            <button
              onClick={skip}
              className="rounded-full border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-500 transition-colors duration-150 hover:bg-slate-100"
            >
              {t("tutorial.skip")}
            </button>
          ) : (
            <span />
          )}
          <div className={"flex items-center gap-2" + (step.cardPlacement === "center" ? " max-w-full flex-wrap" : "")}>
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

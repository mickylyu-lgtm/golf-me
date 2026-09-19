import { useState } from "react";
import { Users } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Avatar } from "../ui/Avatar";
import { Pill } from "../ui/Pill";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { useLocale } from "../../i18n/LocaleContext";
import type { GolferProfile, HandicapAccuracy } from "../../types";
import type { TranslationKey } from "../../i18n/locales/en";

// Fast (~5-10s), private, conditional review. Three primary questions
// always asked; two secondary questions (on-time, handicap accuracy) only
// when the reviewee actually showed up -- asking them for a no-show would
// require judging something that never happened. No option is
// pre-selected: every Yes/No starts genuinely unanswered so "Yes" never
// reads as the default/expected choice, and Submit stays disabled until
// every required question has an explicit answer.
type NoShowReason = "no_show" | "canceled_late" | "other";

interface State {
  wouldPlayAgain?: boolean;
  showedUp?: boolean;
  respectful?: boolean;
  onTime?: boolean;
  handicapAccuracy?: HandicapAccuracy;
  noShowReason?: NoShowReason;
  privateNote: string;
}

const HANDICAP_OPTIONS: { value: HandicapAccuracy; labelKey: TranslationKey }[] = [
  { value: "accurate", labelKey: "review.handicapYes" },
  { value: "slightly_off", labelKey: "review.handicapSlightlyOff" },
  { value: "very_inaccurate", labelKey: "review.handicapVeryInaccurate" },
  { value: "not_sure", labelKey: "review.handicapNotSure" },
];

// Optional, lightweight categorization for the no-show case -- there's no
// dedicated DB column for this (not part of the approved schema change),
// so a selected reason is folded into the private note as a short
// bracketed tag using its stable English key (e.g. "[no_show]"), not the
// translated display word, so any future parsing of these notes doesn't
// need to handle 6 languages of bracket text. The chip itself is still
// fully translated for the person selecting it.
const NO_SHOW_REASON_OPTIONS: { value: NoShowReason; labelKey: TranslationKey }[] = [
  { value: "no_show", labelKey: "review.noShow" },
  { value: "canceled_late", labelKey: "review.canceledLate" },
  { value: "other", labelKey: "review.other" },
];

function YesNoRow({ value, onChange }: { value: boolean | undefined; onChange: (v: boolean) => void }) {
  const { t } = useLocale();
  return (
    <div className="flex gap-1.5">
      <Pill active={value === true} onClick={() => onChange(true)} className="flex-1 py-2.5 text-center">
        {t("common.yes")}
      </Pill>
      <Pill active={value === false} onClick={() => onChange(false)} className="flex-1 py-2.5 text-center">
        {t("common.no")}
      </Pill>
    </div>
  );
}

interface ReviewModalProps {
  callId: string;
  reviewee: GolferProfile;
  onClose: () => void;
  onSubmitted?: () => void;
}

export function ReviewModal({ callId, reviewee, onClose, onSubmitted }: ReviewModalProps) {
  const { submitReview, isInCircle, addToCircle } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();
  const [state, setState] = useState<State>({ privateNote: "" });
  const alreadyInCircle = isInCircle(reviewee.id);
  const [addCircle, setAddCircle] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const showedUp = state.showedUp;
  const secondaryAnswered = showedUp !== true || (state.onTime !== undefined && state.handicapAccuracy !== undefined);
  const canSubmit = state.wouldPlayAgain !== undefined && showedUp !== undefined && state.respectful !== undefined && secondaryAnswered;

  function submit() {
    if (submitting || !canSubmit || state.wouldPlayAgain === undefined || showedUp === undefined || state.respectful === undefined) return;
    setSubmitting(true);
    const noShowTag = showedUp === false && state.noShowReason ? `[${state.noShowReason}] ` : "";
    const privateNote = `${noShowTag}${state.privateNote.trim()}`.trim() || undefined;
    submitReview(callId, reviewee.id, {
      wouldPlayAgain: state.wouldPlayAgain,
      showedUp,
      respectful: state.respectful,
      onTime: showedUp ? state.onTime : undefined,
      handicapAccuracy: showedUp ? (state.handicapAccuracy ?? "not_sure") : "not_sure",
      privateNote,
    });
    if (!alreadyInCircle && addCircle && state.wouldPlayAgain) addToCircle(reviewee.id);
    showToast(t("review.submittedToast", { name: reviewee.name }), "success");
    onClose();
    onSubmitted?.();
  }

  return (
    <Modal title={t("review.title", { name: reviewee.name })} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Avatar golfer={reviewee} size="md" />
          <p className="text-sm text-slate-500">{t("review.intro", { name: reviewee.name })}</p>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-800">{t("review.wouldPlayAgain")}</p>
          <YesNoRow value={state.wouldPlayAgain} onChange={(v) => setState((s) => ({ ...s, wouldPlayAgain: v }))} />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-800">{t("review.showedUp")}</p>
          <YesNoRow
            value={showedUp}
            onChange={(v) =>
              setState((s) => ({
                ...s,
                showedUp: v,
                // Switching back to "showed up" after answering "no" (or
                // vice versa) clears anything that no longer applies,
                // rather than silently submitting a stale secondary answer.
                onTime: v ? s.onTime : undefined,
                handicapAccuracy: v ? s.handicapAccuracy : undefined,
                noShowReason: v ? undefined : s.noShowReason,
              }))
            }
          />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-800">{t("review.goodPlayingPartner")}</p>
          <YesNoRow value={state.respectful} onChange={(v) => setState((s) => ({ ...s, respectful: v }))} />
        </div>

        {showedUp === true && (
          <>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-800">{t("review.onTime")}</p>
              <YesNoRow value={state.onTime} onChange={(v) => setState((s) => ({ ...s, onTime: v }))} />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-800">{t("review.handicapAccurate", { name: reviewee.name.split(" ")[0] })}</p>
              <div className="flex flex-wrap gap-1.5">
                {HANDICAP_OPTIONS.map((opt) => (
                  <Pill
                    key={opt.value}
                    active={state.handicapAccuracy === opt.value}
                    onClick={() => setState((s) => ({ ...s, handicapAccuracy: opt.value }))}
                  >
                    {t(opt.labelKey)}
                  </Pill>
                ))}
              </div>
            </div>
          </>
        )}

        {showedUp === false && (
          <div>
            <p className="mb-1.5 text-sm font-semibold text-slate-800">{t("review.whatHappened")}</p>
            <div className="flex flex-wrap gap-1.5">
              {NO_SHOW_REASON_OPTIONS.map((opt) => (
                <Pill
                  key={opt.value}
                  active={state.noShowReason === opt.value}
                  onClick={() => setState((s) => ({ ...s, noShowReason: s.noShowReason === opt.value ? undefined : opt.value }))}
                >
                  {t(opt.labelKey)}
                </Pill>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">{t("review.privateNoteLabel")}</label>
          <textarea
            value={state.privateNote}
            onChange={(e) => setState((s) => ({ ...s, privateNote: e.target.value.slice(0, 500) }))}
            rows={2}
            maxLength={500}
            placeholder={t("review.privateNoteHelper", { name: reviewee.name })}
            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-fairway-400"
          />
        </div>

        {alreadyInCircle ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-fairway-700">
            <Users size={13} /> {t("review.alreadyInCircle", { name: reviewee.name })}
          </p>
        ) : (
          state.wouldPlayAgain === true && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-fairway-200 bg-fairway-50 px-3.5 py-3">
              <input type="checkbox" checked={addCircle} onChange={() => setAddCircle((v) => !v)} className="mt-0.5 h-4 w-4 accent-fairway-600" />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-fairway-800">
                  <Users size={14} /> {t("review.addToCircle", { name: reviewee.name })}
                </span>
                <span className="block text-xs text-fairway-700">{t("review.addToCircleDesc")}</span>
              </span>
            </label>
          )
        )}

        <Button onClick={submit} disabled={submitting || !canSubmit} fullWidth>
          {t("review.submit")}
        </Button>
      </div>
    </Modal>
  );
}

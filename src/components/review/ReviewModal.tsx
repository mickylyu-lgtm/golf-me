import { useState } from "react";
import { Users } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Avatar } from "../ui/Avatar";
import { Pill } from "../ui/Pill";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import type { GolferProfile, HandicapAccuracy, PaceOfPlay } from "../../types";

interface State {
  wouldPlayAgain: boolean;
  showedUp: boolean;
  onTime: boolean;
  paceOfPlay: PaceOfPlay;
  respectful: boolean;
  handicapAccuracy: HandicapAccuracy;
  privateNote: string;
}

const PACE_OPTIONS: PaceOfPlay[] = ["Fast", "Good", "Slow"];
const HANDICAP_OPTIONS: { value: HandicapAccuracy; label: string }[] = [
  { value: "accurate", label: "Yes, seemed accurate" },
  { value: "slightly_off", label: "Slightly off" },
  { value: "very_inaccurate", label: "Very inaccurate" },
  { value: "not_sure", label: "Not sure" },
];

function YesNoRow({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-1.5">
      <Pill active={value} onClick={() => onChange(true)} className="flex-1 py-2 text-center">
        Yes
      </Pill>
      <Pill active={!value} onClick={() => onChange(false)} className="flex-1 py-2 text-center">
        No
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
  const [state, setState] = useState<State>({
    wouldPlayAgain: true,
    showedUp: true,
    onTime: true,
    paceOfPlay: "Good",
    respectful: true,
    handicapAccuracy: "accurate",
    privateNote: "",
  });
  const alreadyInCircle = isInCircle(reviewee.id);
  const [addCircle, setAddCircle] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  function submit() {
    if (submitting) return;
    setSubmitting(true);
    submitReview(callId, reviewee.id, {
      wouldPlayAgain: state.wouldPlayAgain,
      showedUp: state.showedUp,
      onTime: state.onTime,
      paceOfPlay: state.paceOfPlay,
      respectful: state.respectful,
      handicapAccuracy: state.handicapAccuracy,
      privateNote: state.privateNote.trim() || undefined,
    });
    if (!alreadyInCircle && addCircle && state.wouldPlayAgain) addToCircle(reviewee.id);
    showToast(`Review for ${reviewee.name} submitted — visible only to Golf Me's trust system.`, "success");
    onClose();
    onSubmitted?.();
  }

  return (
    <Modal title={`Review ${reviewee.name}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Avatar golfer={reviewee} size="md" />
          <p className="text-sm text-slate-500">
            How was your round? This is private and only shapes {reviewee.name}'s GolfMe Credibility — they won't see who wrote it.
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-800">Would you play with them again?</p>
          <YesNoRow value={state.wouldPlayAgain} onChange={(v) => setState((s) => ({ ...s, wouldPlayAgain: v }))} />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-800">Showed up?</p>
          <YesNoRow value={state.showedUp} onChange={(v) => setState((s) => ({ ...s, showedUp: v }))} />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-800">On time?</p>
          <YesNoRow value={state.onTime} onChange={(v) => setState((s) => ({ ...s, onTime: v }))} />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-800">Pace of play</p>
          <div className="flex gap-1.5">
            {PACE_OPTIONS.map((p) => (
              <Pill key={p} active={state.paceOfPlay === p} onClick={() => setState((s) => ({ ...s, paceOfPlay: p }))} className="flex-1 py-2 text-center">
                {p}
              </Pill>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-800">Respectful / good playing partner?</p>
          <YesNoRow value={state.respectful} onChange={(v) => setState((s) => ({ ...s, respectful: v }))} />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-800">
            Was {reviewee.name.split(" ")[0]}'s listed handicap reasonably accurate?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {HANDICAP_OPTIONS.map((opt) => (
              <Pill
                key={opt.value}
                active={state.handicapAccuracy === opt.value}
                onClick={() => setState((s) => ({ ...s, handicapAccuracy: opt.value }))}
              >
                {opt.label}
              </Pill>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-800">Anything we should know? (optional)</label>
          <textarea
            value={state.privateNote}
            onChange={(e) => setState((s) => ({ ...s, privateNote: e.target.value }))}
            rows={2}
            placeholder="Private note — never shown publicly."
            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-fairway-400"
          />
        </div>

        {alreadyInCircle ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-fairway-700">
            <Users size={13} /> {reviewee.name} is already in your Golf Circle.
          </p>
        ) : (
          state.wouldPlayAgain && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-fairway-200 bg-fairway-50 px-3.5 py-3">
              <input type="checkbox" checked={addCircle} onChange={() => setAddCircle((v) => !v)} className="mt-0.5 h-4 w-4 accent-fairway-600" />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-fairway-800">
                  <Users size={14} /> Add {reviewee.name} to your Golf Circle
                </span>
                <span className="block text-xs text-fairway-700">Golfers you've played with and would play with again.</span>
              </span>
            </label>
          )
        )}

        <Button onClick={submit} disabled={submitting} fullWidth>
          Submit review
        </Button>
      </div>
    </Modal>
  );
}

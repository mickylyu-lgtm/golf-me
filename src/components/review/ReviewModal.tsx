import { useState } from "react";
import { Users } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Avatar } from "../ui/Avatar";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import type { GolferProfile } from "../../types";

const CRITERIA: { key: keyof State; label: string; hint: string }[] = [
  { key: "showedUp", label: "Showed Up", hint: "They made it to the round." },
  { key: "onTime", label: "On Time", hint: "Arrived ready at the tee time." },
  { key: "respectful", label: "Respectful", hint: "Good etiquette, easy to play with." },
  { key: "goodPace", label: "Good Pace of Play", hint: "Kept the round moving." },
  { key: "wouldPlayAgain", label: "Would Play Again", hint: "You'd happily join another round with them." },
];

interface State {
  showedUp: boolean;
  onTime: boolean;
  respectful: boolean;
  goodPace: boolean;
  wouldPlayAgain: boolean;
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
    showedUp: true,
    onTime: true,
    respectful: true,
    goodPace: true,
    wouldPlayAgain: true,
  });
  const alreadyInCircle = isInCircle(reviewee.id);
  const [addCircle, setAddCircle] = useState(true);

  function toggle(key: keyof State) {
    setState((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function submit() {
    submitReview(callId, reviewee.id, state);
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
          <p className="text-sm text-slate-500">This review is private and only shapes {reviewee.name}'s Golf Reputation — they won't see who wrote it.</p>
        </div>
        <div className="flex flex-col gap-2">
          {CRITERIA.map(({ key, label, hint }) => (
            <label
              key={key}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-3.5 py-3 transition hover:border-fairway-300"
            >
              <input type="checkbox" checked={state[key]} onChange={() => toggle(key)} className="mt-0.5 h-4 w-4 accent-fairway-600" />
              <span>
                <span className="block text-sm font-semibold text-slate-800">{label}</span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </span>
            </label>
          ))}
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

        <Button onClick={submit} fullWidth>
          Submit review
        </Button>
      </div>
    </Modal>
  );
}

import { MODERATION_NOTE_MAX, MODERATION_REASONS, MODERATION_REASON_LABELS, type ModerationReason } from "../../lib/moderation";

// The required reason picklist + optional note, shared by the remove and
// suspend dialogs. Admin-only, plain English (same as the admin dashboard).
export function ModerationReasonFields({
  reason,
  note,
  onReason,
  onNote,
  disabled,
}: {
  reason: ModerationReason | null;
  note: string;
  onReason: (r: ModerationReason) => void;
  onNote: (n: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
        <legend className="mb-1 text-xs font-semibold text-slate-500">Reason (required)</legend>
        <div className="flex flex-wrap gap-1.5">
          {MODERATION_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onReason(r)}
              aria-pressed={reason === r}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                reason === r ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {MODERATION_REASON_LABELS[r]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-slate-500">{reason === "other" ? "Note (required for Other)" : "Note (optional, only admins see it)"}</span>
        <textarea
          value={note}
          onChange={(e) => onNote(e.target.value.slice(0, MODERATION_NOTE_MAX))}
          disabled={disabled}
          rows={2}
          maxLength={MODERATION_NOTE_MAX}
          className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-fairway-400"
        />
      </label>
    </div>
  );
}

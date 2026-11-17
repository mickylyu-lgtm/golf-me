import { useRef, useState, type ReactNode } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { ModerationReasonFields } from "./ModerationReasonFields";
import { SUSPENSION_DURATIONS, moderationInputProblem, suspensionUntil, type ModerationReason, type SuspensionDurationKey } from "../../lib/moderation";
import { supabase } from "../../lib/supabase";

// Admin "Suspend user" (admin_suspend_user). Enforced server-side: while
// suspended they can sign in, read and delete their account, but can't post,
// comment, like, message, react, host or join rounds. Lifted from the admin
// dashboard (or it ends by itself).
export function SuspendUserDialog({
  userId,
  name,
  onClose,
  onSuspended,
  ban = false,
  context,
}: {
  ban?: boolean;
  context?: ReactNode;
  userId: string;
  name: string;
  onClose: () => void;
  onSuspended: () => void;
}) {
  const [duration, setDuration] = useState<SuspensionDurationKey>(ban ? "indefinite" : "7d");
  const [reason, setReason] = useState<ModerationReason | null>(null);
  const [note, setNote] = useState("");
  const [hideContent, setHideContent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const submitting = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const problem = moderationInputProblem(reason, note);

  async function submit() {
    if (submitting.current || outcomeUnknown || problem || (ban && !confirmed)) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError, status } = await supabase.rpc("admin_suspend_user", {
        p_user_id: userId,
        p_until: ban ? null : suspensionUntil(duration),
        p_reason: reason,
        p_note: note.trim() || null,
        p_hide_content: hideContent,
      });
      setBusy(false);
      if (rpcError) {
        if (status === 0 || status >= 500) {
          setOutcomeUnknown(true);
          setError("Could not confirm the result. Close and refresh the account status before trying again.");
        } else {
          setError(rpcError.message);
        }
        return;
      }
      onSuspended();
    } catch {
      setOutcomeUnknown(true);
      setError("Could not confirm the result. Close and refresh the account status before trying again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title={`${ban ? "Ban" : "Suspend"} ${name}`} onClose={() => !busy && onClose()}>
      <div className="flex flex-col gap-4">
        {context}
        {ban && <p className="text-sm font-semibold text-red-700">This is an indefinite, reversible suspension, not account deletion. Lift it from the dashboard’s moderation controls.</p>}
        <p className="text-sm text-slate-600">
          They can still sign in, read and delete their account, but can't post, comment, like, message, react, host or join rounds, or change their profile name, bio or photo. They see a banner
          with the suspension status. Others see nothing different on their profile.
        </p>
        {!ban && <fieldset className="flex flex-col gap-1.5" disabled={busy}>
          <legend className="mb-1 text-xs font-semibold text-slate-500">How long</legend>
          <div className="flex flex-wrap gap-1.5">
            {SUSPENSION_DURATIONS.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setDuration(d.key)}
                aria-pressed={duration === d.key}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  duration === d.key ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </fieldset>}
        <ModerationReasonFields reason={reason} note={note} onReason={setReason} onNote={setNote} disabled={busy} />
        <label className="flex items-start gap-2.5 text-sm text-slate-700">
          <input type="checkbox" checked={hideContent} onChange={(e) => setHideContent(e.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 accent-red-600" />
          <span>
            Also hide their existing posts and comments while suspended
            <span className="block text-xs text-slate-500">They come back when the suspension ends or is lifted.</span>
          </span>
        </label>
        {ban && <label className="flex items-start gap-2.5 text-sm text-slate-700"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 accent-red-600" /><span>I reviewed this account and the evidence. A flag alone does not prove abuse.</span></label>}
        {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">Couldn't suspend: {error}</p>}
        <div className="flex gap-3">
          <Button variant="outline" fullWidth disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" fullWidth disabled={busy || outcomeUnknown || problem !== null || (ban && !confirmed)} onClick={submit}>
            {busy ? "Saving…" : ban ? "Confirm ban" : "Suspend"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

import { useState } from "react";
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
}: {
  userId: string;
  name: string;
  onClose: () => void;
  onSuspended: () => void;
}) {
  const [duration, setDuration] = useState<SuspensionDurationKey>("7d");
  const [reason, setReason] = useState<ModerationReason | null>(null);
  const [note, setNote] = useState("");
  const [hideContent, setHideContent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = moderationInputProblem(reason, note);

  async function submit() {
    if (busy || problem) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("admin_suspend_user", {
      p_user_id: userId,
      p_until: suspensionUntil(duration),
      p_reason: reason,
      p_note: note.trim() || null,
      p_hide_content: hideContent,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onSuspended();
  }

  return (
    <Modal title={`Suspend ${name}`} onClose={() => !busy && onClose()}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          They can still sign in, read and delete their account, but can't post, comment, like, message, react, host or join rounds. They see a banner
          with the end date. Others see nothing different on their profile.
        </p>
        <fieldset className="flex flex-col gap-1.5" disabled={busy}>
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
        </fieldset>
        <ModerationReasonFields reason={reason} note={note} onReason={setReason} onNote={setNote} disabled={busy} />
        <label className="flex items-start gap-2.5 text-sm text-slate-700">
          <input type="checkbox" checked={hideContent} onChange={(e) => setHideContent(e.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 accent-red-600" />
          <span>
            Also hide their existing posts and comments while suspended
            <span className="block text-xs text-slate-500">They come back when the suspension ends or is lifted.</span>
          </span>
        </label>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">Couldn't suspend: {error}</p>}
        <div className="flex gap-3">
          <Button variant="outline" fullWidth disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" fullWidth disabled={busy || problem !== null} onClick={submit}>
            {busy ? "Suspending…" : "Suspend"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

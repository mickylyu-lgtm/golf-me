import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { ModerationReasonFields } from "./ModerationReasonFields";
import { moderationInputProblem, type ModerationReason } from "../../lib/moderation";
import { supabase } from "../../lib/supabase";

// Admin "Remove post / comment" for everyone (admin_remove_post /
// admin_remove_comment). Soft removal: restorable from the admin dashboard;
// the author gets a bell notification.
export function RemoveContentDialog({
  kind,
  id,
  authorName,
  onClose,
  onRemoved,
}: {
  kind: "post" | "comment";
  id: string;
  authorName: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [reason, setReason] = useState<ModerationReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = moderationInputProblem(reason, note);

  async function submit() {
    if (busy || problem) return;
    setBusy(true);
    setError(null);
    const fn = kind === "post" ? "admin_remove_post" : "admin_remove_comment";
    const args = kind === "post" ? { p_post_id: id, p_reason: reason, p_note: note.trim() || null } : { p_comment_id: id, p_reason: reason, p_note: note.trim() || null };
    const { error: rpcError } = await supabase.rpc(fn, args);
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onRemoved();
  }

  return (
    <Modal title={kind === "post" ? "Remove post for everyone" : "Remove comment for everyone"} onClose={() => !busy && onClose()}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          Hides this {kind} from every user, including {authorName}, who gets a notification that it broke the community guidelines. You can restore it
          from the admin dashboard.
        </p>
        <ModerationReasonFields reason={reason} note={note} onReason={setReason} onNote={setNote} disabled={busy} />
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">Couldn't remove it: {error}</p>}
        <div className="flex gap-3">
          <Button variant="outline" fullWidth disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" fullWidth disabled={busy || problem !== null} onClick={submit}>
            {busy ? "Removing…" : kind === "post" ? "Remove post" : "Remove comment"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

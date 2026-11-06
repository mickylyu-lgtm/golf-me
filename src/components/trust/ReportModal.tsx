import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { REPORT_CATEGORIES, ROUND_ONLY_REPORT_CATEGORIES } from "../../types";
import type { Report, ReportCategory } from "../../types";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";

interface ReportModalProps {
  reportedId: string;
  reportedName: string;
  context: Report["context"];
  golfCallId?: string;
  postId?: string;
  commentId?: string;
  messageId?: string;
  onClose: () => void;
}

export function ReportModal({ reportedId, reportedName, context, golfCallId, postId, commentId, messageId, onClose }: ReportModalProps) {
  const { reportUser } = useData();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  // Waits for the server: "Report submitted" only once the report is saved.
  // A failure keeps the chosen reason and the details, says so, and the
  // button retries; a second tap while sending does nothing.
  async function submit() {
    if (!category || submitting) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      await reportUser(reportedId, category, details.trim(), context, { golfCallId, postId, commentId, messageId });
    } catch (err) {
      console.error("GolfMe: failed to submit report.", err);
      setSubmitError(true);
      setSubmitting(false);
      return;
    }
    showToast("Report submitted. Our trust & safety team will review it — thank you for keeping GolfMe safe.", "success");
    onClose();
  }

  return (
    // Not dismissable mid-send: closing would look like a cancel while the
    // report is still being written.
    <Modal title={`Report ${reportedName}`} onClose={() => !submitting && onClose()} keyboardAware>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-500">Reports are confidential. {reportedName} will not be notified.</p>
        <div className="flex flex-col gap-1.5">
          {REPORT_CATEGORIES.filter((c) => context === "round" || !ROUND_ONLY_REPORT_CATEGORIES.includes(c)).map((c) => (
            <label
              key={c}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition ${
                category === c ? "border-fairway-400 bg-fairway-50" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <input type="radio" name="report-category" className="accent-fairway-600" checked={category === c} onChange={() => setCategory(c)} />
              {c}
            </label>
          ))}
        </div>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Add any details that could help our review (optional)"
          rows={3}
          className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-fairway-400"
        />
        {submitError && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
            Your report wasn't sent. Check your connection and try again — what you wrote is still here.
          </p>
        )}
        <Button disabled={!category || submitting} aria-busy={submitting || undefined} onClick={submit} fullWidth>
          {submitting ? "Sending…" : submitError ? "Try again" : "Submit report"}
        </Button>
        {/* Opens the guidelines in a new screen only when nothing typed would
            be lost; otherwise the link waits until the report is sent. */}
        <button
          onClick={() => {
            if (submitting) return;
            onClose();
            navigate("/community/guidelines");
          }}
          disabled={submitting || Boolean(details.trim())}
          className="text-center text-xs font-semibold text-fairway-700 hover:underline disabled:text-slate-400 disabled:no-underline"
        >
          Read Community Guidelines
        </button>
      </div>
    </Modal>
  );
}

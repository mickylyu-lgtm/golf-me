import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { REPORT_CATEGORIES } from "../../types";
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
  onClose: () => void;
}

export function ReportModal({ reportedId, reportedName, context, golfCallId, postId, commentId, onClose }: ReportModalProps) {
  const { reportUser } = useData();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState("");

  function submit() {
    if (!category) return;
    reportUser(reportedId, category, details.trim(), context, { golfCallId, postId, commentId });
    showToast("Report submitted. Our trust & safety team will review it — thank you for keeping Golf Me safe.", "success");
    onClose();
  }

  return (
    <Modal title={`Report ${reportedName}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-500">Reports are confidential. {reportedName} will not be notified.</p>
        <div className="flex flex-col gap-1.5">
          {REPORT_CATEGORIES.map((c) => (
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
        <Button disabled={!category} onClick={submit} fullWidth>
          Submit report
        </Button>
        <button
          onClick={() => {
            onClose();
            navigate("/community/guidelines");
          }}
          className="text-center text-xs font-semibold text-fairway-700 hover:underline"
        >
          Read Community Guidelines
        </button>
      </div>
    </Modal>
  );
}

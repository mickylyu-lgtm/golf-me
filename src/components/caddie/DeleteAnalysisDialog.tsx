import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { useLocale } from "../../i18n/LocaleContext";
import { caddieErrorText } from "../../lib/caddieErrorText";
import type { CaddieAnalysis } from "../../types";

// Confirm sheet for deleting one Caddie analysis (Micky 2026-11-06: "a
// delete button on Caddie so people can delete the failed attempts or ones
// they don't like anymore"). Rendered inside CaddieLocaleScope, so every
// line is in the Caddie language. The server (delete_caddie_analysis)
// refuses a live job and never refunds the daily allowance; a Community
// post the golfer shared keeps its own copy of the video and text.
export function DeleteAnalysisDialog({ analysis, onClose, onDeleted }: { analysis: CaddieAnalysis; onClose: () => void; onDeleted?: () => void }) {
  const { deleteCaddieAnalysis } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();
  const mentionsPost = analysis.sharedToCommunity || !!analysis.sourcePostId;
  const message = mentionsPost ? `${t("caddie.delete.body")} ${t("caddie.delete.postStays")}` : t("caddie.delete.body");

  return (
    <ConfirmDialog
      title={t("caddie.delete.title")}
      message={message}
      confirmLabel={t("caddie.delete.confirm")}
      danger
      onConfirm={async () => {
        try {
          await deleteCaddieAnalysis(analysis.id);
          showToast(t("caddie.delete.done"), "info");
          onClose();
          onDeleted?.();
        } catch (err) {
          showToast(caddieErrorText(err, t, "caddie.delete.failed"), "warning");
          onClose();
        }
      }}
      onCancel={onClose}
    />
  );
}

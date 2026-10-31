import { useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { useLocale } from "../../i18n/LocaleContext";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useLocale();
  // An async onConfirm (leave/cancel/complete a round) keeps both buttons
  // disabled until it settles, so a second tap can't fire it twice.
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-sm text-slate-600">{message}</p>
      <div className="mt-5 flex gap-3">
        <Button variant="outline" fullWidth disabled={busy} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button variant={danger ? "danger" : "primary"} fullWidth disabled={busy} onClick={handleConfirm}>
          {confirmLabel ?? t("common.confirm")}
        </Button>
      </div>
    </Modal>
  );
}

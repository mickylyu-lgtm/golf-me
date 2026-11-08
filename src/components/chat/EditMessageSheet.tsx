import { useLayoutEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/locales/en";
import { copyText } from "../../lib/share";
import { editDraftState, type EditResult } from "../../lib/messageEdit";

// The "Edit" sheet a hold on my own text message opens (MessageActionsMenu ->
// Edit), for DMs and round chats. Its own textarea in the shared keyboard-
// aware Modal (the same sheet ReportModal uses inside the DM thread), so the
// thread's composer, its draft, the list's scroll and the chat's keyboard /
// viewport code are never touched: the composer's draft is still there
// after Save or Cancel.
//
// The server decides (lib/messageEdit.ts): this device's clock only decided
// whether Edit was offered. Save is never disabled by a local countdown; a
// save that reaches the server after the 5 minutes comes back "expired" and
// the sheet says so, keeps the golfer's text in the field and offers Copy
// text. The same for a message unsent meanwhile (here or on another device).
interface EditMessageSheetProps {
  // The text when the sheet opened (the field starts with it, and it's what
  // the server is told the golfer saw: a newer edit from another device is
  // then a conflict, not a silent overwrite).
  initialText: string;
  // The message as this device has it now (realtime keeps it fresh).
  currentText: string;
  // Unsent (or gone) meanwhile.
  gone: boolean;
  onSave: (text: string, expectedText: string | undefined) => Promise<EditResult>;
  onClose: () => void;
}

type Notice = { key: TranslationKey; terminal: boolean };

function noticeFor(result: EditResult): Notice | null {
  switch (result) {
    case "edited":
    case "unchanged":
      return null;
    case "expired":
      return { key: "chat.editExpired", terminal: true };
    case "unsent":
      return { key: "chat.editUnsent", terminal: true };
    case "notAllowed":
    case "notText":
      return { key: "chat.editNotAllowed", terminal: true };
    case "unsupported":
      return { key: "chat.editUnavailable", terminal: true };
    case "suspended":
      return { key: "moderation.accountSuspended", terminal: true };
    case "conflict":
      return { key: "chat.editConflict", terminal: false };
    case "objectionable":
      return { key: "moderation.objectionableContent", terminal: false };
    case "empty":
      return { key: "chat.editEmpty", terminal: false };
    default:
      return { key: "chat.editFailed", terminal: false };
  }
}

export function EditMessageSheet({ initialText, currentText, gone, onSave, onClose }: EditMessageSheetProps) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(initialText);
  // undefined after a conflict was shown: the golfer has seen it, the next
  // Save replaces whatever the message says now.
  const [expected, setExpected] = useState<string | undefined>(initialText);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // Into the field with the cursor at the end, in the same tap that opened
  // the sheet (so iOS can bring the keyboard up).
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    const end = field.value.length;
    field.setSelectionRange(end, end);
  }, []);

  const shown: Notice | null = gone && !notice?.terminal ? { key: "chat.editUnsent", terminal: true } : notice;
  const terminal = Boolean(shown?.terminal);
  const state = editDraftState(draft, currentText);

  async function save() {
    if (saving || terminal) return;
    if (state === "empty") {
      setNotice({ key: "chat.editEmpty", terminal: false });
      return;
    }
    if (state === "unchanged") {
      onClose();
      return;
    }
    setSaving(true);
    let result: EditResult;
    try {
      result = await onSave(draft, expected);
    } catch {
      result = "failed";
    }
    setSaving(false);
    if (result === "edited" || result === "unchanged") {
      onClose();
      return;
    }
    if (result === "conflict") setExpected(undefined);
    setNotice(noticeFor(result));
  }

  async function copy() {
    if (await copyText(draft)) setCopied(true);
  }

  return (
    <Modal title={t("chat.editTitle")} onClose={() => !saving && onClose()} keyboardAware>
      <div className="flex flex-col gap-3">
        <textarea
          ref={fieldRef}
          value={draft}
          aria-label={t("chat.editFieldLabel")}
          onChange={(e) => {
            setDraft(e.target.value);
            setCopied(false);
            if (notice && !notice.terminal && notice.key !== "chat.editConflict") setNotice(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
          readOnly={saving}
          rows={4}
          className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-fairway-400 [overflow-wrap:anywhere]"
        />
        {shown ? (
          <p role="alert" className={`rounded-xl px-3 py-2 text-xs leading-relaxed ${terminal ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"}`}>
            {t(shown.key)}
          </p>
        ) : (
          <p className="text-xs text-slate-500">{t("chat.editHint")}</p>
        )}
        {terminal ? (
          <div className="flex gap-2">
            <Button variant="outline" fullWidth icon={<Copy size={15} aria-hidden="true" />} onClick={() => void copy()} disabled={!draft.trim()}>
              {copied ? t("chat.copied") : t("chat.copyText")}
            </Button>
            <Button fullWidth onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" fullWidth onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button fullWidth onClick={() => void save()} disabled={saving || state === "empty"} aria-busy={saving || undefined}>
              {saving ? t("chat.editSaving") : t("chat.editSave")}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

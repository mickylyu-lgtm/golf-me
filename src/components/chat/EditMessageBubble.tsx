import { useId, useLayoutEffect, useRef, useState } from "react";
import { Check, Copy, LoaderCircle, X } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/locales/en";
import { copyText } from "../../lib/share";
import { editDraftState, type EditResult } from "../../lib/messageEdit";
import { isImeComposing } from "../../lib/isImeComposing";

// Rendered in the message's own row, separate from the send composer and
// its draft. A hidden text mirror sizes the field like the normal bubble;
// long drafts wrap and then scroll rather than opening a large sheet.
// The existing RPC remains the authority for ownership and the edit window.
interface EditMessageBubbleProps {
  // The text when editing opened (the field starts with it, and it's what
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

export function EditMessageBubble({ initialText, currentText, gone, onSave, onClose }: EditMessageBubbleProps) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(initialText);
  // undefined after a conflict was shown: the golfer has seen it, the next
  // Save replaces whatever the message says now.
  const [expected, setExpected] = useState<string | undefined>(initialText);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef(true);
  const savingRef = useRef(false);
  const noticeId = useId();

  // Focus synchronously with the opening tap, including on iOS.
  useLayoutEffect(() => {
    activeRef.current = true;
    const field = fieldRef.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    const end = field.value.length;
    field.setSelectionRange(end, end);
    return () => { activeRef.current = false; };
  }, []);

  const shown: Notice | null = gone && !notice?.terminal ? { key: "chat.editUnsent", terminal: true } : notice;
  const terminal = Boolean(shown?.terminal);
  const state = editDraftState(draft, currentText);

  async function save() {
    if (savingRef.current || terminal) return;
    if (state === "empty") {
      setNotice({ key: "chat.editEmpty", terminal: false });
      return;
    }
    if (state === "unchanged") {
      onClose();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    let result: EditResult;
    try {
      result = await onSave(draft, expected);
    } catch {
      result = "failed";
    }
    if (!activeRef.current) return;
    savingRef.current = false;
    setSaving(false);
    if (result === "edited" || result === "unchanged") {
      onClose();
      return;
    }
    if (result === "conflict") setExpected(undefined);
    setNotice(noticeFor(result));
  }

  async function copy() {
    if (await copyText(draft) && activeRef.current) setCopied(true);
  }

  const control = "flex h-8 w-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 disabled:opacity-40";
  const field = "col-start-1 row-start-1 min-w-0 px-3.5 py-2 text-base leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]";

  return (
    <div data-chat-edit className="flex min-w-0 max-w-full flex-col items-end gap-1">
      <div className="relative grid min-w-[3.5rem] max-w-full rounded-2xl rounded-br-sm bg-fairway-600 text-white ring-1 ring-fairway-300 ring-offset-2">
        <span aria-hidden="true" className={[field, "invisible max-h-40 overflow-hidden"].join(" ")}>{draft + "\u200b"}</span>
        <textarea
          ref={fieldRef}
          value={draft}
          aria-label={t("chat.editFieldLabel")}
          aria-describedby={shown ? noticeId : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setCopied(false);
            if (notice && !notice.terminal && notice.key !== "chat.editConflict") setNotice(null);
          }}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === "Escape" && !savingRef.current) {
              e.preventDefault();
              onClose();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
          readOnly={saving || terminal}
          rows={1}
          style={{ outline: "none" }}
          className={[field, "absolute inset-0 h-full max-h-40 w-full resize-none overflow-y-auto rounded-[inherit] border-0 bg-transparent text-white outline-none"].join(" ")}
        />
      </div>
      {shown && (
        <p id={noticeId} role="alert" className={["max-w-full rounded-xl px-3 py-2 text-xs leading-relaxed", terminal ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"].join(" ")}>
          {t(shown.key)}
        </p>
      )}
      <div className="flex items-center gap-1">
        {terminal && (
          <button
            type="button"
            aria-label={copied ? t("chat.copied") : t("chat.copyText")}
            title={copied ? t("chat.copied") : t("chat.copyText")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void copy()}
            disabled={!draft.trim()}
            className={[control, "bg-slate-100 text-slate-600 hover:bg-slate-200"].join(" ")}
          >
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          </button>
        )}
        <button
          type="button"
          aria-label={terminal ? t("common.close") : t("common.cancel")}
          title={terminal ? t("common.close") : t("common.cancel")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClose}
          disabled={saving}
          className={[control, "bg-slate-100 text-slate-600 hover:bg-slate-200"].join(" ")}
        >
          <X size={16} aria-hidden="true" />
        </button>
        {!terminal && (
          <button
            type="button"
            aria-label={saving ? t("chat.editSaving") : t("chat.editSave")}
            title={saving ? t("chat.editSaving") : t("chat.editSave")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void save()}
            disabled={saving || state === "empty"}
            aria-busy={saving || undefined}
            className={[control, "bg-fairway-600 text-white hover:bg-fairway-700"].join(" ")}
          >
            {saving ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          </button>
        )}
      </div>
    </div>
  );
}

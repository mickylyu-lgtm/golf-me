import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Flag, Share2, X } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { Button } from "../ui/Button";

interface FirstRoundPromptDialogProps {
  onHost: () => void;
  /** Maybe Later, the X, Escape and a backdrop tap all land here. */
  onLater: () => void;
  onInvite: () => void;
}

// "Host your first round" -- presentational only; FirstRoundPromptContext
// decides when it shows and what each action does. Same centered-card look
// as PushPrePermissionPrompt so the onboarding prompts read as one family.
export function FirstRoundPromptDialog({ onHost, onLater, onInvite }: FirstRoundPromptDialogProps) {
  const { t } = useLocale();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onLater();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onLater]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-round-prompt-title"
      className="fixed inset-0 z-[105] flex items-end justify-center bg-slate-900/40 px-4 pb-8 sm:items-center"
      style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onLater();
      }}
    >
      <div className="animate-slide-up relative flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-white p-6 text-center shadow-xl shadow-slate-900/20">
        <button
          type="button"
          onClick={onLater}
          aria-label={t("firstRound.close")}
          className="absolute right-3 top-3 rounded-full p-1.5 text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={18} />
        </button>
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-fairway-50 text-fairway-600">
          <Flag size={26} />
        </span>
        <div>
          <h2 id="first-round-prompt-title" className="text-lg font-extrabold text-slate-900">
            {t("firstRound.title")}
          </h2>
          <p className="mt-1.5 text-sm text-slate-500">{t("firstRound.body")}</p>
        </div>
        <div className="flex w-full flex-col gap-2.5">
          <Button size="lg" fullWidth onClick={onHost}>
            {t("firstRound.host")}
          </Button>
          <Button variant="outline" fullWidth icon={<Share2 size={15} />} onClick={onInvite}>
            {t("firstRound.inviteFriends")}
          </Button>
          <button
            type="button"
            onClick={onLater}
            className="rounded-full px-4 py-2.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
          >
            {t("firstRound.later")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

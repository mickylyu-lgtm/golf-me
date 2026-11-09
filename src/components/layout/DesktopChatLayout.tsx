import type { ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import { Inbox } from "../../pages/Inbox";
import { useLocale } from "../../i18n/LocaleContext";

// Desktop only (AppShell mounts this at 1280px+ on /messages routes; phones keep
// the single-column list -> conversation flow). The chat list stays on the
// left while a conversation is open on the right. The conversation screens
// themselves (DirectMessageThread, RoundChatThread) are rendered unchanged
// as `children`: they size their own message box from where it starts on
// screen, so a narrower column needs nothing from them.
export function DesktopChatLayout({ children }: { children: ReactNode | null }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-1 items-start gap-6">
      <div className="sticky top-[5.5rem] max-h-[calc(100dvh-7.5rem)] w-[340px] shrink-0 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
        <Inbox />
      </div>
      <div className="flex min-w-0 flex-1 flex-col self-stretch">
        {children ?? (
          <div className="flex min-h-[calc(100dvh-10rem)] flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-fairway-50 text-fairway-700">
              <MessageCircle size={22} aria-hidden />
            </span>
            <p className="font-semibold text-slate-800">{t("chatInbox.pickConversation")}</p>
            <p className="max-w-xs text-sm text-slate-500">{t("chatInbox.pickConversationBody")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

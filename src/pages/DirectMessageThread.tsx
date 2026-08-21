import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Eraser, MoreHorizontal, ShieldAlert, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ReportModal } from "../components/trust/ReportModal";
import { ChatComposer } from "../components/chat/ChatComposer";
import { dmDraftKey, loadChatDraft, saveChatDraft } from "../lib/chatDraft";
import { handicapLabel } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";

export function DirectMessageThread() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentUser,
    getGolfer,
    isBlocked,
    blockUser,
    unblockUser,
    canMessage,
    messagesWithGolfer,
    sendDirectMessage,
    markConversationRead,
    clearChatHistory,
    deleteConversation,
  } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();

  const [text, setText] = useState(() => (id ? loadChatDraft(dmDraftKey(id)) : ""));
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const other = id ? getGolfer(id) : undefined;
  const messages = id ? messagesWithGolfer(id) : [];
  const blocked = id ? isBlocked(id) : false;
  const eligible = id ? canMessage(id) : false;

  // markConversationRead's own identity changes on every refetch (it's
  // built from conversationIdWith, which depends on the `participants`
  // array — a brand-new array reference each refetch even when the data is
  // identical), so it can't safely sit in this effect's dependency array:
  // doing so created a real feedback loop — mark-read triggers a refetch,
  // the refetch produces a new participants array, that gives
  // markConversationRead a new identity, which re-triggers this effect,
  // which marks read again... Confirmed live in the request logs as a
  // sustained burst of dozens of requests/second while a thread was open,
  // which is almost certainly what was making notifications and incoming
  // messages look like they'd stopped working (the connection was saturated
  // re-fetching the same thread over and over). A ref sidesteps this: the
  // effect only re-runs for the reasons that actually matter (opening a
  // different thread, or a genuinely new message arriving), while always
  // calling whatever the latest markConversationRead happens to be.
  const markConversationReadRef = useRef(markConversationRead);
  markConversationReadRef.current = markConversationRead;
  useEffect(() => {
    if (id) markConversationReadRef.current(id);
  }, [id, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Switching straight from one thread to another reuses this same mounted
  // component (only the `id` route param changes), so without this the
  // previous thread's still-typed draft would just carry over into whatever
  // conversation is opened next instead of that conversation's own draft.
  useEffect(() => {
    setText(id ? loadChatDraft(dmDraftKey(id)) : "");
  }, [id]);

  function updateText(value: string) {
    setText(value);
    if (id) saveChatDraft(dmDraftKey(id), value);
  }

  if (id === currentUser.id) return <Navigate to="/profile" replace />;
  if (!other) {
    return (
      <div className="py-12 text-center text-slate-500">
        Golfer not found.
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  async function handleSend() {
    if (!text.trim() || !other) return;
    const pendingText = text;
    updateText("");
    const sent = await sendDirectMessage(other.id, pendingText);
    if (!sent) {
      updateText(pendingText);
      showToast("Message didn't send — try again in a moment.", "info");
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          onClick={() => navigate(`/golfer/${other.id}`)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1 py-1 text-left transition hover:bg-slate-50"
        >
          <Avatar golfer={other} size="sm" />
          <div className="min-w-0">
            <p className="flex items-center gap-1 truncate text-sm font-bold text-slate-900">
              <span className="truncate">{other.name}</span>
              {other.verification.verifiedGolfer && <ShieldCheck size={13} className="shrink-0 text-fairway-500" />}
            </p>
            <p className="truncate text-xs text-slate-500">{handicapLabel(other.handicap, t)} · View Profile</p>
          </div>
        </button>
        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More options"
            className="rounded-full p-2 text-slate-400 transition-all duration-200 ease-out hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
          >
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-10 mt-1 w-52 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setClearConfirmOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-50"
              >
                <Eraser size={15} /> {t("chat.clearHistory")}
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setDeleteConfirmOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-50"
              >
                <Trash2 size={15} /> {t("chat.deleteConversation")}
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setReportOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-50"
              >
                <ShieldAlert size={15} /> Report
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  if (blocked) {
                    unblockUser(other.id);
                    showToast(`Unblocked ${other.name}.`, "info");
                  } else {
                    setBlockConfirmOpen(true);
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition-colors duration-150 hover:bg-red-50"
              >
                <ShieldOff size={15} /> {blocked ? "Unblock" : "Block"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bounded to the actual visible viewport (dvh, not vh -- accounts for
          mobile browser chrome) rather than the message list having its own
          separately-scrolling max-height with the composer just sticky
          against the page below it -- those were two different scroll
          contexts, so the sticky composer could end up floating on top of
          (hiding) the message list's own last message instead of sitting
          cleanly below it. flex-1 + min-h-0 here makes the message list the
          only thing that scrolls, and the composer just always sits after
          it, guaranteed never overlapping. */}
      <div className="flex h-[calc(100dvh-13rem)] flex-col rounded-2xl border border-slate-100 bg-white">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <p className="my-auto text-center text-sm text-slate-400">
              {eligible ? "No messages yet — say hello." : "You can't message this golfer."}
            </p>
          )}
          {messages.map((m) => {
            const isMe = m.senderId === currentUser.id;
            return (
              <div key={m.id} className={`flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                <Avatar golfer={isMe ? currentUser : other} size="xs" showVerified={false} />
                <div
                  className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                    isMe ? "rounded-br-sm bg-fairway-600 text-white" : "rounded-bl-sm bg-slate-100 text-slate-800"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="shrink-0 rounded-b-2xl bg-white">
          {blocked ? (
            <p className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500">
              You've blocked {other.name}. Unblock them to send messages.
            </p>
          ) : !eligible ? (
            <p className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500">
              You can't message this golfer right now.
            </p>
          ) : (
            <ChatComposer value={text} onChange={updateText} onSend={handleSend} />
          )}
        </div>
      </div>

      {reportOpen && <ReportModal reportedId={other.id} reportedName={other.name} context="chat" onClose={() => setReportOpen(false)} />}
      {clearConfirmOpen && (
        <ConfirmDialog
          title={t("chat.clearHistoryConfirmTitle")}
          message={t("chat.clearHistoryConfirmMessage")}
          confirmLabel={t("chat.clear")}
          danger
          onConfirm={async () => {
            try {
              await clearChatHistory(other.id);
              showToast(t("chat.historyClearedToast"), "info");
            } catch (err) {
              showToast(err instanceof Error ? err.message : "Couldn't clear chat history.", "warning");
            } finally {
              setClearConfirmOpen(false);
            }
          }}
          onCancel={() => setClearConfirmOpen(false)}
        />
      )}
      {deleteConfirmOpen && (
        <ConfirmDialog
          title={t("chat.deleteConversationConfirmTitle")}
          message={t("chat.deleteConversationConfirmMessage")}
          confirmLabel={t("chat.delete")}
          danger
          onConfirm={async () => {
            try {
              await deleteConversation(other.id);
              showToast(t("chat.conversationDeletedToast"), "info");
              navigate("/messages");
            } catch (err) {
              showToast(err instanceof Error ? err.message : "Couldn't delete conversation.", "warning");
              setDeleteConfirmOpen(false);
            }
          }}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
      {blockConfirmOpen && (
        <ConfirmDialog
          title={`Block ${other.name}?`}
          message="You won't see each other's profiles or Golf Calls, and they won't be able to message you. You can unblock anytime."
          confirmLabel="Block"
          danger
          onConfirm={() => {
            blockUser(other.id);
            setBlockConfirmOpen(false);
            showToast(`Blocked ${other.name}.`, "info");
          }}
          onCancel={() => setBlockConfirmOpen(false)}
        />
      )}
    </div>
  );
}

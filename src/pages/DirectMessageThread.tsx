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
import { FounderBadge } from "../components/golfer/TrustBadges";
import { dmDraftKey, loadChatDraft, saveChatDraft } from "../lib/chatDraft";
import { useKeyboardHeight } from "../lib/useKeyboardHeight";
import { handicapLabel } from "../lib/format";
import { isFounder } from "../lib/founder";
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
  const listRef = useRef<HTMLDivElement>(null);
  // Whether the user was scrolled at (or very near) the newest message the
  // last time they touched the list themselves -- captured continuously on
  // scroll, not re-derived after the fact, so it reflects their intent
  // rather than wherever a resize happens to have left scrollTop. Starts
  // true so a freshly opened thread opens pinned to its latest message, same
  // as before.
  const nearBottomRef = useRef(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxTop, setBoxTop] = useState<number | null>(null);

  // boxTop is the one remaining JS measurement here -- this page's own
  // header row isn't sticky/fixed, so nothing else knows where the box
  // starts. Only re-measured on a real window resize/rotation, not per
  // keyboard event.
  useEffect(() => {
    const measure = () => setBoxTop(boxRef.current?.getBoundingClientRect().top ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  // Native resize:"body" (capacitor.config.ts) is the single source of
  // truth for available height now -- the WKWebView frame itself shrinks
  // for the keyboard, and CSS's 100dvh tracks that natively, so there's no
  // JS keyboard-height pixel value in this calc at all. keyboardOpen is
  // only a boolean (same signal BottomNav already uses to hide itself),
  // toggling whether BottomNav's footprint needs reserving below the box --
  // it disappears once the keyboard is open, so reserving it then would
  // leave an unused gap between the last message and the keyboard.
  //
  // An earlier attempt at exactly this (0e51cb9, reverted 13 min later at
  // 648fbeb) was tested against a build where @capacitor/keyboard was never
  // actually linked into the native iOS project -- ios/App/CapApp-SPM/
  // Package.swift never listed it until this pass (`npx cap sync ios`), so
  // resize:"body" could never have been active during that test. This is a
  // deliberate re-test now that the plugin is genuinely linked, not a
  // guess -- per explicit instruction, needs physical-iPhone verification,
  // not assumed working from this recompute alone.
  const keyboardOpen = useKeyboardHeight() > 0;
  const boxHeight = boxTop === null ? undefined : `calc(100dvh - ${boxTop}px${keyboardOpen ? "" : " - 4.25rem - env(safe-area-inset-bottom)"})`;

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

  // Tracks nearBottomRef off the list's own scroll position -- cheap, and
  // the only thing that should ever decide "was the user reading the
  // newest message or something older," independent of why the list's
  // height might later change.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const NEAR_BOTTOM_PX = 120;
    const update = () => {
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [id]);

  // A new message (sent or received) only pins to the bottom if the user
  // was already there -- someone reading older messages shouldn't get
  // yanked down just because a new one arrived (see nearBottomRef above).
  useEffect(() => {
    const el = listRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Switching to a different thread always opens at its latest message,
  // same as opening any chat app fresh -- not gated on nearBottomRef, which
  // still holds the *previous* thread's state at this point.
  useEffect(() => {
    nearBottomRef.current = true;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [id]);

  // The list's own height changes for reasons that have nothing to do with
  // new messages arriving -- the composer growing to a second line, a
  // plain window resize/rotation, or now the keyboard opening/closing
  // (boxHeight's own dvh recompute above resizes the box, which resizes
  // this list). One signal covers all of those instead of separately
  // tracking each cause -- deliberately the single owner for keyboard
  // geometry, not one of two competing correction paths. Same near-bottom
  // rule as message arrival: only re-pin if that's where the user already
  // was; otherwise a plain height change leaves scrollTop untouched on its
  // own, which is exactly "preserve their reading position" for free.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (nearBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The chat box below is sized to fit the viewport exactly (see its own
  // comment), but that's a best-effort calc(), not a hard guarantee --
  // reported live as the page itself still being scrollable even once the
  // composer was reliably on-screen. A real chat UI (iMessage, WhatsApp)
  // never scrolls as a whole page; only the message list does. Locking body
  // scroll while this thread is open (same technique already used for
  // CaddieSwingReplay's fullscreen mode) makes that true regardless of
  // whether the height math above is ever slightly off.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // (The old WKWebView keyboard-pan-vs-sticky-TopBar cancel-scroll hack --
  // useCancelKeyboardViewportPan, force-scrolling to (0,0) on every
  // visualViewport pan -- is gone. capacitor.config.ts's Keyboard
  // resize:"body" config fixes the actual pan at the native layer instead
  // of fighting it in JS after the fact.)

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
              {isFounder(other.id) ? (
                <FounderBadge />
              ) : (
                other.verification.verifiedGolfer && <ShieldCheck size={13} className="shrink-0 text-fairway-500" />
              )}
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

      {/* Bounded to the actual visible viewport rather than the message list
          having its own separately-scrolling max-height with the composer
          just sticky against the page below it -- those were two different
          scroll contexts, so the sticky composer could end up floating on
          top of (hiding) the message list's own last message instead of
          sitting cleanly below it. flex-1 + min-h-0 here makes the message
          list the only thing that scrolls, and the composer just always
          sits after it, guaranteed never overlapping.

          Height comes from boxHeight above -- window.innerHeight minus
          boxTop minus the real keyboard height (see the comment by its
          calculation for why viewport/dvh-based values don't work under
          resize:"body"). */}
      <div ref={boxRef} className="flex flex-col rounded-2xl border border-slate-100 bg-white" style={{ height: boxHeight }}>
        {/* A leading mt-auto spacer bottom-anchors a short thread against the
            composer (empty space above, like every real chat app) instead of
            stacking from the top. This used to be justify-end on the
            scrollable div itself, which turned out to be a real bug, not
            just visually irrelevant once overflowing as the old comment
            assumed: justify-content: flex-end on an overflow-y-auto flex
            column makes the browser misreport scrollHeight as equal to
            clientHeight (confirmed live via the GolfMe:run skill --
            removing justify-end alone took a genuinely-overflowing list's
            reported scrollHeight from 239 to 876), i.e. the browser doesn't
            think there's anything to scroll even when there plainly is.
            margin-top: auto on a leading spacer gets the same "pack to the
            bottom when short" visual result without touching the
            container's own justify-content, so real overflow scrolling
            (and everything built on it above -- near-bottom detection,
            scrollTop math) actually works. */}
        <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
          <div className="mt-auto" />
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

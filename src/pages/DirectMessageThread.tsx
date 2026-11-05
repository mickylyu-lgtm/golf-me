import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Eraser, MoreHorizontal, Reply, ShieldAlert, ShieldCheck, ShieldOff, Trash2, X } from "lucide-react";
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
import { lockPageScroll } from "../lib/scrollLock";
import { useTypingIndicator } from "../lib/useTypingIndicator";
import { TypingBubble } from "../components/chat/TypingBubble";
import { handicapLabel } from "../lib/format";
import { isFounder } from "../lib/founder";
import { useLocale } from "../i18n/LocaleContext";
import { formatMessageTime } from "../lib/messageTime";
import { useSwipeToRevealTimes } from "../lib/useSwipeToRevealTimes";
import { useSwipeToReply } from "../lib/useSwipeToReply";
import { useWebKeyboardInset } from "../lib/useWebKeyboardInset";
import { useMessageLongPress } from "../lib/useMessageLongPress";
import { MessageActionsMenu } from "../components/chat/MessageActionsMenu";
import { useExitPresence } from "../lib/useExitPresence";
import { FOCUS_EXIT_MS } from "../lib/messageFocus";
import { ReactionPill } from "../components/chat/ReactionPill";
import { canUnsendMessage, unsendRemainingMs } from "../lib/unsend";
import { messageActions } from "../lib/messageLongPress";
import { QUICK_REACTIONS, canReactToMessage, groupReactionsByMessage, myReaction, nextReaction, summarizeReactions, type QuickReaction } from "../lib/reactions";
import { copyText } from "../lib/share";
import { goBack } from "../lib/goBack";
import { followNewMessages, messagesAfter } from "../lib/chatScroll";
import { NewMessagesPill } from "../components/chat/NewMessagesPill";
import { type FailedDm, sendDmWithRecovery } from "../lib/dmFailedSend";
import { Capacitor } from "@capacitor/core";

const IS_NATIVE = Capacitor.isNativePlatform();

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
    canReplyToMessages,
    canUnsendMessages,
    unsendDirectMessage,
    canReactToMessages,
    messageReactions,
    setMessageReaction,
    markConversationRead,
    clearChatHistory,
    deleteConversation,
    isOtherTyping,
    sendTypingSignal,
  } = useData();
  const { showToast } = useToast();
  const { t, locale } = useLocale();

  const [text, setText] = useState(() => (id ? loadChatDraft(dmDraftKey(id)) : ""));
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  // Swipe-to-reply (useSwipeToReply): the message the next send quotes, and
  // the original briefly highlighted after tapping a quote.
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimerRef = useRef(0);
  // Sends that failed after the golfer had already typed something newer or
  // picked a new reply (lib/dmFailedSend.ts): kept as "Not sent" bubbles
  // instead of overwriting the composer. Page-local, per thread id.
  const [failedSends, setFailedSends] = useState<FailedDm[]>([]);
  // The composer as it is right now, for a send that settles later (its
  // own closure only has the values from when Send was tapped). Read as
  // null once the page has unmounted.
  const composerRef = useRef<{ threadId: string | undefined; text: string; replyToId: string | null }>({ threadId: id, text, replyToId });
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    composerRef.current = { threadId: id, text, replyToId };
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const listRef = useRef<HTMLDivElement>(null);
  // Wraps the message rows only (inside listRef) so the swipe-to-reveal-
  // times gesture can move them all with one transform. See
  // useSwipeToRevealTimes; it never touches listRef's scroll or size.
  const rowsRef = useRef<HTMLDivElement>(null);
  // Whether the user was scrolled at (or very near) the newest message the
  // last time they touched the list themselves -- captured continuously on
  // scroll, not re-derived after the fact, so it reflects their intent
  // rather than wherever a resize happens to have left scrollTop. Starts
  // true so a freshly opened thread opens pinned to its latest message, same
  // as before.
  const nearBottomRef = useRef(true);
  // Someone else's messages that arrived while the golfer was reading older
  // ones (the "New messages" pill; see the message effect below).
  const [unseenCount, setUnseenCount] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxTop, setBoxTop] = useState<number | null>(null);

  // boxTop is the one remaining JS measurement here -- this page's own
  // header row isn't sticky/fixed, so nothing else knows where the box
  // starts. Only re-measured on a real window resize/rotation, not per
  // keyboard event.
  //
  // Measured in a layout effect, before the first paint: route changes are
  // transitions (React Router 7), so a passive effect ran a frame after the
  // thread first painted, and that first frame showed an unsized box -- the
  // oldest messages, no composer -- before snapping to the newest message
  // (the "jump" opening a thread, worst from a notification). Re-run once
  // the thread body exists (hasThread): opened from a push/notification
  // before the golfer's profile has loaded, the first render is "Golfer not
  // found" with no box, and the box never got measured once it appeared.
  const hasThread = Boolean(id && getGolfer(id));
  useLayoutEffect(() => {
    const measure = () => setBoxTop(boxRef.current?.getBoundingClientRect().top ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [hasThread]);
  const keyboardHeight = useKeyboardHeight();
  // Confirmed live on a physical iPhone, on a build where the Keyboard
  // plugin is genuinely linked (accessory bar correctly disappears, proving
  // native events do fire): 100dvh does NOT track resize:"body"'s frame
  // shrink -- boxHeight stayed at its pre-keyboard size, pushing the
  // composer off-screen below the keyboard with a large blank gap above it.
  // This isolates the earlier revert (0e51cb9/648fbeb) as a real finding,
  // not just a symptom of the plugin being unlinked at the time -- the two
  // questions (is the plugin linked / does dvh track its resize) are now
  // answered separately and dvh genuinely doesn't work here. keyboardHeight
  // from the plugin's own keyboardWillShow/Hide event payload is real,
  // native-reported data and the only value that reliably reflects the
  // keyboard's actual height on this device.
  //
  // Web (iPhone Safari / PWA) has no plugin events, so there the keyboard
  // height comes from the visual viewport instead (useWebKeyboardInset,
  // disabled in the native app). Exactly one source per platform, so the
  // two can never add up to a double offset.
  const webKeyboardInset = useWebKeyboardInset(!IS_NATIVE, boxRef);
  const keyboardInset = IS_NATIVE ? keyboardHeight : webKeyboardInset;
  const boxHeight =
    boxTop === null
      ? undefined
      : keyboardInset > 0
        ? `${window.innerHeight - boxTop - keyboardInset}px`
        : `calc(${window.innerHeight}px - ${boxTop}px - 4.25rem - env(safe-area-inset-bottom))`;

  const other = id ? getGolfer(id) : undefined;
  const messages = id ? messagesWithGolfer(id) : [];
  const blocked = id ? isBlocked(id) : false;
  const eligible = id ? canMessage(id) : false;
  const otherTyping = other ? isOtherTyping(other.id) : false;
  useSwipeToRevealTimes(listRef, rowsRef, Boolean(other));
  // Swipe right on a bubble to reply. Called synchronously inside the
  // gesture's pointerup (a user gesture), so focusing the composer here is
  // the same kind of focus ChatComposer's own send button makes; the
  // keyboard (if it opens) is then handled by the unchanged
  // keyboardHeight/boxHeight code exactly as for a tap on the textarea.
  // Bubbles carry data-reply-bubble only while this is true, so with
  // replying off a right swipe on a bubble does nothing.
  const replyEnabled = Boolean(other) && eligible && !blocked && canReplyToMessages;
  // Also the menu's Reply (a click, i.e. a user gesture, same as the swipe's
  // pointerup), so the focus/keyboard path is identical.
  const startReply = (messageId: string) => {
    setReplyToId(messageId);
    const textarea = boxRef.current?.querySelector("textarea");
    if (textarea && document.activeElement !== textarea) textarea.focus({ preventScroll: true });
  };
  useSwipeToReply(listRef, replyEnabled, startReply);
  // Hold (touch) / right-click (mouse) ANY message bubble that isn't unsent
  // opens the actions menu (useMessageLongPress, MessageActionsMenu): quick
  // reactions, Reply, Copy, and Unsend for MY message within 5 minutes
  // (lib/unsend.ts). nowMs ticks once at the next window expiry so a lapsed
  // message stops offering Unsend without a reload; the server still
  // decides (it answers "expired" if this clock is slow).
  const reactEnabled = Boolean(other) && eligible && !blocked && canReactToMessages;
  const reactionsByMessage = useMemo(() => groupReactionsByMessage(messageReactions), [messageReactions]);
  const [actionsFor, setActionsFor] = useState<{ id: string; bubble: HTMLElement } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const unsendEnabled = Boolean(other) && canUnsendMessages;
  const unsendableIds = new Set(
    unsendEnabled ? messages.filter((m) => canUnsendMessage(m, currentUser.id, nowMs)).map((m) => m.id) : [],
  );
  const nextUnsendExpiry = unsendEnabled
    ? Math.min(...messages.filter((m) => unsendableIds.has(m.id)).map((m) => unsendRemainingMs(m.createdAt, nowMs)))
    : Infinity;
  useEffect(() => {
    if (!Number.isFinite(nextUnsendExpiry)) return;
    const t = window.setTimeout(() => setNowMs(Date.now()), nextUnsendExpiry + 50);
    return () => window.clearTimeout(t);
  }, [nextUnsendExpiry]);
  useMessageLongPress(listRef, Boolean(other), (messageId, bubble) => {
    const m = messages.find((x) => x.id === messageId);
    if (!m || m.unsentAt) return;
    // Unsend is re-checked with a fresh clock at the moment of the press.
    setNowMs(Date.now());
    setActionsFor({ id: messageId, bubble });
  });
  const closeActions = useCallback(() => setActionsFor(null), []);
  // The menu stays mounted FOCUS_EXIT_MS after closing so its focus
  // overlay animates out (MessageActionsMenu `closing`).
  const actionsShown = useExitPresence(actionsFor, FOCUS_EXIT_MS);

  // A reply target belongs to one thread; a highlight timer never outlives
  // the page.
  useEffect(() => setReplyToId(null), [id]);
  useEffect(() => setActionsFor(null), [id]);
  useEffect(() => () => window.clearTimeout(highlightTimerRef.current), []);

  // Ephemeral only -- never a persisted message, never touches unread
  // counts/notifications. useTypingIndicator reads this via a ref (see its
  // own comment), so this closure's identity churning on every unrelated
  // refetch is harmless.
  const sendTypingSignalForThread = useCallback(
    (active: boolean) => {
      if (other) sendTypingSignal(other.id, active);
    },
    [other, sendTypingSignal],
  );
  const { notifyTyping, stop: stopTyping } = useTypingIndicator(sendTypingSignalForThread);

  // DirectMessageThread reuses one mounted component instance across a
  // thread switch (only the `id` route param changes -- see the draft-
  // loading effect below), so useTypingIndicator's own unmount-only cleanup
  // never fires on a plain switch. This explicitly stops typing for the
  // conversation being LEFT when that happens -- gated on the actual
  // previous/next golfer id (a stable primitive), not on `other`'s object
  // identity or sendTypingSignal's function identity, both of which churn
  // on every unrelated realtime refetch and would otherwise fire this far
  // too often.
  const previousOtherIdRef = useRef<string | undefined>(other?.id);
  useEffect(() => {
    const previousOtherId = previousOtherIdRef.current;
    previousOtherIdRef.current = other?.id;
    if (previousOtherId && previousOtherId !== other?.id) sendTypingSignal(previousOtherId, false);
  }, [other?.id, sendTypingSignal]);

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
      // Scrolled back down to the newest message: the pill has done its job.
      if (nearBottomRef.current) setUnseenCount(0);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [id, hasThread]);

  // New messages (lib/chatScroll.ts followNewMessages): the golfer's own
  // (optimistic, confirmed or "Not sent") always pins to the bottom, even
  // when they were reading older messages; someone else's pins only if they
  // were already near the bottom, otherwise it's counted for the "New
  // messages" pill instead of yanking them down. A layout effect, so the
  // pin lands in the same frame as the new bubble (a real DM's bubble
  // appears after a network round trip, outside the tap, where a passive
  // effect could paint one frame with it below the composer).
  const lastSeenIdRef = useRef<string | null>(null);
  const failedCountRef = useRef(failedSends.length);
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useLayoutEffect(() => {
    const el = listRef.current;
    const added = messagesAfter(messages, lastSeenIdRef.current);
    lastSeenIdRef.current = lastMessageId;
    const failedGrew = failedSends.length > failedCountRef.current;
    failedCountRef.current = failedSends.length;
    const { pin, unseen } = followNewMessages({ added, selfId: currentUser.id, nearBottom: nearBottomRef.current });
    if (el && (pin || failedGrew || nearBottomRef.current)) {
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
      setUnseenCount(0);
    } else if (unseen > 0) setUnseenCount((n) => n + unseen);
    // messages is read for its new tail only; these keys change exactly
    // when that tail does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, lastMessageId, failedSends.length]);
  useEffect(() => setUnseenCount(0), [id]);
  const showLatest = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    nearBottomRef.current = true;
    setUnseenCount(0);
  };

  // Switching to a different thread always opens at its latest message,
  // same as opening any chat app fresh -- not gated on nearBottomRef, which
  // still holds the *previous* thread's state at this point.
  useEffect(() => {
    nearBottomRef.current = true;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [id, hasThread]);

  // The box got its real height (boxTop above, measured before paint):
  // pin in that same frame too, before it paints, rather than waiting for
  // the ResizeObserver a frame later. Same near-bottom rule as everywhere.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [boxTop]);

  // The list's own height changes for reasons that have nothing to do with
  // new messages arriving -- the composer growing to a second line, a
  // plain window resize/rotation. A ResizeObserver on the list itself is
  // one signal that covers all of those instead of trying to separately
  // track each cause. Same near-bottom rule as message arrival: only
  // re-pin if that's where the user already was; otherwise a plain height
  // change leaves scrollTop untouched on its own, which is exactly
  // "preserve their reading position" for free.
  //
  // NOT the keyboard's own resize -- ResizeObserver callbacks fire
  // asynchronously after layout (effectively a frame behind), so the box
  // would visibly resize first and the scroll correction would snap a
  // moment later: a real, mechanically-explained two-stage jump. keyboardHeight
  // below handles that case synchronously instead, before paint, so
  // there's only one visible step. This effect still fires for a
  // keyboard-driven resize too (the list's size changes either way), but
  // by then scrollTop is already correct, making its own assignment a
  // harmless no-op -- not a second competing mechanism, just the same
  // safety net still covering the cases keyboardHeight doesn't.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (nearBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasThread]);

  // The keyboard opening/closing is the one resize cause already known
  // about directly (via keyboardHeight, not by waiting to notice the list
  // changed size) -- useLayoutEffect runs synchronously right after the
  // boxHeight/DOM update above but before the browser paints, so the
  // scroll correction lands in the SAME visual frame as the resize itself
  // instead of one frame later. This is the single source of truth for
  // keyboard-triggered scroll correction; the ResizeObserver above keeps
  // its own, different job (composer growth, rotation).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [keyboardInset]);

  // The chat box below is sized to fit the viewport exactly (see its own
  // comment), but that's a best-effort calc(), not a hard guarantee --
  // reported live as the page itself still being scrollable even once the
  // composer was reliably on-screen. A real chat UI (iMessage, WhatsApp)
  // never scrolls as a whole page; only the message list does. Locking body
  // scroll while this thread is open (same technique already used for
  // CaddieSwingReplay's fullscreen mode) makes that true regardless of
  // whether the height math above is ever slightly off.
  // Counted (lib/scrollLock): a sheet opened over the thread (Report) and
  // released in any order never leaves the page stuck or unlocked.
  // Layout effect: locked from the thread's first painted frame, so a
  // fling still running from the page the golfer left (a scrolled feed
  // when a notification was tapped) can't scroll it before the lock.
  useLayoutEffect(() => lockPageScroll(), []);

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

  // Only the composer's own onChange (real keystrokes) should ever signal
  // typing -- updateText() alone is also called to clear/restore text
  // programmatically (send, failed-send rollback), which must never look
  // like the user just typed something.
  function handleComposerChange(value: string) {
    updateText(value);
    notifyTyping();
  }

  if (id === currentUser.id) return <Navigate to="/profile" replace />;
  if (!other) {
    return (
      <div className="py-12 text-center text-slate-500">
        Golfer not found.
        <div className="mt-4">
          {/* Opened from a push or a link there may be no in-app page to
              go back to (lib/goBack.ts): fall back to the Inbox. */}
          <Button variant="outline" onClick={() => goBack(navigate, "/messages")}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  const messagesById = new Map(messages.map((m) => [m.id, m]));
  const replyTarget = replyToId ? messagesById.get(replyToId) : undefined;
  // The menu's message; gone (e.g. unsent from the other phone, or just
  // unsent from the menu) = no menu, and no exit animation either.
  const actionsCandidate = actionsShown.value ? messagesById.get(actionsShown.value.id) : undefined;
  const actionsMessage = actionsCandidate && !actionsCandidate.unsentAt ? actionsCandidate : undefined;

  function senderLabel(senderId: string) {
    return senderId === currentUser.id ? t("chat.you") : (other?.name ?? "");
  }

  // Tap a quote: scroll the list (only its own scrollTop, like a user
  // scroll) to the original and flash it.
  function jumpToMessage(messageId: string) {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-reply-row="${CSS.escape(messageId)}"]`);
    if (!list || !row) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const top = list.scrollTop + (rowRect.top - listRect.top) - Math.max(0, (listRect.height - rowRect.height) / 2);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    list.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
    setHighlightId(messageId);
    window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightId(null), 1400);
  }

  async function handleUnsend(messageId: string) {
    setActionsFor(null);
    if (replyToId === messageId) setReplyToId(null);
    const result = await unsendDirectMessage(messageId);
    if (result === "expired") {
      setNowMs(Date.now());
      showToast(t("chat.unsendExpired"), "info");
    } else if (result === "failed") showToast(t("chat.unsendFailed"), "warning");
  }

  // Tap an emoji in the row: set / replace; the same one again removes it.
  // Tap my reaction pill: remove. Optimistic (the context rolls back).
  async function handleReact(messageId: string, emoji: QuickReaction | null) {
    setActionsFor(null);
    if (!(await setMessageReaction(messageId, emoji))) showToast(t("chat.reactionFailed"), "warning");
  }

  async function handleCopy(messageId: string) {
    setActionsFor(null);
    const m = messagesById.get(messageId);
    if (m && (await copyText(m.text))) showToast(t("chat.copied"), "info");
  }

  function showSendFailed(result: "failed" | "objectionable") {
    if (result === "objectionable") showToast(t("moderation.objectionableContent"), "warning");
    else showToast("Message didn't send — try again in a moment.", "info");
  }

  // A failed send never overwrites newer input (lib/dmFailedSend.ts): the
  // text goes back into the composer only if it is still empty with no
  // reply picked; otherwise it stays as a "Not sent" bubble below.
  async function handleSend() {
    if (!text.trim() || !other) return;
    const threadId = other.id;
    const { result } = await sendDmWithRecovery({
      threadId,
      text,
      replyToId: replyTarget?.id ?? null,
      clear: () => {
        updateText("");
        setReplyToId(null);
        stopTyping();
      },
      send: (body, replyTo) => sendDirectMessage(threadId, body, replyTo ?? undefined),
      snapshot: () => (mountedRef.current ? composerRef.current : null),
      loadDraft: (thread) => loadChatDraft(dmDraftKey(thread)),
      restore: (body, replyTo) => {
        setText(body);
        saveChatDraft(dmDraftKey(threadId), body);
        setReplyToId(replyTo);
      },
      saveDraft: (thread, body) => saveChatDraft(dmDraftKey(thread), body),
      keepFailed: (failed) => setFailedSends((prev) => [...prev, failed]),
      newKey: () => crypto.randomUUID(),
    });
    if (result !== "sent") showSendFailed(result);
  }

  // Retry from a "Not sent" bubble: the composer is left alone; a second
  // failure just puts the bubble back.
  async function retryFailedSend(failed: FailedDm) {
    setFailedSends((prev) => prev.filter((f) => f.key !== failed.key));
    const result = await sendDirectMessage(failed.threadId, failed.text, failed.replyToId ?? undefined);
    if (result === "sent") return;
    setFailedSends((prev) => [...prev, { ...failed, objectionable: result === "objectionable" }]);
    showSendFailed(result);
  }

  function discardFailedSend(key: string) {
    setFailedSends((prev) => prev.filter((f) => f.key !== key));
  }

  const threadFailedSends = failedSends.filter((f) => f.threadId === other.id);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => goBack(navigate, "/messages")}
          aria-label={t("common.back")}
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
                    // Promise.resolve: unblockUser returns a Promise that
                    // rejects on a failed save (GolferProfilePage pattern).
                    Promise.resolve(unblockUser(other.id)).then(
                      () => showToast(`Unblocked ${other.name}.`, "info"),
                      () => showToast(`Couldn't unblock ${other.name}. Check your connection and try again.`, "warning"),
                    );
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
        {/* overflow-x-hidden + touch-action:pan-y + data-no-swipe are for the
            swipe-to-reveal-times gesture only (useSwipeToRevealTimes): the
            rows wrapper below slides left and each row's time label sits
            just past this list's right clip edge. Vertical scrolling stays
            fully native; nothing here changes scrollTop or the list's size. */}
        <div
          ref={listRef}
          data-no-swipe
          className="flex min-h-0 flex-1 touch-pan-y flex-col gap-3 overflow-x-hidden overflow-y-auto px-4 py-4"
        >
          <div className="mt-auto" />
          {messages.length === 0 && threadFailedSends.length === 0 && (
            <p className="my-auto text-center text-sm text-slate-400">
              {eligible ? "No messages yet — say hello." : "You can't message this golfer."}
            </p>
          )}
          <div ref={rowsRef} className="flex flex-col gap-3">
            {messages.map((m) => {
              const isMe = m.senderId === currentUser.id;
              const sent = formatMessageTime(m.createdAt, locale, t);
              const quoted = m.replyToId ? messagesById.get(m.replyToId) : undefined;
              // Unsent: a quiet placeholder where the message was (the text
              // is already gone). Not a reply/unsend target.
              if (m.unsentAt) {
                return (
                  <div key={m.id} data-reply-row={m.id} className={`relative flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                    <span className="shrink-0 rounded-full">
                      <Avatar golfer={isMe ? currentUser : other} size="xs" showVerified={false} />
                    </span>
                    <p className="max-w-[75%] rounded-2xl border border-dashed border-slate-200 px-3.5 py-2 text-xs text-slate-400 italic">
                      {isMe ? t("chat.youUnsent") : t("chat.theyUnsent", { name: other.name })}
                    </p>
                  </div>
                );
              }
              const messageReactionRows = canReactToMessages && canReactToMessage(m) ? reactionsByMessage.get(m.id) : undefined;
              const reactionSummary = messageReactionRows ? summarizeReactions(messageReactionRows, m.id, currentUser.id) : [];
              const mineReacted = reactionSummary.some((s) => s.mine);
              return (
                // data-reply-row/-arrow/-bubble: the DOM contract
                // useSwipeToReply drives (only the bubble moves).
                <div key={m.id} data-reply-row={m.id} className={`relative flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                  {/* Swipe-to-reply arrow (useSwipeToReply positions it
                      just left of the bubble as the bubble slides right). */}
                  <span
                    data-reply-arrow
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-0 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-slate-100 text-slate-500 opacity-0"
                  >
                    <Reply size={14} />
                  </span>
                  {/* Tap goes to that golfer's profile; a long press magnifies
                      the photo (Avatar swallows the click after it). */}
                  <button
                    type="button"
                    aria-label="View Profile"
                    onClick={() => navigate(isMe ? "/profile" : `/golfer/${other.id}`)}
                    data-reply-avatar
                    className="shrink-0 rounded-full"
                  >
                    <Avatar golfer={isMe ? currentUser : other} size="xs" showVerified={false} />
                  </button>
                  <div
                    data-reply-bubble={replyEnabled ? m.id : undefined}
                    // Hold / right-click -> actions menu (useMessageLongPress).
                    // On touch screens no iOS selection callout / text
                    // selection (Copy is in the menu); a mouse still selects.
                    data-actions-bubble={m.id}
                    // data-pressing (set by useMessageLongPress while a hold
                    // is building): eases down to PRESS_SCALE via the CSS
                    // `scale` property, which composes with the inline
                    // `transform` useSwipeToReply writes. No layout change.
                    // While the menu is open the bubble is drawn by its
                    // focus copy (MessageActionsMenu), no ring here.
                    className={`relative max-w-[75%] rounded-2xl px-3.5 py-2 text-sm transition-[box-shadow,scale] duration-300 ease-out data-pressing:scale-[0.97] data-pressing:duration-[350ms] [overflow-wrap:anywhere] pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none] ${
                      isMe ? "rounded-br-sm bg-fairway-600 text-white" : "rounded-bl-sm bg-slate-100 text-slate-800"
                    } ${highlightId === m.id ? "ring-2 ring-amber-300 ring-offset-2" : ""} ${reactionSummary.length > 0 ? "mb-4" : ""}`}
                  >
                    {/* Quote of the replied-to message, taken only from
                        messages this reader already has loaded (RLS-visible
                        to them); anything else is "unavailable". */}
                    {m.replyToId &&
                      (quoted ? (
                        <button
                          type="button"
                          onClick={() => jumpToMessage(quoted.id)}
                          aria-label={t("chat.showOriginal")}
                          className={`mb-1.5 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-xs ${
                            isMe ? "border-white/70 bg-white/15 text-white/90" : "border-fairway-500 bg-white/80 text-slate-600"
                          }`}
                        >
                          <span className={`block font-semibold ${isMe ? "text-white" : "text-slate-700"}`}>{senderLabel(quoted.senderId)}</span>
                          <span className={`line-clamp-2 ${quoted.unsentAt ? "italic" : ""}`}>{quoted.unsentAt ? t("chat.messageUnsent") : quoted.text}</span>
                        </button>
                      ) : (
                        <div
                          className={`mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs italic ${
                            isMe ? "border-white/50 bg-white/10 text-white/80" : "border-slate-300 bg-white/70 text-slate-500"
                          }`}
                        >
                          {t("chat.originalUnavailable")}
                        </div>
                      ))}
                    {m.text}
                    <ReactionPill
                      summary={reactionSummary}
                      alignRight={isMe}
                      label={t("chat.reactionsLabel", { list: reactionSummary.map((s) => (s.count > 1 ? `${s.emoji} ${s.count}` : s.emoji)).join(" ") })}
                      removeLabel={t("chat.removeReaction")}
                      onRemoveMine={mineReacted && reactEnabled ? () => handleReact(m.id, null) : null}
                    />
                  </div>
                  {sent && (
                    <time
                      dateTime={m.createdAt}
                      className="pointer-events-none absolute top-1/2 left-[calc(100%+1rem)] flex w-[4.25rem] -translate-y-1/2 flex-col items-center text-center text-[10px] leading-tight whitespace-nowrap text-slate-400 tabular-nums"
                    >
                      {sent.day && <span>{sent.day}</span>}
                      <span className="text-[11px] font-medium text-slate-500">{sent.time}</span>
                    </time>
                  )}
                </div>
              );
            })}
            {/* Failed sends kept aside so newer input wasn't overwritten
                (lib/dmFailedSend.ts). Same look as round chat's failed
                bubble. No data-reply-* / data-actions-* attributes: not a
                swipe-to-reply or unsend target. */}
            {threadFailedSends.map((f) => (
              <div key={f.key} className="flex items-end gap-2 flex-row-reverse">
                <span className="shrink-0 rounded-full">
                  <Avatar golfer={currentUser} size="xs" showVerified={false} />
                </span>
                <div className="flex max-w-[75%] flex-col items-end">
                  <div className="rounded-2xl rounded-br-sm border border-rose-300 bg-rose-50 px-3.5 py-2 text-sm text-slate-800 [overflow-wrap:anywhere]">
                    {f.text}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11px] font-semibold">
                    {f.objectionable ? (
                      <span className="flex items-center gap-1 text-rose-600">
                        <AlertCircle size={12} aria-hidden="true" /> {t("moderation.objectionableContent")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        // Don't take focus off the composer (keyboard stays put).
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => retryFailedSend(f)}
                        aria-label={t("roundChat.retryLabel")}
                        className="flex items-center gap-1 rounded text-rose-600 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                      >
                        <AlertCircle size={12} aria-hidden="true" /> {t("roundChat.notSentRetry")}
                      </button>
                    )}
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => discardFailedSend(f.key)}
                      className="rounded text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                    >
                      {t("roundChat.discard")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          {/* Just another item at the end of the same list the messages
              themselves render in -- no separate positioning, no new scroll
              code. The existing ResizeObserver on this list (see above)
              already re-pins to bottom on any size change, including this
              bubble appearing/disappearing, but only when nearBottomRef was
              already true -- someone reading older messages never gets
              snapped down just because the other person started typing. */}
            {otherTyping && (
              <div className="flex items-end gap-2">
                <button type="button" aria-label="View Profile" onClick={() => navigate(`/golfer/${other.id}`)} className="shrink-0 rounded-full">
                  <Avatar golfer={other} size="xs" showVerified={false} />
                </button>
                <TypingBubble />
              </div>
            )}
          </div>
        </div>

        {unseenCount > 0 && <NewMessagesPill onClick={showLatest} />}
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
            <>
              {/* Rendered inside this same composer container, so the
                  list's existing ResizeObserver sees it exactly like the
                  composer growing a line (re-pins only if near bottom). */}
              {replyTarget && (
                <div className="flex items-center gap-2 border-t border-slate-100 py-2 pr-2 pl-3">
                  <Reply size={14} className="shrink-0 text-fairway-600" aria-hidden="true" />
                  <div className="min-w-0 flex-1 border-l-2 border-fairway-500 pl-2 text-xs leading-snug">
                    <p className="truncate font-semibold text-slate-700">
                      {replyTarget.senderId === currentUser.id ? t("chat.replyingToSelf") : t("chat.replyingTo", { name: other.name })}
                    </p>
                    <p className="truncate text-slate-500">{replyTarget.unsentAt ? t("chat.messageUnsent") : replyTarget.text}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={t("chat.cancelReply")}
                    // Same as the send button: don't take focus off the
                    // textarea, so cancelling never closes the keyboard.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setReplyToId(null)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              <ChatComposer value={text} onChange={handleComposerChange} onSend={handleSend} onBlur={stopTyping} />
            </>
          )}
        </div>
      </div>

      {actionsMessage && actionsShown.value && (
        <MessageActionsMenu
          key={actionsShown.key}
          bubble={actionsShown.value.bubble}
          closing={actionsShown.exiting}
          alignRight={actionsMessage.senderId === currentUser.id}
          reactions={
            reactEnabled && canReactToMessage(actionsMessage)
              ? {
                  emojis: QUICK_REACTIONS,
                  mine: myReaction(messageReactions, actionsMessage.id, currentUser.id),
                  onPick: (emoji) => handleReact(actionsMessage.id, nextReaction(myReaction(messageReactions, actionsMessage.id, currentUser.id), emoji)),
                }
              : null
          }
          actions={messageActions({ canReply: replyEnabled, canUnsend: unsendableIds.has(actionsMessage.id) })}
          labels={{
            menu: t("chat.messageActions"),
            reply: t("chat.reply"),
            unsend: t("chat.unsend"),
            copy: t("chat.copy"),
            reactWith: (emoji) => t("chat.reactWith", { emoji }),
          }}
          onReply={() => {
            setActionsFor(null);
            startReply(actionsMessage.id);
          }}
          onUnsend={() => handleUnsend(actionsMessage.id)}
          onCopy={() => handleCopy(actionsMessage.id)}
          onClose={closeActions}
        />
      )}
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
          onConfirm={async () => {
            try {
              await Promise.resolve(blockUser(other.id));
            } catch {
              showToast(`Couldn't block ${other.name}. Check your connection and try again.`, "warning");
              return;
            }
            setBlockConfirmOpen(false);
            showToast(`Blocked ${other.name}.`, "info");
          }}
          onCancel={() => setBlockConfirmOpen(false)}
        />
      )}
    </div>
  );
}

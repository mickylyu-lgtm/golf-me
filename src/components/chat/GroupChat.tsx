import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Lock, Reply } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { ChatComposer } from "./ChatComposer";
import { groupChatDraftKey, loadChatDraft, saveChatDraft } from "../../lib/chatDraft";
import { useLocale } from "../../i18n/LocaleContext";
import { useKeyboardHeight } from "../../lib/useKeyboardHeight";
import { useComposerFocus } from "../../lib/useComposerFocus";
import { focusMovedToOtherField } from "../../lib/composerFocus";
import { followNewMessages, isNearBottom, messagesAfter, pinToBottom } from "../../lib/chatScroll";
import { lockPageScroll } from "../../lib/scrollLock";
import { useChatViewportBox } from "../../lib/useChatViewportBox";
import { NewMessagesPill } from "./NewMessagesPill";
import { MessageActionsMenu } from "./MessageActionsMenu";
import { ReactionPill } from "./ReactionPill";
import { MessageQuote, ReplyBar, RevealedTime } from "./ChatBubbleParts";
import { useMessageLongPress } from "../../lib/useMessageLongPress";
import { useSwipeToReply } from "../../lib/useSwipeToReply";
import { useSwipeToRevealTimes } from "../../lib/useSwipeToRevealTimes";
import { useExitPresence } from "../../lib/useExitPresence";
import { FOCUS_EXIT_MS } from "../../lib/messageFocus";
import { messageActions } from "../../lib/messageLongPress";
import { canUnsendMessage, unsendRemainingMs } from "../../lib/unsend";
import { QUICK_REACTIONS, groupReactionsByMessage, myReaction, nextReaction, summarizeReactions, type QuickReaction } from "../../lib/reactions";
import { canRetryRoundMessage, editRejectedOutcome, isActionableRoundMessage } from "../../lib/roundChat";
import { formatMessageTime } from "../../lib/messageTime";
import { copyText } from "../../lib/share";
import type { ChatMessage, PostMediaItem } from "../../types";
import { ChatPhotoBody } from "./ChatImage";
import { ChatVideoTrimSheet, MediaAttachmentStrip } from "./MediaAttachmentStrip";
import { ChatMediaBody } from "./ChatMedia";
import { ChatAvatarButton } from "./ChatAvatarButton";
import { useChatMediaAttachment } from "../../lib/useChatMediaAttachment";
import { chatMediaViewerItems, useChatMediaText } from "../../lib/useChatMediaText";
import { MEDIA_MAX_ITEMS } from "../../lib/chatMedia";
import { FullscreenMediaViewer } from "../community/FullscreenMediaViewer";
import { messagePreviewText } from "../../lib/chatImages";
import { canCopyImages, copyChatImage } from "../../lib/chatImageClient";
import { VoiceMessage } from "./VoiceMessage";
import { useVoiceComposerProps } from "../../lib/useVoiceComposerProps";
import { voiceSendPlan, type SentVoiceClip } from "../../lib/voiceSession";

// layout "card" (default): the inline card on the round page, list capped
// at max-h-96, composer docked over the keyboard while typing (below).
// "page": the full-screen /messages/round/:id thread, laid out like the DM
// thread (lib/useChatViewportBox.ts): the card fills the space between the
// thread header and the keyboard / bottom nav, only the list scrolls, and
// the page itself never moves, so the header and its Back button stay put.
// Callers only render this for members (lib/roundChat.ts canReadRoundChat).
//
// Message interactions are the DM thread's, through the same shared pieces
// (Micky 2026-11-05: round chat had none of them): hold / right-click a
// bubble for the focus menu (MessageActionsMenu: quick reactions, Reply,
// Copy, Unsend on my own message within 5 minutes), reaction pills (tap
// mine to remove), swipe right to reply with a quote that jumps to the
// original, swipe the thread left for send times, "unsent" placeholders.
// Each is offered only where the server allows it (DataContext
// canReplyToRoundMessages / canUnsendRoundMessages / canReactToRoundMessages:
// feature-detected for real accounts, migration 20261107130000), and
// replies / reactions only while the round is open (read-only after).
// None of it touches the keyboard / docking / viewport code above the
// render, the list's scroll (only jump-to-quote sets the list's own
// scrollTop), or ChatComposer.

export function GroupChat({ callId, layout = "card" }: { callId: string; layout?: "card" | "page" }) {
  const {
    currentUser,
    getGolfer,
    getGolfCall,
    messagesForCall,
    watchRoundMessages,
    sendMessage,
    retryRoundMessage,
    discardRoundMessage,
    canReplyToRoundMessages,
    canUnsendRoundMessages,
    unsendRoundMessage,
    canReactToRoundMessages,
    roundMessageReactions,
    setRoundMessageReaction,
    canSendRoundImages,
    sendRoundImage,
    canSendRoundVoice,
    sendRoundVoice,
    canSendRoundMedia,
    sendRoundMedia,
  } = useData();
  const { showToast } = useToast();
  const { t, locale } = useLocale();
  // Photos (lib/chatImages.ts): the composer's one picked photo (dropped
  // when the round changes or the chat turns read-only) and the fullscreen
  // viewer. The chip renders inside the composer wrapper, so docking /
  // spacer / list ResizeObservers treat it like the reply bar.
  // Since 20261107220000 several photos / videos (lib/chatMedia.ts); before
  // it (feature-detected) exactly one photo, as before. Scoped to this
  // round's visit: a picker that answers after a switch is dropped.
  const mediaText = useChatMediaText();
  const photo = useChatMediaAttachment({
    limit: canSendRoundMedia ? MEDIA_MAX_ITEMS : 1,
    allowVideos: canSendRoundMedia,
    onError: (reason) => showToast(mediaText.pickError(reason), "warning"),
    scope: callId,
  });
  const [mediaViewer, setMediaViewer] = useState<{ items: PostMediaItem[]; index: number } | null>(null);
  const openMediaViewer = (m: ChatMessage, index: number) => {
    if (!m.media) return;
    void chatMediaViewerItems(m.media, index, m.outgoingPhoto?.items).then((v) => {
      if (v.items.length) setMediaViewer(v);
    });
  };
  // Voice (lib/chatVoice.ts): hold-to-talk sends through voiceClipRef (set
  // below, where the reply target is known). Only while the chat is open.
  // Each clip carries the round it was recorded in (clip.origin); that is
  // where it goes, even if this component has since been reused for another
  // round.
  const voiceClipRef = useRef<(clip: SentVoiceClip) => void>(() => {});
  const roundStatus = getGolfCall(callId)?.status;
  const voiceProps = useVoiceComposerProps(
    canSendRoundVoice && roundStatus !== "completed" && roundStatus !== "cancelled",
    { kind: "round", id: callId },
    (clip) => voiceClipRef.current(clip),
  );
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [text, setText] = useState(() => loadChatDraft(groupChatDraftKey(callId)));
  // The composer's text as of the last render, for a send that settles later.
  const textRef = useRef(text);
  textRef.current = text;
  const listRef = useRef<HTMLDivElement>(null);
  const messages = messagesForCall(callId);
  // While open, this round's own newest page is held too (lib/
  // roundMessagePages.ts), so it can't fall outside the shared window.
  useEffect(() => watchRoundMessages(callId), [callId, watchRoundMessages]);
  // Completed / cancelled: history stays, the composer is replaced by a
  // read-only note (the round_messages insert policy refuses posts too).
  const status = getGolfCall(callId)?.status;
  const readOnly = status === "completed" || status === "cancelled";
  const readOnlyNote = status === "cancelled" ? t("roundChat.cancelledReadOnly") : t("roundChat.endedReadOnly");

  // iOS keyboard (capacitor.config.ts Keyboard resize:"body"): that mode
  // only shrinks document.body's inline height -- the WebView, 100dvh and
  // position:fixed stay full-screen, so the keyboard simply covers this
  // composer (it sits mid/low on the round page) and iOS drags the whole
  // screen up to reveal it. While the keyboard is open the composer is
  // docked instead, same pattern as PostDetail's comment box: GroupChat's
  // own wrapper (the shared ChatComposer itself is untouched, and never
  // remounted -- focus and the keyboard stay) becomes a fixed bar sitting
  // exactly on top of the keyboard, a measured in-flow spacer holds its
  // place so the page doesn't shift, and the page behind is scroll-locked.
  // keyboardHeight comes from the plugin's own events and is always 0 on
  // web, where nothing here changes.
  const keyboardHeight = useKeyboardHeight();
  const composerRef = useRef<HTMLDivElement>(null);
  // Docked only while the keyboard is this composer's (useComposerFocus):
  // a sheet's textarea on the round page opening it leaves the chat and
  // the page alone. Never docked while read-only: there's no composer.
  const composerOwnsFocus = useComposerFocus(composerRef, rememberScrollBeforeKeyboard);
  // The full-screen page never docks: its box already ends at the keyboard.
  const composerDocked = layout === "card" && !readOnly && composerOwnsFocus && keyboardHeight > 0;
  const [composerHeight, setComposerHeight] = useState(0);

  // Measured on docking, before paint, so the spacer is never a frame late.
  useLayoutEffect(() => {
    if (composerDocked && composerRef.current) setComposerHeight(composerRef.current.offsetHeight);
  }, [composerDocked]);

  // While docked, a longer message grows the bar UPWARD (it's pinned to the
  // keyboard top), over the newest messages. Grow the spacer by the same
  // amount and scroll the page with it, so what was right above the bar
  // stays right above it; deleting lines does the reverse. Done in the
  // ResizeObserver callback itself (before paint), straight on the spacer's
  // style, so there's no frame with the bar covering a message; the state
  // update just keeps the next render in agreement.
  const spacerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!composerDocked || !el) return;
    let last = el.offsetHeight;
    const ro = new ResizeObserver(() => {
      const height = el.offsetHeight;
      if (height === last) return;
      const delta = height - last;
      last = height;
      if (spacerRef.current) spacerRef.current.style.height = `${height + keyboardHeight}px`;
      setComposerHeight(height);
      window.scrollBy(0, delta);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [composerDocked, keyboardHeight]);

  // Page scroll position captured when the composer gets focus, before the
  // keyboard starts opening. iOS may pan the page to reveal the textbox in
  // the moment before the composer docks; if it did, the page is put back
  // to exactly where it was once docked, and again when the keyboard
  // closes. Local to this component only -- not the removed app-wide
  // scrollTo(0,0) hack.
  const scrollYBeforeKeyboardRef = useRef<number | null>(null);
  // Where the composer sat in the page (document coordinates), so docking
  // can bring the content just above it -- the latest messages/comments --
  // right above the docked bar instead of leaving the view wherever it was.
  const composerPageTopRef = useRef<number | null>(null);
  function rememberScrollBeforeKeyboard() {
    if (composerDocked) return;
    scrollYBeforeKeyboardRef.current = window.scrollY;
    const rect = composerRef.current?.getBoundingClientRect();
    composerPageTopRef.current = rect ? rect.top + window.scrollY : null;
  }

  // Layout effect, not a passive one: the scroll lock and the restore to the
  // saved position must land before the docked layout paints, or the
  // iOS-panned page could flash for a frame before snapping back.
  useLayoutEffect(() => {
    if (!composerDocked) return;
    const releaseScroll = lockPageScroll();
    const composerEl = composerRef.current;
    // Line the composer's old spot up with the top of the docked bar, so
    // what was right above it stays visible right above the keyboard. The
    // page is put back where it was when the keyboard closes.
    const list = listRef.current;
    if (list) pinToBottom(list);
    const composerTop = composerPageTopRef.current;
    const dockedHeight = composerRef.current?.offsetHeight ?? 0;
    if (composerTop !== null) {
      window.scrollTo(0, Math.max(0, composerTop - (window.innerHeight - keyboardHeight - dockedHeight)));
    } else {
      const saved = scrollYBeforeKeyboardRef.current;
      if (saved !== null && Math.abs(window.scrollY - saved) > 1) window.scrollTo(0, saved);
    }
    return () => {
      releaseScroll();
      const restoreTo = scrollYBeforeKeyboardRef.current;
      scrollYBeforeKeyboardRef.current = null;
      composerPageTopRef.current = null;
      // Not when another field took the keyboard (it's revealed on its own).
      const active = document.activeElement as HTMLElement | null;
      if (focusMovedToOtherField(active, !!active && !!composerEl?.contains(active))) return;
      if (restoreTo !== null) requestAnimationFrame(() => window.scrollTo(0, restoreTo));
    };
    // keyboardHeight is final when the composer docks (keyboardWillShow);
    // re-running on later height changes would re-scroll mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerDocked]);

  // New messages follow the DM thread's rule (lib/chatScroll.ts): pin the
  // list to the bottom only if the reader was already near it, or for the
  // message they just sent. Only the list's own scrollTop moves, docked or
  // not -- the old scrollIntoView also scrolled the window, dragging the
  // round page to the chat card on load and on every incoming message.
  // Starts true so the first load opens at the newest message.
  const nearBottomRef = useRef(true);
  const [unseenCount, setUnseenCount] = useState(0);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      nearBottomRef.current = isNearBottom(el);
      if (nearBottomRef.current) setUnseenCount(0);
    };
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, []);

  // Full-screen thread: DM-thread layout (see the layout comment above).
  const boxRef = useRef<HTMLDivElement>(null);
  const pageBoxHeight = useChatViewportBox({ enabled: layout === "page", boxRef, listRef, nearBottomRef });

  // lib/chatScroll.ts followNewMessages: the golfer's own message always
  // pins (keyed on the bubble, so a retry or a slow send pins too); someone
  // else's only if the reader is near the bottom, otherwise it's counted
  // for the "New messages" pill. Layout effect: pinned in the bubble's frame.
  const lastSeenIdRef = useRef<string | null>(null);
  const lastMessageId = messages.length > 0 ? (messages[messages.length - 1].clientId ?? messages[messages.length - 1].id) : null;
  useLayoutEffect(() => {
    const el = listRef.current;
    const keyed = messages.map((m) => ({ ...m, id: m.clientId ?? m.id }));
    const added = messagesAfter(keyed, lastSeenIdRef.current);
    lastSeenIdRef.current = lastMessageId;
    const { pin, unseen } = followNewMessages({ added, selfId: currentUser.id, nearBottom: nearBottomRef.current });
    if (el && (pin || nearBottomRef.current)) {
      pinToBottom(el);
      nearBottomRef.current = true;
      setUnseenCount(0);
    } else if (unseen > 0) setUnseenCount((n) => n + unseen);
    // messages is read for its new tail only; these keys change with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, lastMessageId]);
  const showLatest = () => {
    const el = listRef.current;
    if (el) pinToBottom(el);
    nearBottomRef.current = true;
    setUnseenCount(0);
  };

  // ---- DM-parity interactions (see the header comment) ----
  // Rows sit in their own wrapper so the reveal-times drag moves them with
  // one transform; it never touches the list's scroll or size.
  const rowsRef = useRef<HTMLDivElement>(null);
  useSwipeToRevealTimes(listRef, rowsRef, true);

  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimerRef = useRef(0);
  // Replying and reacting are posts: only while the round is open (the
  // database refuses them after, migration 20261107130000).
  const replyEnabled = !readOnly && canReplyToRoundMessages;
  const reactEnabled = !readOnly && canReactToRoundMessages;
  // Swipe's pointerup / the menu's click are user gestures: focusing the
  // composer here is the same focus a tap on it makes, so the keyboard (and,
  // on the round page, the docking above) runs exactly as for a tap.
  const startReply = (messageId: string) => {
    setReplyToId(messageId);
    const textarea = composerRef.current?.querySelector("textarea");
    if (textarea && document.activeElement !== textarea) textarea.focus({ preventScroll: true });
  };
  useSwipeToReply(listRef, replyEnabled, startReply);

  const reactionsByMessage = useMemo(() => groupReactionsByMessage(roundMessageReactions), [roundMessageReactions]);
  const [actionsFor, setActionsFor] = useState<{ id: string; bubble: HTMLElement } | null>(null);
  // Unsend is offered for my own stored message inside the 5-minute window
  // (lib/unsend.ts); nowMs ticks at the next expiry so a lapsed one stops
  // offering it without a reload. The server decides for real.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const unsendableIds = new Set(
    canUnsendRoundMessages ? messages.filter((m) => isActionableRoundMessage(m) && canUnsendMessage(m, currentUser.id, nowMs)).map((m) => m.id) : [],
  );
  const nextUnsendExpiry = canUnsendRoundMessages
    ? Math.min(...messages.filter((m) => unsendableIds.has(m.id)).map((m) => unsendRemainingMs(m.createdAt, nowMs)))
    : Infinity;
  useEffect(() => {
    if (!Number.isFinite(nextUnsendExpiry)) return;
    const timer = window.setTimeout(() => setNowMs(Date.now()), nextUnsendExpiry + 50);
    return () => window.clearTimeout(timer);
  }, [nextUnsendExpiry]);
  // Hold (touch) / right-click (mouse) any bubble that has one (not a system
  // line, not unsent, not a failed send) -> the focus menu.
  useMessageLongPress(listRef, true, (messageId, bubble) => {
    const m = messages.find((x) => x.id === messageId);
    if (!m || m.unsentAt || m.system || m.delivery === "failed") return;
    // A photo still uploading isn't a message yet (text in flight keeps its
    // existing Copy-only menu).
    if ((m.image || m.voice || m.media) && m.delivery) return;
    setNowMs(Date.now());
    setActionsFor({ id: messageId, bubble });
  });
  const closeActions = useCallback(() => setActionsFor(null), []);
  const actionsShown = useExitPresence(actionsFor, FOCUS_EXIT_MS);

  // A reply target / open menu belongs to one round; no timer outlives us.
  useEffect(() => setReplyToId(null), [callId]);
  useEffect(() => setActionsFor(null), [callId]);
  useEffect(() => () => window.clearTimeout(highlightTimerRef.current), []);
  // The round ended (or reply support went away) while a reply was picked.
  useEffect(() => {
    if (!replyEnabled) setReplyToId(null);
  }, [replyEnabled]);
  // A picked photo belongs to one round's open chat.
  const removePhoto = photo.clear;
  useEffect(() => removePhoto(), [callId, readOnly, removePhoto]);

  // Same golf call's chat can be revisited across navigations without this
  // component staying mounted the whole time — restore whatever was typed
  // but never sent, instead of always starting from a blank box.
  useEffect(() => {
    setText(loadChatDraft(groupChatDraftKey(callId)));
  }, [callId]);

  function updateText(value: string) {
    setText(value);
    saveChatDraft(groupChatDraftKey(callId), value);
  }

  const messagesById = new Map(messages.map((m) => [m.id, m]));
  const replyTarget = replyToId ? messagesById.get(replyToId) : undefined;

  // The round on screen now (this component is reused when the route's
  // round changes): a send that settles later checks it before saying
  // anything, and never writes into the composer at all.
  const callIdRef = useRef(callId);
  callIdRef.current = callId;
  const replyToIdRef = useRef(replyToId);
  replyToIdRef.current = replyToId;

  // Content filter: the message stays as a "Not sent: ..." bubble with
  // Edit / Discard (RealRoundsContext); the toast is only for the round it
  // was sent in, if that's still the one on screen.
  function noteRejected(roundId: string) {
    if (callIdRef.current === roundId) showToast(t("moderation.objectionableContent"), "warning");
  }

  async function handleSend() {
    const sending = text;
    if (readOnly) return;
    const roundId = callId;
    const replyTo = replyEnabled && replyTarget && isActionableRoundMessage(replyTarget) ? replyTarget.id : null;
    // With a photo: one message (photo + optional text + quote), shown at
    // once with upload progress; a failure stays as a "Not sent" bubble with
    // Retry / Discard (the composer is never refilled with it).
    if (photo.shape !== "none") {
      if (!photo.ready) return;
      const shape = photo.shape;
      const picked = photo.take();
      if (picked.length === 0) return;
      updateText("");
      setReplyToId(null);
      const first = picked[0];
      const result = shape === "photo" && first.kind === "image" ? await sendRoundImage(roundId, first.image, sending, replyTo) : await sendRoundMedia(roundId, picked, sending, replyTo);
      if (result === "objectionable") noteRejected(roundId);
      return;
    }
    if (!sending.trim()) return;
    // Clear right away: the message shows at once (real accounts: as
    // "sending", then a "Not sent" bubble if it fails, so the text is never
    // silently lost; demo: delivered instantly).
    updateText("");
    setReplyToId(null);
    // The golfer's own bubble pins itself into view (message effect above).
    const result = await sendMessage(roundId, sending, replyTo);
    if (result === "objectionable") noteRejected(roundId);
  }

  // Network / refused failures only: a content-filter rejection is never
  // resent as is (no Retry is shown for it; the context refuses it too).
  async function handleRetry(m: ChatMessage) {
    if (!canRetryRoundMessage(m)) return;
    const result = await retryRoundMessage(m);
    // A photo stays as its failed bubble (only its caption was refused); a
    // text message stays as a "Not sent: ..." bubble with Edit / Discard.
    if (result === "objectionable") noteRejected(m.golfCallId);
  }

  // Edit a rejected message: back into the composer only if it's this
  // round's and empty with no reply picked (lib/roundChat.ts
  // editRejectedOutcome, the DM rule); otherwise ask before replacing the
  // draft, or copy the text instead.
  const [replaceDraftFor, setReplaceDraftFor] = useState<string | null>(null);
  useEffect(() => setReplaceDraftFor(null), [callId]);
  function handleEditRejected(m: ChatMessage) {
    if (!m.clientId) return;
    const outcome = editRejectedOutcome({ roundId: callIdRef.current, text: textRef.current, replyToId: replyToIdRef.current }, { roundId: m.golfCallId });
    if (outcome === "otherRound") return;
    if (outcome === "confirmReplace") {
      setReplaceDraftFor(m.clientId);
      return;
    }
    putRejectedBack(m);
  }
  function putRejectedBack(m: ChatMessage) {
    if (!m.clientId || m.golfCallId !== callIdRef.current) return;
    setReplaceDraftFor(null);
    updateText(m.text);
    const quote = m.replyToId && replyEnabled && messagesById.has(m.replyToId) ? m.replyToId : null;
    setReplyToId(quote);
    discardRoundMessage(m.clientId);
    const textarea = composerRef.current?.querySelector("textarea");
    if (textarea && document.activeElement !== textarea) textarea.focus({ preventScroll: true });
  }
  async function copyRejected(m: ChatMessage) {
    setReplaceDraftFor(null);
    if (await copyText(m.text)) showToast(t("chat.copied"), "info");
  }
  function discardFailed(clientId: string) {
    if (replaceDraftFor === clientId) setReplaceDraftFor(null);
    discardRoundMessage(clientId);
  }

  // One line for a quote / the reply bar: its text, "[Photo]" or "[Voice message]".
  const previewOf = (m: ChatMessage) => messagePreviewText(m, t("chat.photo"), t("chat.voice"), mediaText.label);

  // A voice message (with the picked quote), like handleSend's photo path.
  // The round is the clip's origin (lib/voiceSession.ts voiceSendPlan); the
  // quote and the reply bar are this page's only when it still shows that
  // round.
  voiceClipRef.current = (clip: SentVoiceClip) => {
    const plan = voiceSendPlan(clip, "round", {
      id: callId,
      replyToId: replyEnabled && replyTarget && isActionableRoundMessage(replyTarget) ? replyTarget.id : null,
    });
    if (!plan) return;
    const originStatus = getGolfCall(plan.to)?.status;
    if (originStatus === "completed" || originStatus === "cancelled") return;
    if (plan.here) setReplyToId(null);
    void sendRoundVoice(clip, plan.replyToId);
  };
  const voiceLabels = { play: t("chat.voicePlay"), pause: t("chat.voicePause"), unavailable: t("chat.voiceUnavailable"), unsupported: t("chat.voiceUnsupported") };

  function senderName(senderId: string) {
    return senderId === currentUser.id ? t("chat.you") : (getGolfer(senderId)?.name ?? t("roundChat.someone"));
  }

  // Tap a quote: scroll the list (only its own scrollTop, like a user
  // scroll) to the original and flash it. Same as the DM thread.
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
    const result = await unsendRoundMessage(messageId);
    if (result === "expired") {
      setNowMs(Date.now());
      showToast(t("chat.unsendExpired"), "info");
    } else if (result === "failed") showToast(t("chat.unsendFailed"), "warning");
  }

  // Tap an emoji in the row: set / replace; the same one again removes it.
  // Tap my reaction pill: remove. Optimistic (the context rolls back).
  async function handleReact(messageId: string, emoji: QuickReaction | null) {
    setActionsFor(null);
    if (!(await setRoundMessageReaction(messageId, emoji))) showToast(t("chat.reactionFailed"), "warning");
  }

  async function handleCopy(messageId: string) {
    setActionsFor(null);
    const m = messagesById.get(messageId);
    if (!m) return;
    // A photo: the image (with its caption) where the platform can put
    // images on the clipboard; started inside the tap (WebKit's rule).
    if (m.image && canCopyImages()) {
      if (await copyChatImage(m.image.path, m.outgoingPhoto?.localUrl, m.text)) showToast(t("chat.copied"), "info");
      return;
    }
    if (m.text.trim() && (await copyText(m.text))) showToast(t("chat.copied"), "info");
  }

  // The menu's message; gone (unsent here or on another phone) = no menu.
  const actionsCandidate = actionsShown.value ? messagesById.get(actionsShown.value.id) : undefined;
  const actionsMessage = actionsCandidate && !actionsCandidate.unsentAt && !actionsCandidate.system ? actionsCandidate : undefined;

  // A failed message once the round is over: retry can't help, so say why
  // (discard is still offered, and the text stays visible to copy).
  const failedAfterEndLabel = status === "cancelled" ? t("roundChat.notSentCancelled") : t("roundChat.notSentEnded");

  return (
    // Opted out of useDismissKeyboardOnDrag: while the composer is docked
    // the message list is the one thing that still scrolls, so dragging it
    // to read back keeps the keyboard (and the docked composer) up.
    // Also opted out of useRevealFocusedFieldAboveKeyboard: the composer
    // docks itself above the keyboard.
    <div
      ref={boxRef}
      data-keyboard-drag-dismiss="off"
      data-keyboard-reveal="off"
      className="flex flex-col rounded-2xl border border-slate-100 bg-white"
      style={layout === "page" ? { height: pageBoxHeight } : undefined}
    >
      {/* A leading mt-auto spacer bottom-anchors a short thread against the
          composer (DirectMessageThread's fix). Not justify-end on the
          scroller: that makes the browser report scrollHeight equal to
          clientHeight once the list overflows, so older messages couldn't
          be scrolled to and every scrollTop pin was a no-op (measured
          headless: 17 messages, scrollHeight 384 = clientHeight). */}
      {/* overflow-x-hidden + touch-pan-y + data-no-swipe: the swipe-to-
          reveal-times gesture (the rows slide left, each row's time sits
          just past this list's right clip edge), as in the DM thread.
          Vertical scrolling stays native. */}
      <div
        ref={listRef}
        data-no-swipe
        // Page: the list takes whatever the box leaves above the composer.
        className={`flex touch-pan-y flex-col gap-3 overflow-x-hidden overflow-y-auto px-4 py-4 ${layout === "page" ? "min-h-0 flex-1" : "max-h-96"}`}
      >
        <div className="mt-auto" />
        {messages.length === 0 && <p className="text-center text-sm text-slate-400">{t("chat.noMessagesYet")}</p>}
        <div ref={rowsRef} className="flex flex-col gap-3">
        {messages.map((m) => {
          if (m.system) {
            return (
              <p key={m.id} className="text-center text-xs text-slate-400">
                {m.text}
              </p>
            );
          }
          const sender = getGolfer(m.senderId);
          const isMe = m.senderId === currentUser.id;
          const failed = m.delivery === "failed";
          const sent = formatMessageTime(m.createdAt, locale, t);
          const avatar = sender && (
            // Tap: that golfer's profile; a long press magnifies the photo
            // (Avatar swallows the click after it). Same as the DM thread.
            <ChatAvatarButton golfer={sender} isMe={isMe} replyAvatar />
          );
          // Unsent: a quiet placeholder where the message was (its text is
          // already gone). Not a hold / reply target; quotes of it say
          // "Message unsent".
          if (m.unsentAt) {
            return (
              <div key={m.clientId ?? m.id} data-reply-row={m.id} className={`relative flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                {avatar}
                <p className="max-w-[75%] rounded-2xl border border-dashed border-slate-200 px-3.5 py-2 text-xs text-slate-400 italic">
                  {isMe ? t("chat.youUnsent") : t("chat.theyUnsent", { name: senderName(m.senderId) })}
                </p>
                <RevealedTime dateTime={m.createdAt} label={sent} />
              </div>
            );
          }
          const actionable = isActionableRoundMessage(m);
          const reactionRows = canReactToRoundMessages && actionable ? reactionsByMessage.get(m.id) : undefined;
          const reactionSummary = reactionRows ? summarizeReactions(reactionRows, m.id, currentUser.id) : [];
          const mineReacted = reactionSummary.some((s) => s.mine);
          const quoted = m.replyToId ? messagesById.get(m.replyToId) : undefined;
          return (
            // data-reply-row/-arrow/-avatar/-bubble: useSwipeToReply's DOM
            // contract (only the bubble moves); data-actions-bubble:
            // useMessageLongPress's.
            <div key={m.clientId ?? m.id} data-reply-row={m.id} className={`relative flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
              <span
                data-reply-arrow
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-0 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-slate-100 text-slate-500 opacity-0"
              >
                <Reply size={14} />
              </span>
              {avatar}
              <div className={`flex max-w-[75%] flex-col ${isMe ? "items-end" : "items-start"}`}>
                {!isMe && <span className="mb-0.5 text-[11px] font-medium text-slate-400">{sender?.name}</span>}
                <div
                  data-reply-bubble={replyEnabled && actionable ? m.id : undefined}
                  // Hold / right-click -> the focus menu. On touch screens no
                  // iOS selection callout (Copy is in the menu); a mouse still
                  // selects. data-pressing (useMessageLongPress) eases it
                  // down while a hold builds.
                  data-actions-bubble={failed ? undefined : m.id}
                  className={`relative rounded-2xl ${m.image || m.voice || m.media ? "p-1" : "px-3.5 py-2"} text-sm transition-[box-shadow,scale,opacity] duration-300 ease-out data-pressing:scale-[0.97] data-pressing:duration-[350ms] [overflow-wrap:anywhere] pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none] ${
                    failed
                      ? "rounded-br-sm border border-rose-300 bg-rose-50 text-slate-800"
                      : isMe
                        ? "rounded-br-sm bg-fairway-600 text-white"
                        : "rounded-bl-sm bg-slate-100 text-slate-800"
                  } ${m.delivery === "sending" ? "opacity-60" : ""} ${highlightId === m.id ? "ring-2 ring-amber-300 ring-offset-2" : ""} ${
                    reactionSummary.length > 0 ? "mb-4" : ""
                  }`}
                >
                  {/* Quote of the replied-to message, only from messages this
                      member already has loaded (RLS-visible); else
                      "unavailable". */}
                  {m.replyToId && (
                    <MessageQuote
                      isMe={isMe && !failed}
                      quoted={quoted ? { id: quoted.id, sender: senderName(quoted.senderId), text: previewOf(quoted), unsent: Boolean(quoted.unsentAt) } : null}
                      onJump={jumpToMessage}
                      labels={{ showOriginal: t("chat.showOriginal"), unavailable: t("chat.originalUnavailable"), unsent: t("chat.messageUnsent") }}
                    />
                  )}
                  {m.voice ? (
                    <VoiceMessage
                      voice={m.voice}
                      localUrl={m.outgoingPhoto?.localUrl}
                      isMe={isMe && !failed}
                      progress={m.delivery === "sending" ? (m.outgoingPhoto?.progress ?? 0) : undefined}
                      labels={voiceLabels}
                    />
                  ) : m.media ? (
                    <ChatMediaBody
                      media={m.media}
                      locals={m.outgoingPhoto?.items}
                      labels={mediaText.labels}
                      progress={m.delivery === "sending" ? (m.outgoingPhoto?.progress ?? 0) : undefined}
                      caption={m.text}
                      onOpen={m.delivery ? undefined : (index) => openMediaViewer(m, index)}
                    />
                  ) : m.image ? (
                    <ChatPhotoBody
                      image={m.image}
                      localUrl={m.outgoingPhoto?.localUrl}
                      alt={t("chat.photoAlt")}
                      openLabel={m.delivery ? t("chat.photoSending") : t("chat.openPhoto")}
                      unavailableLabel={t("chat.photoUnavailable")}
                      progress={m.delivery === "sending" ? (m.outgoingPhoto?.progress ?? 0) : undefined}
                      caption={m.text}
                      onOpen={m.delivery ? undefined : setViewerUrl}
                    />
                  ) : (
                    m.text
                  )}
                  {m.delivery === "sending" && <span className="sr-only"> ({t("roundChat.sending")})</span>}
                  <ReactionPill
                    summary={reactionSummary}
                    alignRight={isMe}
                    label={t("chat.reactionsLabel", { list: reactionSummary.map((s) => (s.count > 1 ? `${s.emoji} ${s.count}` : s.emoji)).join(" ") })}
                    removeLabel={t("chat.removeReaction")}
                    onRemoveMine={mineReacted && reactEnabled ? () => handleReact(m.id, null) : null}
                  />
                </div>
                {failed && m.clientId && m.failure === "objectionable" && (
                  <div className="mt-1 flex flex-col items-end gap-1 text-[11px] font-semibold" data-rejected-message={m.clientId}>
                    <span role="status" className="flex items-start gap-1 text-right text-rose-600">
                      <AlertCircle size={12} aria-hidden="true" className="mt-px shrink-0" /> {t("roundChat.notSentFiltered")}
                    </span>
                    {replaceDraftFor === m.clientId && !readOnly ? (
                      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1" role="group" aria-label={t("roundChat.replaceDraftPrompt")}>
                        <span className="text-slate-500">{t("roundChat.replaceDraftPrompt")}</span>
                        <button
                          type="button"
                          onClick={() => putRejectedBack(m)}
                          className="rounded text-rose-600 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                        >
                          {t("roundChat.replaceDraft")}
                        </button>
                        <button
                          type="button"
                          onClick={() => copyRejected(m)}
                          className="rounded text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                        >
                          {t("chat.copy")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setReplaceDraftFor(null)}
                          className="rounded text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                        >
                          {t("roundChat.keepDraft")}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        {readOnly ? (
                          <button
                            type="button"
                            onClick={() => copyRejected(m)}
                            className="rounded text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                          >
                            {t("chat.copy")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleEditRejected(m)}
                            aria-label={t("roundChat.editLabel")}
                            className="rounded text-rose-600 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                          >
                            {t("roundChat.edit")}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => discardFailed(m.clientId!)}
                          className="rounded text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                        >
                          {t("roundChat.discard")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {failed && m.clientId && m.failure !== "objectionable" && (
                  <div className="mt-1 flex items-center gap-3 text-[11px] font-semibold">
                    {readOnly ? (
                      <span className="flex items-center gap-1 text-rose-600">
                        <AlertCircle size={12} aria-hidden="true" /> {failedAfterEndLabel}
                      </span>
                    ) : m.outgoingPhoto?.failure === "objectionable" || m.outgoingPhoto?.failure === "rejected" ? (
                      // A photo retry can't help: its caption was refused, or
                      // the database refused the photo here.
                      <span className="flex items-center gap-1 text-rose-600">
                        <AlertCircle size={12} aria-hidden="true" />{" "}
                        {m.outgoingPhoto.failure === "objectionable" ? t("moderation.objectionableContent") : m.voice ? t("chat.voiceNotSent") : m.media ? mediaText.rejected : t("chat.photoRejected")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRetry(m)}
                        aria-label={t("roundChat.retryLabel")}
                        className="flex items-center gap-1 rounded text-rose-600 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                      >
                        <AlertCircle size={12} aria-hidden="true" /> {t("roundChat.notSentRetry")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => discardFailed(m.clientId!)}
                      className="rounded text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                    >
                      {t("roundChat.discard")}
                    </button>
                  </div>
                )}
              </div>
              {!m.delivery && <RevealedTime dateTime={m.createdAt} label={sent} />}
            </div>
          );
        })}
        </div>
      </div>
      {/* Holds the composer's place, plus the keyboard's height: near the
          bottom of the page there's otherwise no room to scroll the latest
          content up above the docked bar (it's hidden under the keyboard). */}
      {unseenCount > 0 && <NewMessagesPill onClick={showLatest} />}
      {composerDocked && <div ref={spacerRef} aria-hidden="true" style={{ height: composerHeight + keyboardHeight }} />}
      {readOnly ? (
        <p role="status" className="flex items-center justify-center gap-1.5 border-t border-slate-100 px-4 py-3 text-center text-xs font-medium text-slate-500">
          <Lock size={13} aria-hidden="true" className="shrink-0" /> {readOnlyNote}
        </p>
      ) : (
      <div
        ref={composerRef}
        className={
          composerDocked
            ? "fixed inset-x-0 z-40 bg-page pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
            : undefined
        }
        style={composerDocked ? { bottom: `${keyboardHeight}px` } : undefined}
      >
        {/* Inside the composer's own wrapper: docked, it rides on the
            keyboard with the composer (the docked bar's ResizeObserver
            above grows the spacer); on the page, the list's
            ResizeObserver re-pins like a composer growing a line. */}
        {replyTarget && replyEnabled && (
          <ReplyBar
            title={replyTarget.senderId === currentUser.id ? t("chat.replyingToSelf") : t("chat.replyingTo", { name: senderName(replyTarget.senderId) })}
            text={replyTarget.unsentAt ? t("chat.messageUnsent") : previewOf(replyTarget)}
            cancelLabel={t("chat.cancelReply")}
            onCancel={() => setReplyToId(null)}
          />
        )}
        <MediaAttachmentStrip items={photo.state} onRemove={photo.remove} labels={mediaText.strip} />
        <ChatComposer
          value={text}
          onChange={updateText}
          onSend={handleSend}
          placeholder={t("chat.messagePlaceholder")}
          onPickFiles={canSendRoundImages ? photo.pick : undefined}
          mediaAccept={canSendRoundMedia ? "image/*,video/*" : "image/*"}
          mediaMultiple={canSendRoundMedia}
          onMediaTooLarge={() => showToast(mediaText.pickError("videoTooLarge"), "warning")}
          photoLabel={canSendRoundMedia ? mediaText.addLabel : t("chat.addPhoto")}
          photoKey={photo.sendKey}
          photoBusy={photo.busy}
          voice={voiceProps}
        />
      </div>
      )}
      {viewerUrl && <FullscreenMediaViewer media={[{ id: "chat-photo", type: "image", url: viewerUrl }]} onClose={() => setViewerUrl(null)} />}
      {mediaViewer && <FullscreenMediaViewer media={mediaViewer.items} initialIndex={mediaViewer.index} onClose={() => setMediaViewer(null)} />}
      {photo.trimming && (
        <ChatVideoTrimSheet
          item={photo.trimming}
          labels={mediaText.trim}
          onConfirm={(start, end) => photo.trimming && photo.confirmTrim(photo.trimming.key, start, end)}
          onCancel={() => photo.trimming && photo.remove(photo.trimming.key)}
        />
      )}
      {actionsMessage && actionsShown.value && (
        <MessageActionsMenu
          key={actionsShown.key}
          bubble={actionsShown.value.bubble}
          closing={actionsShown.exiting}
          alignRight={actionsMessage.senderId === currentUser.id}
          reactions={
            reactEnabled && isActionableRoundMessage(actionsMessage)
              ? {
                  emojis: QUICK_REACTIONS,
                  mine: myReaction(roundMessageReactions, actionsMessage.id, currentUser.id),
                  onPick: (emoji) => handleReact(actionsMessage.id, nextReaction(myReaction(roundMessageReactions, actionsMessage.id, currentUser.id), emoji)),
                }
              : null
          }
          actions={messageActions({
            canReply: replyEnabled && isActionableRoundMessage(actionsMessage),
            canUnsend: unsendableIds.has(actionsMessage.id),
            // A photo with no text where images can't go on the clipboard: no Copy.
            canCopy: !actionsMessage.media && !(actionsMessage.voice && !actionsMessage.text.trim()) && !(actionsMessage.image && !actionsMessage.text.trim() && !canCopyImages()),
          })}
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
    </div>
  );
}

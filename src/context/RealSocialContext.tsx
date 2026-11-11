import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { fetchFollowerCount, fetchProfileFollowers } from "../lib/profileFollowersFetch";
import type { ProfileFollowers } from "../lib/profileFollowers";
import { isHistoryCut } from "../lib/roundMessagePages";
import { useAuth } from "./AuthContext";
import { fetchGolferDirectory, fetchMyBlockedProfiles, fetchPublicProfiles } from "../lib/publicProfilesFetch";
import { discoverableCandidates } from "../lib/discoverability";
import { blockedContactRows } from "../lib/blockedContacts";
import type { BlockedContact } from "../lib/blockedContacts";
import { INITIAL_LOAD_STATUS, applyLoadOutcome, isFirstLoadError, isRefreshError } from "../lib/loadStatus";
import { isObjectionableContentError } from "../lib/objectionableContent";
import type { SendMessageResult } from "../lib/objectionableContent";
import type { GolferProfile, AppNotification, DirectMessage, NotificationType, ReportCategory, Report } from "../types";
import type { DmConversation } from "./DataContext";
import { isMissingColumnError, reportRow } from "../lib/reportRow";
import type { ReportTarget } from "../lib/reportRow";
import { reconcilePendingDms } from "../lib/dmPending";
import { classifyUnsendError } from "../lib/unsend";
import type { UnsendResult } from "../lib/unsend";
import { classifyEditError, isMissingEditRpc, normalizeEditText, parseEditResponse } from "../lib/messageEdit";
import type { EditResult } from "../lib/messageEdit";
import { isMissingReactionsTableError, myReaction, overlayPendingReactions, reactionRowsToReactions, withReaction } from "../lib/reactions";
import type { MessageReaction, QuickReaction } from "../lib/reactions";
import { createReactionWriteQueue } from "../lib/reactionWrites";
import { withLocallyRead } from "../lib/notificationInbox";
import { createReactionSeqClock, reactionSeqFromRow, rowsShowOrdering, sendReactionWrite } from "../lib/reactionOrder";
import type { OrderingSupport, ReactionTransport } from "../lib/reactionOrder";
import {
  classifyImageInsertError,
  dmImagePath,
  imageFromRow,
  imageRowColumns,
  isMissingImageSupportError,
  progressStep,
  rowsHaveImageColumn,
} from "../lib/chatImages";
import type { ChatImageRef, ImageRowColumns, ImageSendFailure, ImageSupport, ProcessedChatImage } from "../lib/chatImages";
import { chatImageUrls, removeChatImage, resetChatImageUrls, uploadChatImage } from "../lib/chatImageClient";
import { PROBE_EMOJI, customReactionSupport } from "../lib/customReactions";
import { dmVoicePath, isMissingVoiceSupportError, rowsHaveVoiceColumn, voiceFileType, voiceFromRow, voiceRowColumns } from "../lib/chatVoice";
import type { ChatVoiceRef, VoiceRowColumns } from "../lib/chatVoice";
import type { VoiceClip } from "../lib/voiceRecorder";
import {
  isMissingMediaSupportError,
  mediaFromRow,
  mediaObjectNames,
  mediaPrefix,
  mediaRowValue,
  rowsHaveMediaColumn,
  sentMediaItems,
  toMediaSendItems,
} from "../lib/chatMedia";
import type { ChatMediaDraftItem, ChatMediaItem, MediaSendItem } from "../lib/chatMedia";
import { keepLocalMediaCopies, removeChatVideoObjects, removeUnsentMedia, resetChatVideoUrls, storeMediaItems } from "../lib/chatVideoClient";
import type { OutgoingMediaItemState } from "../types";

// Display state of a video / album send's items (the bytes stay in the job).
function outgoingItems(items: readonly MediaSendItem[]): OutgoingMediaItemState[] {
  return items.map((it) => ({ localUrl: it.localUrl, posterUrl: it.posterUrl, progress: it.progress, done: it.done, trim: it.trim }));
}

interface ConversationParticipantRow {
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
  cleared_before: string | null;
  hidden_at: string | null;
}

interface MessageRow extends ImageRowColumns, VoiceRowColumns {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  // Only present once migration 20261026120000_add_message_replies is
  // applied (select("*") then returns it, null or not). Its presence on
  // fetched rows is how repliesSupported below detects the column.
  reply_to_message_id?: string | null;
  // Only present once migration 20261105120000_add_dm_unsend is applied;
  // its presence is how unsendSupported detects the feature.
  unsent_at?: string | null;
  // Only present once migration 20261108140000_chat_message_edit is
  // applied; its presence is how editSupported detects the feature.
  edited_at?: string | null;
  // image_path / image_width / image_height / image_thumb (ImageRowColumns):
  // only present once migration 20261107170000_chat_images is applied.
  // A video / album (20261107220000): the stored item array.
  media?: unknown;
}

// A message this client just sent, rendered before the server round trip
// confirms it. Not a MessageRow with a real id -- pending.id is a client-
// only tempid never sent to Supabase, so there's no risk of colliding with
// a real message id.
interface PendingMessage {
  tempId: string;
  conversation_id: string;
  otherId: string; // matched directly against messagesWithGolfer's otherId — conversationIdWith() can't resolve a conversation that conversation_participants hasn't been refetched for yet (true for every conversation's very first message), so pending messages can't rely on that lookup being ready.
  sender_id: string;
  text: string;
  created_at: string;
  reply_to_message_id: string | null;
  // Set when the insert succeeds (lib/dmPending.ts): the pending bubble is
  // then matched to its real row by this id, not by text and clock.
  sent?: boolean;
  serverId?: string;
  // Photo messages (lib/chatImages.ts): the message id made on this device
  // (also the storage file name), the photo, and the send's state. A photo
  // message that fails stays here as "failed" (Retry / Discard); text-only
  // messages keep their old path (removed on failure, the page keeps them).
  photo?: {
    messageId: string;
    blob: Blob;
    localUrl: string;
    width: number;
    height: number;
    thumb: string | null;
    state: "sending" | "failed";
    progress: number;
    failure?: ImageSendFailure;
    uploaded: boolean;
    path?: string;
    // Set for a voice message (lib/chatVoice.ts, migration 20261107180000):
    // the same send machinery, an audio file instead of a JPEG.
    audio?: { durationMs: number; mime: string };
    // Set for a video / album (lib/chatMedia.ts, migration 20261107220000):
    // each item's display state; the bytes are in the job.
    media?: OutgoingMediaItemState[];
    mediaKinds?: { kind: "image" | "video"; width: number; height: number; durationMs: number; thumb: string | null }[];
  };
}

interface BlockRow {
  blocker_id: string;
  blocked_id: string;
}

interface FollowRow {
  follower_id: string;
  following_id: string;
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  actor_id: string | null;
  text: string;
  link_to: string;
  read: boolean;
  read_at: string | null;
  created_at: string;
}

interface RealSocialContextValue {
  profilesById: Map<string, GolferProfile>;
  /** More DM messages exist than the newest-N window holds, so older history may be missing (never in demo). */
  messageHistoryCut: boolean;
  isLoading: boolean;
  /** True once the first full fetch has finished, success OR failure (always true in demo). Check loadError before treating an empty inbox as empty. */
  hasLoaded: boolean;
  /** Nothing has loaded yet and the last fetch failed (never in demo). */
  loadError: boolean;
  /** Data loaded before, but the latest refresh failed; the older data is still in state (never in demo). */
  refreshFailed: boolean;
  /** Re-runs a full fetch (isLoading is true while it runs). */
  retry: () => Promise<void>;
  // The Golfers list for real accounts: the server directory
  // (golfer_directory: onboarded, named, Discoverable, unblocked either way,
  // not a test/reviewer account; lib/publicDirectory), minus self and
  // blocks. Distinct from profilesById above (which only ever holds people
  // already connected via a round/DM/notification). Shape unchanged
  // (GolferProfile[]); entries carry distanceBucket instead of coordinates.
  discoverableGolfers: GolferProfile[];
  // Resolves an id against every profile this client holds, including
  // hidden golfers it is connected to (follows either way, DMs,
  // notifications). For looking up a known person, never for listing.
  getKnownProfile: (id: string) => GolferProfile | undefined;
  // Settings' unblock list: one row per block THIS account made, whether or
  // not a profile can be resolved (lib/blockedContacts). Named only when
  // my_blocked_profiles() (or the cache) knows them and they haven't
  // blocked this account back; otherwise golfer is null ("Blocked contact").
  blockedContacts: BlockedContact<GolferProfile>[];

  canMessage: (otherId: string) => boolean;
  isBlocked: (id: string) => boolean;
  isBlockedBy: (id: string) => boolean;
  blockedIds: string[];
  blockUser: (id: string) => Promise<void>;
  unblockUser: (id: string) => Promise<void>;

  isFollowing: (id: string) => boolean;
  followingGolfers: GolferProfile[];
  getFollowerCount: (id: string) => Promise<number>;
  getProfileFollowers: (id: string) => Promise<ProfileFollowers>;
  followUser: (id: string) => Promise<void>;
  unfollowUser: (id: string) => Promise<void>;

  dmConversations: DmConversation[];
  hasUnreadMessages: boolean;
  messagesWithGolfer: (otherId: string) => DirectMessage[];
  sendDirectMessage: (otherId: string, text: string, replyToId?: string) => Promise<SendMessageResult>;
  // Whether this database has messages.reply_to_message_id yet. False until
  // the reply migration is applied (and until any message row has loaded to
  // prove it), so swipe-to-reply is simply not offered on an older schema.
  repliesSupported: boolean;
  // Unsend within 5 minutes (lib/unsend.ts, public.unsend_message). False
  // until the unsend migration is applied and a row has proved it.
  unsendSupported: boolean;
  unsendDirectMessage: (messageId: string) => Promise<UnsendResult>;
  // Edit my text message within 5 minutes (lib/messageEdit.ts,
  // public.edit_message). False until the edit migration is applied and a
  // row has proved it, or once the RPC turned out to be missing.
  editSupported: boolean;
  editDirectMessage: (messageId: string, text: string, expectedText?: string) => Promise<EditResult>;
  // Photos (lib/chatImages.ts, migration 20261107170000). False until the
  // database is known to have the image columns (a fetched row carries them
  // or a one-row probe succeeded), so the photo button stays hidden before.
  imagesSupported: boolean;
  // Uploads the photo, then inserts the message (with optional text and
  // quote). Shows at once as a sending bubble with progress; a failure stays
  // on screen as "Not sent" with retry / discard.
  sendDirectImage: (otherId: string, photo: ProcessedChatImage, text: string, replyToId?: string) => Promise<SendMessageResult>;
  retryDirectImage: (tempId: string) => Promise<SendMessageResult>;
  discardDirectImage: (tempId: string) => void;
  // Voice messages (lib/chatVoice.ts, migration 20261107180000): same send /
  // retry / discard path as photos (retryDirectImage / discardDirectImage).
  voiceSupported: boolean;
  sendDirectVoice: (otherId: string, clip: VoiceClip, replyToId?: string) => Promise<SendMessageResult>;
  // Videos and albums (lib/chatMedia.ts, migration 20261107220000): same
  // retry / discard as photos (retryDirectImage / discardDirectImage).
  mediaSupported: boolean;
  sendDirectMedia: (otherId: string, items: ChatMediaDraftItem[], text: string, replyToId?: string) => Promise<SendMessageResult>;
  // Quick reactions (lib/reactions.ts, public.message_reactions). False
  // until a fetch of the table has succeeded, so before the migration is
  // applied the reaction row and pills are simply not shown.
  reactionsSupported: boolean;
  messageReactions: MessageReaction[];
  // Sets (or with null removes) my reaction. Optimistic; writes per message
  // are serialized and the latest tap wins (lib/reactionWrites.ts). false =
  // my latest tap failed (rolled back); superseded failures stay quiet.
  setMessageReaction: (messageId: string, emoji: QuickReaction | null) => Promise<boolean>;
  markConversationRead: (otherId: string) => Promise<void>;
  clearChatHistory: (otherId: string) => Promise<void>;
  deleteConversation: (otherId: string) => Promise<void>;

  // Ephemeral, in-memory only -- never persisted, never a real message.
  // See the "typing" broadcast handler in the provider body for how this is
  // populated/expired.
  isOtherTyping: (otherId: string) => boolean;
  typingConversationIds: Set<string>;
  sendTypingSignal: (otherId: string, active: boolean) => void;

  reportUser: (
    reportedId: string,
    category: ReportCategory,
    details: string,
    context: Report["context"],
    meta?: ReportTarget,
  ) => Promise<void>;

  notifications: AppNotification[];
  unreadNotificationCount: number;
  markNotificationRead: (id: string) => Promise<void>;
  /** One filtered update for all of `ids` (own unread rows only); shown read at once. */
  markNotificationsRead: (ids: readonly string[]) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
}

const RealSocialContext = createContext<RealSocialContextValue | null>(null);

// Storage path of a photo / voice send: dm/<conv>/<id>.jpg | .m4a | .webm.
function jobPath(job: { conversationId: string | null; messageId: string; audio?: { mime: string } }): string {
  return job.audio ? dmVoicePath(job.conversationId!, job.messageId, voiceFileType(job.audio.mime).ext) : dmImagePath(job.conversationId!, job.messageId);
}

function messageRowToDirectMessage(row: MessageRow): DirectMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    text: row.text,
    createdAt: row.created_at,
    replyToId: row.reply_to_message_id ?? null,
    unsentAt: row.unsent_at ?? null,
    editedAt: row.edited_at ?? null,
    ...(row.image_path ? { image: imageFromRow(row) } : {}),
    ...(row.audio_path ? { voice: voiceFromRow(row) } : {}),
    ...(row.media ? { media: mediaFromRow(row.media) } : {}),
  };
}

// PostgREST PGRST204: the column isn't in its schema cache; Postgres 42703:
// undefined column. Either way the reply column isn't usable yet.
function isMissingReplyColumnError(error: { code?: string; message?: string }): boolean {
  if (error.code === "PGRST204" || error.code === "42703") return true;
  return typeof error.message === "string" && error.message.includes("reply_to_message_id");
}

function notificationRowToAppNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as NotificationType,
    actorId: row.actor_id ?? undefined,
    text: row.text,
    linkTo: row.link_to,
    read: row.read,
    readAt: row.read_at ?? undefined,
    createdAt: row.created_at,
  };
}

// Cheap structural equality for the small row arrays/objects this context
// holds. Every refetch used to replace every piece of state with a fresh
// array even when nothing had changed, which gave every derived memo and
// the (previously un-memoized) context value a new identity -- so every
// consumer, i.e. effectively the whole app via DataContext, re-rendered on
// every poll tick. Keeping the previous reference when the data is equal
// makes an unchanged refetch a no-op for React.
function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function keepIfSame<T>(prev: T, next: T): T {
  return sameJson(prev, next) ? prev : next;
}

function sameProfileMap(a: Map<string, GolferProfile>, b: Map<string, GolferProfile>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, profile] of b) {
    const other = a.get(id);
    if (!other || !sameJson(other, profile)) return false;
  }
  return true;
}

// Realtime (postgres_changes on messages/notifications/blocks) is the
// primary delivery path; polling is only the safety net for a websocket
// that died without telling anyone (iOS backgrounding). While the channel
// reports SUBSCRIBED, a slow poll is enough; when it's known to be down,
// fall back to the old 6 s cadence so delivery latency doesn't regress.
const POLL_TICK_MS = 6000;
const POLL_WHEN_REALTIME_OK_MS = 30000;
const POLL_WHEN_REALTIME_DOWN_MS = 6000;
// A "full" refetch also reloads the discovery directory (every profile)
// and the whole message window instead of just new messages. Runs on first
// load, after destructive changes (clear chat, a deleted message), and at
// least this often as a catch-all for anything the incremental path could
// miss (profile edits, deleted accounts).
const FULL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
// Incremental message fetches re-read this much history before the newest
// message already held, and dedupe by id -- so a row whose created_at
// (transaction start time) is slightly older than one already seen, but
// which committed later, is still picked up.
const MESSAGE_OVERLAP_MS = 2 * 60 * 1000;
// Newest-N windows. Messages are fetched newest-first and reversed, so if
// a user ever exceeds the window it's the oldest history that's left out,
// never the newest (the old ascending, unlimited query would have hit
// PostgREST's row cap and silently dropped the NEWEST messages instead).
const MESSAGE_WINDOW = 1000;
const NOTIFICATION_WINDOW = 200;
// Reactions in my conversations, newest first. 1:1 DMs: at most two per
// message, so this comfortably covers the message window.
const REACTION_WINDOW = 2000;

export function RealSocialProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser, profile: ownProfile } = useAuth();
  const [participants, setParticipants] = useState<ConversationParticipantRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [messageHistoryCut, setMessageHistoryCut] = useState(false);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [follows, setFollows] = useState<FollowRow[]>([]);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [notificationRows, setNotificationRows] = useState<NotificationRow[]>([]);
  // Notification ids this device marked read (in flight or confirmed),
  // shown read right away so the bell and badge don't wait for the
  // update + refetch, and a refetch that started before the update can't
  // flip them back. Read rows never become unread again, so keeping a
  // confirmed id here is harmless; a failed update takes its ids back out.
  const [locallyReadIds, setLocallyReadIds] = useState<ReadonlySet<string>>(() => new Set());
  const locallyReadRef = useRef<Set<string>>(new Set());
  // Every real profile this client knows about: the discovery directory
  // (refreshed on full refetches) plus any profile a conversation,
  // notification or follow needed before the next directory refresh.
  const [profileCache, setProfileCache] = useState<Map<string, GolferProfile>>(new Map());
  // Ids of people this user is connected to (conversation participants,
  // notification actors) -- profilesById is exactly these, as before.
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  // Ids from the last directory fetch -- the only ids the Golfers list may
  // offer. The cache above holds more than these (people this account is
  // connected to, hidden from the directory or not).
  const [directoryIds, setDirectoryIds] = useState<string[]>([]);
  // my_blocked_profiles() rows (name + avatar only), and the blocked-id set
  // they were fetched for.
  const [blockedNames, setBlockedNames] = useState<Map<string, GolferProfile>>(new Map());
  const blockedNamesKeyRef = useRef<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState(INITIAL_LOAD_STATUS);
  const fetchingRef = useRef(false);
  // conversation_id -> Date.now() of the last successful markConversationRead
  // call, so a caller that ends up invoking it repeatedly in a tight loop
  // (see markConversationRead below) can't turn into a request storm.
  const recentlyMarkedReadRef = useRef<Map<string, number>>(new Map());
  // A realtime event that arrives while a refetch is already in flight used
  // to be silently dropped (fetchingRef.current just bailed out early) with
  // nothing to trigger a follow-up — a message could land and, in a fast
  // burst, simply never show up until some unrelated action happened to
  // call refetch() again. This flag remembers that a fresh event was missed
  // and runs exactly one more refetch right after the in-flight one
  // finishes, so nothing is ever lost.
  const pendingRefetchRef = useRef(false);
  // Incremental-fetch bookkeeping. These refs are written only by refetch
  // (and reset when the account changes), so they always describe what's
  // actually in state.
  const forceFullRef = useRef(true);
  const lastFullAtRef = useRef(0);
  const lastFetchAtRef = useRef(0);
  const messagesRef = useRef<MessageRow[]>([]);
  const profileCacheRef = useRef<Map<string, GolferProfile>>(new Map());
  const convKeyRef = useRef<string | null>(null);
  const clearedKeyRef = useRef<string | null>(null);
  const realtimeHealthyRef = useRef(false);
  // Bumped whenever the signed-in account changes, so a fetch that started
  // under the previous account can't write its results into state.
  const generationRef = useRef(0);
  const selfId = authUser?.id;

  // Quick reactions. Loaded separately from messages (and never able to
  // fail the message load): "unknown" until the first fetch, "no" when the
  // table doesn't exist yet (migration not applied; then only retried on
  // full refetches), "yes" once a fetch succeeded.
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [reactionsSupport, setReactionsSupport] = useState<"unknown" | "yes" | "no">("unknown");
  const reactionsSupportRef = useRef<"unknown" | "yes" | "no">("unknown");
  const reactionsRef = useRef<MessageReaction[]>([]);
  // The newest fetch wins; an older one that resolves later is dropped.
  const reactionsFetchSeqRef = useRef(0);
  // My writes, one in flight per message with the latest tap queued behind
  // it (lib/reactionWrites.ts). Its pending() states are overlaid on fetched
  // rows so a fetch or realtime echo can't flip the pill back mid-way.
  // Reset (everything dropped) on account switch, below.
  const [reactionWrites] = useState(createReactionWriteQueue);
  // Server-side ordering (lib/reactionOrder.ts, migration 20261106160000):
  // each write carries a client sequence the server compares, so a write
  // that arrives late can't overwrite a newer one. Per account: reset (a
  // new object) on account switch, below.
  const [reactionSeqClock] = useState(createReactionSeqClock);
  const reactionOrderingRef = useRef<{ support: OrderingSupport }>({ support: "unknown" });
  const conversationIdsRef = useRef<string[]>([]);

  // Photos: whether messages has the image columns yet. "unknown" until the
  // one-row probe answers (retried on full refetches until "yes"); a fetched
  // row carrying image_path proves it too (imagesSupported below).
  const [imageProbe, setImageProbe] = useState<ImageSupport>("unknown");
  const imageProbeRef = useRef<ImageSupport>("unknown");
  const [imageColumnMissing, setImageColumnMissing] = useState(false);
  const probeImages = useCallback(async () => {
    if (!selfId) return;
    const generation = generationRef.current;
    const { error } = await supabase.from("messages").select("image_path").limit(1);
    if (generationRef.current !== generation) return;
    const next: ImageSupport = !error ? "yes" : isMissingImageSupportError(error) ? "no" : "unknown";
    imageProbeRef.current = next;
    setImageProbe(next);
    if (next === "yes") setImageColumnMissing(false);
  }, [selfId]);
  // Voice: same idea, its own migration (20261107180000), its own probe.
  const [voiceProbe, setVoiceProbe] = useState<ImageSupport>("unknown");
  const voiceProbeRef = useRef<ImageSupport>("unknown");
  const [voiceColumnMissing, setVoiceColumnMissing] = useState(false);
  const probeVoice = useCallback(async () => {
    if (!selfId) return;
    const generation = generationRef.current;
    const { error } = await supabase.from("messages").select("audio_path").limit(1);
    if (generationRef.current !== generation) return;
    const next: ImageSupport = !error ? "yes" : isMissingVoiceSupportError(error) ? "no" : "unknown";
    voiceProbeRef.current = next;
    setVoiceProbe(next);
    if (next === "yes") setVoiceColumnMissing(false);
  }, [selfId]);
  // Videos / albums: their own migration (20261107220000), their own probe.
  const [mediaProbe, setMediaProbe] = useState<ImageSupport>("unknown");
  const mediaProbeRef = useRef<ImageSupport>("unknown");
  const [mediaColumnMissing, setMediaColumnMissing] = useState(false);
  const probeMedia = useCallback(async () => {
    if (!selfId) return;
    const generation = generationRef.current;
    const { error } = await supabase.from("messages").select("media").limit(1);
    if (generationRef.current !== generation) return;
    const next: ImageSupport = !error ? "yes" : isMissingMediaSupportError(error) ? "no" : "unknown";
    mediaProbeRef.current = next;
    setMediaProbe(next);
    if (next === "yes") setMediaColumnMissing(false);
  }, [selfId]);

  const applyReactions = useCallback((next: MessageReaction[]) => {
    const kept = keepIfSame(reactionsRef.current, next);
    reactionsRef.current = kept;
    setReactions(kept);
  }, []);

  const fetchReactions = useCallback(
    async (conversationIds: string[]) => {
      if (!selfId) return;
      const generation = generationRef.current;
      const seq = ++reactionsFetchSeqRef.current;
      if (conversationIds.length === 0) {
        applyReactions([]);
        return;
      }
      const { data, error } = await supabase
        .from("message_reactions")
        // "*", not a column list: client_seq only exists once the ordering
        // migration is applied, and naming it before then fails the fetch.
        .select("*")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false })
        .limit(REACTION_WINDOW);
      if (generationRef.current !== generation || seq !== reactionsFetchSeqRef.current) return;
      if (error) {
        if (isMissingReactionsTableError(error)) {
          reactionsSupportRef.current = "no";
          setReactionsSupport("no");
        } else {
          // Keep what's shown; the next refetch tries again.
          console.error("GolfMe: failed to load message reactions.", error);
        }
        return;
      }
      reactionsSupportRef.current = "yes";
      setReactionsSupport("yes");
      // Custom emoji ("+" in the hold menu): asked once per page load.
      void customReactionSupport.probe(() => supabase.rpc("is_reaction_emoji", { p_emoji: PROBE_EMOJI }));
      const rows = (data ?? []) as { message_id?: unknown; user_id?: unknown; emoji?: unknown; client_seq?: unknown }[];
      // Ordering: the rows prove the migration, and my stored sequences
      // (any device, tombstones included) keep the next write above them.
      if (rowsShowOrdering(rows)) reactionOrderingRef.current.support = "yes";
      for (const row of rows) {
        const s = row.user_id === selfId && typeof row.message_id === "string" ? reactionSeqFromRow(row) : null;
        if (s !== null) reactionSeqClock.observe(row.message_id as string, s);
      }
      // Tombstones (emoji NULL) are dropped here: no pill.
      applyReactions(overlayPendingReactions(reactionRowsToReactions(rows), reactionWrites.pending(), selfId));
    },
    [selfId, applyReactions, reactionWrites, reactionSeqClock],
  );

  // Typing indicator -- ephemeral, in-memory, never written to Postgres.
  // conversation_id set of who's currently "typing" per the last broadcast
  // this client received. channelRef lets sendTypingSignal below reuse the
  // one already-open realtime channel (created in the effect further down)
  // instead of opening a second subscription. typingTimeoutsRef is the
  // receiver-side safety net (see the broadcast handler) so a missed
  // typing:stop can never strand an indicator forever. participantsRef
  // mirrors `participants` state for the broadcast handler's closure, which
  // is created once per channel (re)subscribe, not per participants change.
  const [typingConversationIds, setTypingConversationIds] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutsRef = useRef<Map<string, number>>(new Map());
  const participantsRef = useRef(participants);
  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  // `full` forces the directory + whole-message-window reload described at
  // FULL_REFRESH_INTERVAL_MS; otherwise only new messages are fetched.
  const refetch = useCallback(
    async (options?: { full?: boolean }) => {
      if (!selfId) return;
      if (options?.full) forceFullRef.current = true;
      if (fetchingRef.current) {
        pendingRefetchRef.current = true;
        return;
      }
      fetchingRef.current = true;
      const generation = generationRef.current;
      const isCurrent = () => generationRef.current === generation;
      lastFetchAtRef.current = Date.now();
      const full = forceFullRef.current || Date.now() - lastFullAtRef.current >= FULL_REFRESH_INTERVAL_MS;
      forceFullRef.current = false;
      try {
        // Discover/Find's real-mode candidate pool: the server-filtered
        // directory (lib/publicProfilesFetch; the old whole-table read only
        // on a database without the RPC). Only on full refetches: it used
        // to be re-downloaded on every poll tick and every realtime event.
        // Started now, in parallel with the batch below; it resolves with
        // its error rather than rejecting, so it's safe if never awaited.
        const directoryPromise = full ? fetchGolferDirectory(selfId) : null;
        const [
          { data: myConvIds, error: convErr },
          { data: blockRows, error: blockErr },
          { data: notifRows, error: notifErr },
          { data: followRows, error: followErr },
        ] = await Promise.all([
          supabase.from("conversation_participants").select("conversation_id, user_id, last_read_at, cleared_before, hidden_at").eq("user_id", selfId),
          supabase.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${selfId},blocked_id.eq.${selfId}`),
          supabase.from("notifications").select("*").eq("user_id", selfId).order("created_at", { ascending: false }).limit(NOTIFICATION_WINDOW),
          supabase.from("follows").select("follower_id, following_id").or(`follower_id.eq.${selfId},following_id.eq.${selfId}`),
        ]);
        if (convErr) throw convErr;
        if (blockErr) throw blockErr;
        if (notifErr) throw notifErr;
        if (followErr) throw followErr;
        let directoryProfiles: GolferProfile[] | null = null;
        if (directoryPromise) {
          const { profiles, error } = await directoryPromise;
          if (error) throw error;
          directoryProfiles = profiles;
        }
        if (!isCurrent()) return;
        // Names for this account's own blocks (my_blocked_profiles), on a
        // full refetch or whenever the set it blocked changed. Never fails
        // the refetch: the unblock list renders every block row anyway.
        const myBlockedKey = ((blockRows ?? []) as BlockRow[])
          .filter((b) => b.blocker_id === selfId)
          .map((b) => b.blocked_id)
          .sort()
          .join(",");
        if (full || myBlockedKey !== blockedNamesKeyRef.current) {
          const named = myBlockedKey ? await fetchMyBlockedProfiles() : [];
          if (!isCurrent()) return;
          blockedNamesKeyRef.current = myBlockedKey;
          const next = new Map(named.map((g) => [g.id, g]));
          setBlockedNames((prev) => (sameProfileMap(prev, next) ? prev : next));
        }

        setBlocks((prev) => keepIfSame(prev, (blockRows ?? []) as BlockRow[]));
        setNotificationRows((prev) => keepIfSame(prev, (notifRows ?? []) as NotificationRow[]));
        setFollows((prev) => keepIfSame(prev, (followRows ?? []) as FollowRow[]));

        const myRows = (myConvIds ?? []) as ConversationParticipantRow[];
        const conversationIds = [...new Set(myRows.map((r) => r.conversation_id))];
        // Anything that can REMOVE messages from this user's view (a new
        // or vanished conversation, a cleared_before change from "Clear
        // chat" on any device) needs the full window, not a delta.
        const convKey = [...conversationIds].sort().join(",");
        const clearedKey = myRows
          .map((r) => `${r.conversation_id}:${r.cleared_before ?? ""}`)
          .sort()
          .join("|");

        let nextParticipants: ConversationParticipantRow[] = [];
        let nextMessages: MessageRow[] = messagesRef.current.length === 0 ? messagesRef.current : [];
        if (conversationIds.length > 0) {
          const newest = messagesRef.current[messagesRef.current.length - 1];
          const incremental = !full && Boolean(newest) && convKey === convKeyRef.current && clearedKey === clearedKeyRef.current;
          const participantsQuery = supabase
            .from("conversation_participants")
            .select("conversation_id, user_id, last_read_at, cleared_before, hidden_at")
            .in("conversation_id", conversationIds);
          const messagesQuery = incremental
            ? supabase
                .from("messages")
                .select("*")
                .in("conversation_id", conversationIds)
                .gte("created_at", new Date(Date.parse(newest.created_at) - MESSAGE_OVERLAP_MS).toISOString())
                .order("created_at", { ascending: true })
            : // count: the exact total, so a cut window is known whatever the row cap (messageHistoryCut).
              supabase
                .from("messages")
                .select("*", { count: "exact" })
                .in("conversation_id", conversationIds)
                .order("created_at", { ascending: false })
                .limit(MESSAGE_WINDOW);
          const [{ data: allParticipants, error: pErr }, { data: messageRows, error: mErr, count: messageTotal }] = await Promise.all([
            participantsQuery,
            messagesQuery,
          ]);
          if (pErr) throw pErr;
          if (mErr) throw mErr;
          if (!isCurrent()) return;
          nextParticipants = (allParticipants ?? []) as ConversationParticipantRow[];
          const fetched = (messageRows ?? []) as MessageRow[];
          if (incremental) {
            const known = new Map(messagesRef.current.map((m) => [m.id, m]));
            const added = fetched.filter((m) => !known.has(m.id));
            // A row fetched again with new content (an edit or unsend this
            // poll saw while realtime was down): take the newer version.
            const changed = new Map(
              fetched.filter((m) => {
                const k = known.get(m.id);
                return k !== undefined && !sameJson(k, m);
              }).map((m) => [m.id, m]),
            );
            const current = changed.size > 0 ? messagesRef.current.map((m) => changed.get(m.id) ?? m) : messagesRef.current;
            nextMessages = added.length === 0 ? current : [...current, ...added].sort((a, b) => a.created_at.localeCompare(b.created_at));
          } else {
            nextMessages = keepIfSame(messagesRef.current, fetched.reverse());
            // More DM messages exist than the newest-N window holds: older
            // history may be missing from some threads (which ones isn't known).
            setMessageHistoryCut(isHistoryCut({ held: fetched.length, total: messageTotal, fetched: fetched.length, limit: MESSAGE_WINDOW }));
          }
        } else {
          setMessageHistoryCut(false);
        }
        setParticipants((prev) => keepIfSame(prev, nextParticipants));
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        convKeyRef.current = convKey;
        clearedKeyRef.current = clearedKey;
        // Reactions ride along with every successful refetch (poll, resume,
        // realtime message event) but never block or fail it.
        conversationIdsRef.current = conversationIds;
        if (reactionsSupportRef.current !== "no" || full) void fetchReactions(conversationIds);
        // Photos: probe the column until it's known to exist (never blocks).
        if (full && imageProbeRef.current !== "yes") void probeImages();
        if (full && voiceProbeRef.current !== "yes") void probeVoice();
        if (full && mediaProbeRef.current !== "yes") void probeMedia();

        // Profiles: the directory (when just fetched) replaces the cache
        // wholesale, which also drops deleted accounts; otherwise only ids
        // this refetch needs but the cache doesn't have yet are fetched.
        const connected = new Set<string>();
        for (const p of nextParticipants) connected.add(p.user_id);
        for (const n of notifRows ?? []) if (n.actor_id) connected.add(n.actor_id);
        const needed = new Set(connected);
        for (const f of followRows ?? []) {
          needed.add(f.follower_id);
          needed.add(f.following_id);
        }
        let cache = profileCacheRef.current;
        if (directoryProfiles) cache = new Map(directoryProfiles.map((g) => [g.id, g]));
        const missing = [...needed].filter((id) => !cache.has(id));
        if (missing.length > 0) {
          // By id (golfer_public_profiles): connected people resolve even
          // when hidden from the directory; anyone blocked either way, and
          // deleted accounts, simply don't come back.
          const { profiles, error: profErr } = await fetchPublicProfiles(missing);
          if (profErr) throw profErr;
          if (!isCurrent()) return;
          cache = new Map(cache);
          for (const g of profiles) cache.set(g.id, g);
        }
        if (cache !== profileCacheRef.current) {
          profileCacheRef.current = cache;
          setProfileCache((prev) => (sameProfileMap(prev, cache) ? prev : cache));
        }
        if (directoryProfiles) {
          const ids = directoryProfiles.map((g) => g.id);
          setDirectoryIds((prev) => keepIfSame(prev, ids));
        }
        setConnectedIds((prev) => keepIfSame(prev, [...connected].sort()));
        if (full) lastFullAtRef.current = Date.now();
        setLoadStatus((prev) => applyLoadOutcome(prev, true));
      } catch (err) {
        // Retry the full reload next time rather than silently falling
        // back to incremental on a half-applied state.
        if (full) forceFullRef.current = true;
        console.error("GolfMe: failed to load messages/blocks/notifications.", err);
        // State is left as it was: a failed refresh keeps the last good data.
        if (isCurrent()) setLoadStatus((prev) => applyLoadOutcome(prev, false));
      } finally {
        // A fetch that outlived its account must not clear the NEW
        // account's in-flight flag or run a follow-up with a stale closure.
        if (isCurrent()) {
          fetchingRef.current = false;
          if (pendingRefetchRef.current) {
            pendingRefetchRef.current = false;
            refetch();
          }
        }
      }
    },
    [selfId, fetchReactions, probeImages, probeVoice, probeMedia],
  );

  // Directory distances are computed server-side from this account's saved
  // playing area, so a location change re-runs the full fetch instead of
  // waiting up to FULL_REFRESH_INTERVAL_MS with distances from the old one.
  const ownCoords = ownProfile?.playingAreaCoords;
  const ownLocationKey = `${selfId ?? ""}|${ownCoords ? `${ownCoords.lat},${ownCoords.lng}` : ""}`;
  const lastLocationKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastLocationKeyRef.current;
    lastLocationKeyRef.current = ownLocationKey;
    if (isDemo || !selfId || prev === null) return;
    // Same account, different saved area (an account switch is handled by
    // the account effect below).
    if (prev !== ownLocationKey && prev.split("|")[0] === selfId) void refetch({ full: true });
  }, [isDemo, selfId, ownLocationKey, refetch]);

  const retry = useCallback(async () => {
    setIsLoading(true);
    try {
      await refetch({ full: true });
    } finally {
      setIsLoading(false);
    }
  }, [refetch]);

  useEffect(() => {
    // New account (or signed out / demo): nothing fetched so far applies.
    generationRef.current += 1;
    forceFullRef.current = true;
    lastFullAtRef.current = 0;
    messagesRef.current = [];
    profileCacheRef.current = new Map();
    blockedNamesKeyRef.current = null;
    convKeyRef.current = null;
    clearedKeyRef.current = null;
    realtimeHealthyRef.current = false;
    // A fetch from the previous account may still be "in flight"; its
    // results are discarded by the generation check, so don't let it
    // block this account's first fetch.
    fetchingRef.current = false;
    pendingRefetchRef.current = false;
    reactionsRef.current = [];
    reactionsSupportRef.current = "unknown";
    // The previous account's pending reaction writes: nothing queued is
    // sent, late results are ignored, no toast from them.
    reactionWrites.reset();
    // A new object: a write still in flight from the previous account keeps
    // (and may update) the old one only.
    reactionSeqClock.reset();
    reactionOrderingRef.current = { support: "unknown" };
    conversationIdsRef.current = [];
    setReactions([]);
    setReactionsSupport("unknown");
    locallyReadRef.current = new Set();
    setLocallyReadIds(new Set());
    // Photos: another account's signed URLs / local photos never carry over.
    resetChatImageUrls();
    resetChatVideoUrls();
    mediaProbeRef.current = "unknown";
    setMediaProbe("unknown");
    setMediaColumnMissing(false);
    imageProbeRef.current = "unknown";
    setImageProbe("unknown");
    setImageColumnMissing(false);
    voiceProbeRef.current = "unknown";
    setVoiceProbe("unknown");
    setVoiceColumnMissing(false);
    setMessageHistoryCut(false);

    if (isDemo || !selfId) {
      setParticipants([]);
      setMessages([]);
      setBlocks([]);
      setNotificationRows([]);
      setProfileCache(new Map());
      setDirectoryIds([]);
      setBlockedNames(new Map());
      setConnectedIds([]);
      setFollows([]);
      setPendingMessages([]);
      setLoadStatus(INITIAL_LOAD_STATUS);
      return;
    }

    setIsLoading(true);
    setLoadStatus(INITIAL_LOAD_STATUS);
    refetch({ full: true }).finally(() => setIsLoading(false));

    // Receiver-side timeout: cleared/reset every time a fresh typing:start
    // for a conversation arrives, so a single missed typing:stop (dropped
    // event, sender's app killed mid-type, connection loss) can never
    // strand "X is typing..." forever -- the indicator always self-clears
    // within this window regardless of what the sender does.
    const TYPING_EXPIRY_MS = 4000;

    function clearTypingConversation(conversationId: string) {
      setTypingConversationIds((prev) => {
        if (!prev.has(conversationId)) return prev;
        const next = new Set(prev);
        next.delete(conversationId);
        return next;
      });
    }

    const channel = supabase
      .channel("social-realtime")
      // A deleted message (e.g. the other account was deleted and its
      // messages cascaded away) can't be picked up by the incremental
      // new-messages fetch, so DELETE forces the full window. So does
      // UPDATE: the only one is an unsend (public.unsend_message wipes the
      // text of an existing row), which the new-rows-only incremental fetch
      // would never pick up.
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) =>
        refetch(payload.eventType === "DELETE" || payload.eventType === "UPDATE" ? { full: true } : undefined),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "blocks" }, () => refetch())
      // Ephemeral typing signal -- never written to Postgres, no message
      // row, no schema. Broadcast on this channel isn't RLS-scoped the way
      // postgres_changes above is (every signed-in client shares the same
      // channel name), so anything for a conversation this client isn't
      // actually a participant in is dropped here rather than trusted.
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const { conversationId, senderId, status } = (payload ?? {}) as {
          conversationId?: string;
          senderId?: string;
          status?: "start" | "stop";
        };
        if (!conversationId || !senderId || senderId === selfId) return;
        const isMine = participantsRef.current.some((p) => p.conversation_id === conversationId && p.user_id === selfId);
        if (!isMine) return;

        const existingTimeout = typingTimeoutsRef.current.get(conversationId);
        if (existingTimeout !== undefined) window.clearTimeout(existingTimeout);

        if (status === "stop") {
          typingTimeoutsRef.current.delete(conversationId);
          clearTypingConversation(conversationId);
          return;
        }

        setTypingConversationIds((prev) => (prev.has(conversationId) ? prev : new Set(prev).add(conversationId)));
        typingTimeoutsRef.current.set(
          conversationId,
          window.setTimeout(() => {
            typingTimeoutsRef.current.delete(conversationId);
            clearTypingConversation(conversationId);
          }, TYPING_EXPIRY_MS),
        );
      })
      .subscribe((status) => {
        // A previous account's channel reporting CLOSED after teardown
        // must not mark this one unhealthy.
        if (channelRef.current !== channel) return;
        const wasHealthy = realtimeHealthyRef.current;
        realtimeHealthyRef.current = status === "SUBSCRIBED";
        // Re-subscribed after an outage: catch up on anything whose event
        // was missed while the socket was down.
        if (!wasHealthy && realtimeHealthyRef.current && lastFetchAtRef.current > 0) refetch();
      });

    channelRef.current = channel;

    // Defense in depth against the realtime websocket silently dying —
    // known to happen on mobile browsers when the tab is backgrounded
    // (phone locked, app-switched away from) for a while, and Supabase's
    // own client doesn't always reliably reconnect + catch up on its own.
    // Without this, a message or notification that arrived while the
    // socket was dead would only ever show up once something else (like
    // manually opening the inbox, which does a real fetch) happened to
    // trigger a refetch — reads as "the live popup never fired" even
    // though the data was there all along. A refetch on regaining
    // visibility, plus a poll while actively visible (every 6 s while the
    // channel is known to be down, every 30 s while it reports healthy),
    // means the user is never far from a fresh fetch either way.
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      // visibilitychange and focus usually fire together on resume.
      if (Date.now() - lastFetchAtRef.current < 1000) return;
      refetch();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const pollInterval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const interval = realtimeHealthyRef.current ? POLL_WHEN_REALTIME_OK_MS : POLL_WHEN_REALTIME_DOWN_MS;
      if (Date.now() - lastFetchAtRef.current >= interval - 500) refetch();
    }, POLL_TICK_MS);
    // Captured here (not re-read via typingTimeoutsRef.current inside the
    // cleanup below) since this ref's Map is mutated in place, never
    // reassigned -- same object reference throughout, so this stays valid
    // by the time cleanup runs.
    const typingTimeouts = typingTimeoutsRef.current;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(pollInterval);
      for (const timeout of typingTimeouts.values()) window.clearTimeout(timeout);
      typingTimeouts.clear();
      setTypingConversationIds(new Set());
    };
  }, [isDemo, selfId, refetch, reactionWrites, reactionSeqClock]);

  // Reactions realtime, on its OWN channel and only once the table is known
  // to exist: a postgres_changes subscription naming a missing table makes
  // the server refuse the whole channel join, which on the shared
  // "social-realtime" channel would also take down message delivery.
  // RLS filters INSERT/UPDATE per subscriber; a DELETE carries only the
  // row's random id. Any event: reload the reactions (cheap, one query).
  const reactionsLive = !isDemo && Boolean(selfId) && reactionsSupport === "yes";
  useEffect(() => {
    if (!reactionsLive) return;
    const channel = supabase
      .channel("social-reactions")
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, () => {
        void fetchReactions(conversationIdsRef.current);
      })
      .subscribe((status) => {
        // (Re)connected: catch up on anything missed while it was down.
        if (status === "SUBSCRIBED") void fetchReactions(conversationIdsRef.current);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reactionsLive, fetchReactions]);

  const profilesById = useMemo(() => {
    const map = new Map<string, GolferProfile>();
    for (const id of connectedIds) {
      const profile = profileCache.get(id);
      if (profile) map.set(id, profile);
    }
    return map;
  }, [connectedIds, profileCache]);
  const allProfiles = useMemo(() => Array.from(profileCache.values()), [profileCache]);

  // Drops a pending (optimistic) message once the realtime-driven refetch
  // above brings in the real row it corresponds to -- by the row id the
  // insert returned (lib/dmPending.ts; the old text + client-clock match
  // left a second bubble whenever the phone's clock ran ahead of the
  // server). visiblePending applies the same rule at render time, so there
  // is never a frame with both bubbles once the id is known.
  useEffect(() => {
    if (pendingMessages.length === 0) return;
    setPendingMessages((prevPending) => reconcilePendingDms(prevPending, messages));
  }, [messages, pendingMessages]);
  const visiblePending = useMemo(() => reconcilePendingDms(pendingMessages, messages), [pendingMessages, messages]);

  const blockedIds = useMemo(() => (selfId ? blocks.filter((b) => b.blocker_id === selfId).map((b) => b.blocked_id) : []), [blocks, selfId]);
  const blockedByIds = useMemo(() => (selfId ? blocks.filter((b) => b.blocked_id === selfId).map((b) => b.blocker_id) : []), [blocks, selfId]);
  const isBlocked = useCallback((id: string) => blockedIds.includes(id), [blockedIds]);
  const isBlockedBy = useCallback((id: string) => blockedByIds.includes(id), [blockedByIds]);
  const canMessage = useCallback(
    (otherId: string) => Boolean(selfId) && otherId !== selfId && !isBlocked(otherId) && !isBlockedBy(otherId),
    [selfId, isBlocked, isBlockedBy],
  );

  const blockUser = useCallback(
    async (id: string) => {
      if (!selfId) return;
      const { error } = await supabase.from("blocks").insert({ blocker_id: selfId, blocked_id: id });
      if (error) throw new Error(error.message);
      // Full: the directory and the blocked-names list both change.
      await refetch({ full: true });
    },
    [selfId, refetch],
  );

  const unblockUser = useCallback(
    async (id: string) => {
      if (!selfId) return;
      const { error } = await supabase.from("blocks").delete().eq("blocker_id", selfId).eq("blocked_id", id);
      if (error) throw new Error(error.message);
      // Full: the unblocked golfer can reappear in the directory.
      await refetch({ full: true });
    },
    [selfId, refetch],
  );

  const followingIds = useMemo(() => (selfId ? follows.filter((f) => f.follower_id === selfId).map((f) => f.following_id) : []), [follows, selfId]);
  const isFollowing = useCallback((id: string) => followingIds.includes(id), [followingIds]);
  const followingGolfers = useMemo(() => followingIds.map((id) => allProfiles.find((g) => g.id === id)).filter((g): g is GolferProfile => Boolean(g)), [followingIds, allProfiles]);

  const getFollowerCount = useCallback(async (id: string) => {
    if (!selfId) throw new Error("Sign in to view followers");
    return fetchFollowerCount(id);
  }, [selfId]);

  const getProfileFollowers = useCallback(async (id: string) => {
    if (!selfId) throw new Error("Sign in to view followers");
    const generation = generationRef.current;
    const result = await fetchProfileFollowers(id, selfId);
    if (generationRef.current !== generation) throw new Error("Account changed");
    // A follower opened from this list must resolve on /golfer/:id even if
    // not in the discovery directory. Only server-filtered public fields.
    const cache = new Map(profileCacheRef.current);
    for (const golfer of result.golfers) cache.set(golfer.id, golfer);
    profileCacheRef.current = cache;
    setProfileCache((prev) => sameProfileMap(prev, cache) ? prev : cache);
    return result;
  }, [selfId]);

  // Optimistic per the product spec: the button flips immediately, then
  // reconciles with the real write. A failed insert/delete rolls the local
  // state back to what it was before the tap and re-throws so the caller
  // can show its own error toast — never leaves the button showing a state
  // the database doesn't actually have.
  const followUser = useCallback(
    async (id: string) => {
      if (!selfId || id === selfId) return;
      const alreadyFollowing = followingIds.includes(id);
      if (alreadyFollowing) return;
      setFollows((prev) => [...prev, { follower_id: selfId, following_id: id }]);
      const { error } = await supabase.from("follows").insert({ follower_id: selfId, following_id: id });
      if (error) {
        setFollows((prev) => prev.filter((f) => !(f.follower_id === selfId && f.following_id === id)));
        throw new Error(error.message);
      }
    },
    [selfId, followingIds],
  );

  const unfollowUser = useCallback(
    async (id: string) => {
      if (!selfId) return;
      const previous = follows;
      setFollows((prev) => prev.filter((f) => !(f.follower_id === selfId && f.following_id === id)));
      const { error } = await supabase.from("follows").delete().eq("follower_id", selfId).eq("following_id", id);
      if (error) {
        setFollows(previous);
        throw new Error(error.message);
      }
    },
    [selfId, follows],
  );

  const conversationIdWith = useCallback(
    (otherId: string) => {
      const mine = new Set(participants.filter((p) => p.user_id === selfId).map((p) => p.conversation_id));
      const theirs = participants.filter((p) => p.user_id === otherId && mine.has(p.conversation_id));
      return theirs[0]?.conversation_id;
    },
    [participants, selfId],
  );

  const messagesWithGolfer = useCallback(
    (otherId: string): DirectMessage[] => {
      const convId = conversationIdWith(otherId);
      const canonical = convId ? messages.filter((m) => m.conversation_id === convId) : [];
      // Pending entries matched by otherId directly, not by conversation_id
      // -- a brand-new conversation's very first message is sent before
      // conversation_participants has been refetched, so conversationIdWith
      // can't resolve it yet. Matching on otherId works regardless.
      // A photo message whose row already arrived (the realtime refetch can
      // beat the insert's own answer): the row wins, no second bubble.
      const rowIds = new Set(canonical.map((m) => m.id));
      const pending = visiblePending
        .filter((p) => p.otherId === otherId && !(p.photo && rowIds.has(p.photo.messageId)))
        .map((p): MessageRow & { photo?: PendingMessage["photo"]; tempId?: string } => ({
          // The real id once the insert returned it: the bubble keeps its
          // React key when the real row replaces it, and swipe-to-reply
          // on a just-sent message quotes a real message id.
          id: p.serverId ?? p.tempId,
          conversation_id: p.conversation_id,
          sender_id: p.sender_id,
          text: p.text,
          created_at: p.created_at,
          reply_to_message_id: p.reply_to_message_id,
          photo: p.photo,
          tempId: p.tempId,
        }));
      const rows: (MessageRow & { photo?: PendingMessage["photo"]; tempId?: string })[] = [...canonical, ...pending];
      return rows
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((row) => {
          const message = messageRowToDirectMessage(row);
          const photo = row.photo;
          if (!photo) return message;
          // This device's photo: its local copy, and (until stored) the
          // send's state. Sent = a normal message with the real path.
          const pendingPath = photo.path ?? `pending/${photo.messageId}`;
          const sentOk = message.id !== row.tempId;
          if (photo.media && photo.mediaKinds) {
            // A video / album: real paths once stored (shown from this
            // device's copies), placeholders while sending.
            const prefix = photo.path ?? null;
            const items: ChatMediaItem[] = photo.mediaKinds.map((k, i) => ({
              kind: k.kind,
              path: prefix ? `${prefix}/${i}.${k.kind === "video" ? "mp4" : "jpg"}` : `pending/${photo.messageId}/${i}`,
              poster: k.kind === "video" ? (prefix ? `${prefix}/${i}.poster.jpg` : null) : undefined,
              width: k.width,
              height: k.height,
              durationMs: k.kind === "video" ? k.durationMs : undefined,
              thumb: k.thumb,
            }));
            return {
              ...message,
              media: items,
              delivery: sentOk ? undefined : photo.state,
              outgoingPhoto: { localUrl: photo.localUrl, progress: sentOk ? undefined : photo.progress, failure: photo.failure, items: photo.media },
            };
          }
          const media: { image?: ChatImageRef; voice?: ChatVoiceRef } = photo.audio
            ? { voice: { path: pendingPath, durationMs: photo.audio.durationMs } }
            : { image: { path: pendingPath, width: photo.width, height: photo.height, thumb: photo.thumb } };
          return {
            ...message,
            ...media,
            delivery: sentOk ? undefined : photo.state,
            outgoingPhoto: { localUrl: photo.localUrl, progress: sentOk ? undefined : photo.progress, failure: photo.failure },
          };
        });
    },
    [conversationIdWith, messages, visiblePending],
  );

  const isOtherTyping = useCallback(
    (otherId: string) => {
      const convId = conversationIdWith(otherId);
      return convId ? typingConversationIds.has(convId) : false;
    },
    [conversationIdWith, typingConversationIds],
  );

  // No conversation row exists yet (this pair has never exchanged a real
  // message) -- conversationIdWith returns undefined and there's nothing to
  // signal against. Typing indicators simply don't apply until the first
  // real message creates the conversation via get_or_create_dm_conversation.
  const sendTypingSignal = useCallback(
    (otherId: string, active: boolean) => {
      if (!selfId || !channelRef.current) return;
      const convId = conversationIdWith(otherId);
      if (!convId) return;
      void channelRef.current.send({
        type: "broadcast",
        event: "typing",
        payload: { conversationId: convId, senderId: selfId, status: active ? "start" : "stop" },
      });
    },
    [selfId, conversationIdWith],
  );

  // Rollout safety for swipe-to-reply: production gets the column only when
  // the migration is applied by hand, possibly after this client ships.
  // select("*") returns every column, so any loaded row carrying the
  // reply_to_message_id key proves the column exists. replyColumnMissing
  // latches if an insert is ever refused for an unknown column anyway (a
  // stale PostgREST schema cache, or the migration rolled back), so the app
  // falls back to plain messages instead of failing sends.
  const [replyColumnMissing, setReplyColumnMissing] = useState(false);
  const repliesSupported = useMemo(
    () => !replyColumnMissing && messages.some((m) => Object.prototype.hasOwnProperty.call(m, "reply_to_message_id")),
    [messages, replyColumnMissing],
  );

  const sendDirectMessage = useCallback(
    async (otherId: string, text: string, replyToId?: string): Promise<SendMessageResult> => {
      const trimmed = text.trim();
      if (!trimmed || !selfId || !canMessage(otherId)) return "failed";
      const { data: convId, error: convErr } = await supabase.rpc("get_or_create_dm_conversation", { p_other_user_id: otherId });
      if (convErr) {
        console.error("GolfMe: failed to open conversation.", convErr);
        return "failed";
      }
      // Optimistic: render immediately, before the network round trip. The
      // effect above drops this once the realtime-driven refetch brings in
      // the real row. No trailing refetch() here on purpose — the realtime
      // subscription on the `messages` table already fires for this exact
      // insert (the sender is subscribed to their own conversations too),
      // so calling refetch() again here would just be a second, redundant
      // full reload racing the one realtime is about to trigger anyway.
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimisticCreatedAt = new Date().toISOString();
      const replyTo = replyToId && repliesSupported ? replyToId : null;
      setPendingMessages((prev) => [
        ...prev,
        { tempId, conversation_id: convId, otherId, sender_id: selfId, text: trimmed, created_at: optimisticCreatedAt, reply_to_message_id: replyTo },
      ]);

      const row: { conversation_id: string; sender_id: string; text: string; reply_to_message_id?: string } = {
        conversation_id: convId,
        sender_id: selfId,
        text: trimmed,
      };
      // .select("id"): the insert returns its row id, which is what the
      // pending bubble is reconciled by (lib/dmPending.ts). Readable under
      // messages_select_participant (the sender is a participant).
      const insert = (values: typeof row) => supabase.from("messages").insert(values).select("id").maybeSingle();
      let { data, error } = await insert(replyTo ? { ...row, reply_to_message_id: replyTo } : row);
      if (error && replyTo && isMissingReplyColumnError(error)) {
        // The column isn't there after all: send it as a plain message.
        setReplyColumnMissing(true);
        setPendingMessages((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, reply_to_message_id: null } : p)));
        ({ data, error } = await insert(row));
      }
      if (error) {
        setPendingMessages((prev) => prev.filter((p) => p.tempId !== tempId));
        if (isObjectionableContentError(error)) return "objectionable";
        console.error("GolfMe: failed to send message.", error);
        return "failed";
      }
      const serverId = (data as { id?: string } | null)?.id;
      setPendingMessages((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, sent: true, serverId } : p)));
      return "sent";
    },
    [selfId, canMessage, repliesSupported],
  );

  // Unsend (migration 20261105120000_add_dm_unsend): detected like replies,
  // from the column's presence on fetched rows. The server enforces sender
  // + 5-minute window and wipes the text; the realtime UPDATE then brings
  // the wiped row to both devices (full refetch, see the channel above).
  const unsendSupported = useMemo(() => messages.some((m) => Object.prototype.hasOwnProperty.call(m, "unsent_at")), [messages]);
  const unsendDirectMessage = useCallback(
    async (messageId: string): Promise<UnsendResult> => {
      if (!selfId) return "failed";
      // The photo's path, read before the database clears it.
      const imagePath =
        messagesRef.current.find((m) => m.id === messageId)?.image_path ??
        messagesRef.current.find((m) => m.id === messageId)?.audio_path ??
        (pendingMessages.find((p) => p.serverId === messageId)?.photo?.media ? null : pendingMessages.find((p) => p.serverId === messageId)?.photo?.path) ??
        null;
      // A video / album: every item's objects (read before the database clears them).
      const row = messagesRef.current.find((m) => m.id === messageId);
      const pendingPhoto = pendingMessages.find((p) => p.serverId === messageId)?.photo;
      const mediaNames = row?.media
        ? mediaObjectNames(mediaFromRow(row.media))
        : pendingPhoto?.media && pendingPhoto.path && pendingPhoto.mediaKinds
          ? pendingPhoto.mediaKinds.flatMap((k, i) => (k.kind === "video" ? [`${pendingPhoto.path}/${i}.mp4`, `${pendingPhoto.path}/${i}.poster.jpg`] : [`${pendingPhoto.path}/${i}.jpg`]))
          : [];
      const { error } = await supabase.rpc("unsend_message", { p_message_id: messageId });
      if (error) {
        const result = classifyUnsendError(error);
        if (result === "failed") console.error("GolfMe: failed to unsend message.", error);
        return result;
      }
      // Don't wait for the realtime echo to update this device.
      const unsentAt = new Date().toISOString();
      const next = messagesRef.current.map((m) =>
        m.id === messageId
          ? {
              ...m,
              text: "",
              unsent_at: m.unsent_at ?? unsentAt,
              ...(m.image_path !== undefined ? { image_path: null, image_width: null, image_height: null, image_thumb: null } : {}),
              ...(m.audio_path !== undefined ? { audio_path: null, audio_duration_ms: null } : {}),
              ...(m.media !== undefined ? { media: null } : {}),
            }
          : m,
      );
      messagesRef.current = next;
      setMessages(next);
      // The database dropped its reactions in the same transaction.
      applyReactions(reactionsRef.current.filter((r) => r.messageId !== messageId));
      // The row no longer points at the photo (unsend_message cleared it), so
      // nobody else can read it any more; remove the file itself (Storage
      // API only; best effort, see removeChatImage).
      if (imagePath) void removeChatImage(imagePath);
      if (mediaNames.length) void removeChatVideoObjects(mediaNames);
      return "unsent";
    },
    [selfId, applyReactions, pendingMessages],
  );

  // Edit (migration 20261108140000_chat_message_edit): detected from the
  // column on fetched rows, like unsend; a missing RPC (PGRST202) hides it
  // for this session. The server enforces sender, conversation access
  // (participant, no block), suspension, text-only and the 5-minute window
  // from the original created_at; this device only patches its own copy
  // from the server's answer (the realtime UPDATE brings it to the others).
  const [editRpcMissing, setEditRpcMissing] = useState(false);
  const editSupported = useMemo(
    () => !editRpcMissing && messages.some((m) => Object.prototype.hasOwnProperty.call(m, "edited_at")),
    [messages, editRpcMissing],
  );
  const editDirectMessage = useCallback(
    async (messageId: string, text: string, expectedText?: string): Promise<EditResult> => {
      if (!selfId) return "failed";
      const next = normalizeEditText(text);
      if (!next) return "empty";
      const { data, error } = await supabase.rpc("edit_message", {
        p_message_id: messageId,
        p_text: next,
        ...(expectedText !== undefined ? { p_expected_text: expectedText } : {}),
      });
      if (error) {
        if (isMissingEditRpc(error)) setEditRpcMissing(true);
        const result = classifyEditError(error);
        // Never the text itself: only the error.
        if (result === "failed") console.error("GolfMe: failed to edit message.", { code: error.code, hint: error.hint });
        return result;
      }
      const answer = parseEditResponse(data);
      if (!answer) return "failed";
      // Don't wait for the realtime echo to update this device.
      const patched = messagesRef.current.map((m) =>
        m.id === messageId ? { ...m, text: answer.text, edited_at: answer.editedAt ?? m.edited_at ?? null } : m,
      );
      messagesRef.current = patched;
      setMessages(patched);
      return answer.status;
    },
    [selfId],
  );

  // ---- Photos (lib/chatImages.ts, migration 20261107170000) ----
  const imagesSupported = useMemo(
    () => !imageColumnMissing && (imageProbe === "yes" || rowsHaveImageColumn(messages)),
    [imageColumnMissing, imageProbe, messages],
  );
  // What a photo send needs that isn't display state; mutated as it
  // progresses (conversation resolved, uploaded), so a retry resumes where
  // the last attempt stopped (an uploaded photo isn't uploaded twice).
  const photoJobsRef = useRef(
    new Map<
      string,
      {
        otherId: string;
        conversationId: string | null;
        messageId: string;
        blob: Blob;
        localUrl: string;
        width: number;
        height: number;
        thumb: string | null;
        text: string;
        replyTo: string | null;
        uploaded: boolean;
        generation: number;
        // A voice message instead of a photo (same machinery).
        audio?: { durationMs: number; mime: string };
        // A video / album (lib/chatMedia.ts): every item's bytes and state.
        media?: MediaSendItem[];
      }
    >(),
  );
  // One attempt at a time per photo (a double tap on Retry can't send twice).
  const photoInFlightRef = useRef(new Map<string, Promise<SendMessageResult>>());

  const patchPhoto = useCallback((tempId: string, patch: Partial<NonNullable<PendingMessage["photo"]>>, extra?: Partial<PendingMessage>) => {
    setPendingMessages((prev) => prev.map((p) => (p.tempId === tempId && p.photo ? { ...p, ...extra, photo: { ...p.photo, ...patch } } : p)));
  }, []);

  const attemptPhoto = useCallback(
    (tempId: string): Promise<SendMessageResult> => {
      const running = photoInFlightRef.current.get(tempId);
      if (running) return running;
      const run = async (): Promise<SendMessageResult> => {
        const job = photoJobsRef.current.get(tempId);
        if (!job || !selfId || job.generation !== generationRef.current) return "failed";
        const fail = (failure: ImageSendFailure): SendMessageResult => {
          if (job.generation === generationRef.current) patchPhoto(tempId, { state: "failed", failure });
          return failure === "objectionable" ? "objectionable" : "failed";
        };
        if (!canMessage(job.otherId)) return fail("rejected");
        if (!job.conversationId) {
          const { data: convId, error: convErr } = await supabase.rpc("get_or_create_dm_conversation", { p_other_user_id: job.otherId });
          if (convErr || !convId) {
            console.error("GolfMe: failed to open conversation.", convErr);
            return fail("network");
          }
          job.conversationId = convId as string;
          setPendingMessages((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, conversation_id: convId as string } : p)));
        }
        if (job.media) {
          // A video / album: every item stored (photos uploaded, videos
          // uploaded + transcoded), then ONE row carrying them all.
          const items = job.media;
          const prefix = mediaPrefix("dm", job.conversationId, job.messageId);
          if (!job.uploaded) {
            const stored = await storeMediaItems(items, { scope: "dm", scopeId: job.conversationId, messageId: job.messageId, userId: selfId }, () => {
              if (job.generation === generationRef.current) {
                patchPhoto(tempId, { media: outgoingItems(items), progress: items.reduce((s, it) => s + (it.done ? 1 : it.progress), 0) / items.length });
              }
            });
            if (stored !== "uploaded") return fail(stored);
            job.uploaded = true;
          }
          const finalKinds = sentMediaItems(items);
          patchPhoto(tempId, {
            uploaded: true,
            path: prefix,
            progress: 1,
            media: outgoingItems(items),
            mediaKinds: finalKinds.map((k) => ({ kind: k.kind, width: k.width, height: k.height, durationMs: k.durationMs ?? 0, thumb: k.thumb ?? null })),
          });
          const row = { id: job.messageId, conversation_id: job.conversationId, sender_id: selfId, text: job.text, media: mediaRowValue(prefix, finalKinds) };
          const insert = (values: Record<string, unknown>) => supabase.from("messages").insert(values).select("id").maybeSingle();
          let { error } = await insert(job.replyTo ? { ...row, reply_to_message_id: job.replyTo } : row);
          if (error && job.replyTo && isMissingReplyColumnError(error)) {
            setReplyColumnMissing(true);
            job.replyTo = null;
            setPendingMessages((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, reply_to_message_id: null } : p)));
            ({ error } = await insert(row));
          }
          if (error) {
            if (isMissingMediaSupportError(error)) {
              setMediaColumnMissing(true);
              return fail("rejected");
            }
            const outcome = classifyImageInsertError(error);
            if (outcome !== "sent") {
              console.error("GolfMe: failed to send a video / album message.", error);
              return fail(outcome);
            }
          }
          if (job.generation !== generationRef.current) return "sent";
          keepLocalMediaCopies(items, prefix);
          photoJobsRef.current.delete(tempId);
          patchPhoto(tempId, { path: prefix, progress: 1, failure: undefined }, { sent: true, serverId: job.messageId });
          return "sent";
        }
        const path = jobPath(job);
        if (!job.uploaded) {
          let shown = -1;
          const uploaded = await uploadChatImage(
            path,
            job.blob,
            (fraction) => {
              const step = progressStep(fraction);
              if (step !== shown) {
                shown = step;
                patchPhoto(tempId, { progress: step });
              }
            },
            undefined,
            job.audio ? voiceFileType(job.audio.mime).contentType : "image/jpeg",
          );
          if (uploaded !== "uploaded") return fail(uploaded);
          job.uploaded = true;
          patchPhoto(tempId, { uploaded: true, path, progress: 1 });
        }
        const media = job.audio
          ? voiceRowColumns({ path, durationMs: job.audio.durationMs })
          : imageRowColumns({ path, width: job.width, height: job.height, thumb: job.thumb });
        const row = { id: job.messageId, conversation_id: job.conversationId, sender_id: selfId, text: job.text, ...media };
        const insert = (values: Record<string, unknown>) => supabase.from("messages").insert(values).select("id").maybeSingle();
        let { error } = await insert(job.replyTo ? { ...row, reply_to_message_id: job.replyTo } : row);
        if (error && job.replyTo && isMissingReplyColumnError(error)) {
          setReplyColumnMissing(true);
          job.replyTo = null;
          setPendingMessages((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, reply_to_message_id: null } : p)));
          ({ error } = await insert(row));
        }
        if (error) {
          if (job.audio ? isMissingVoiceSupportError(error) : isMissingImageSupportError(error)) {
            // The columns aren't there after all (rolled back / stale
            // schema cache): hide the button; this one can only be discarded.
            if (job.audio) setVoiceColumnMissing(true);
            else setImageColumnMissing(true);
            return fail("rejected");
          }
          const outcome = classifyImageInsertError(error);
          if (outcome !== "sent") {
            console.error("GolfMe: failed to send photo message.", error);
            return fail(outcome);
          }
          // 23505: an earlier attempt's insert landed; it is sent.
        }
        if (job.generation !== generationRef.current) return "sent";
        // Shown from this device's own copy from now on (never re-downloaded).
        chatImageUrls().setLocal(path, job.localUrl);
        photoJobsRef.current.delete(tempId);
        patchPhoto(tempId, { path, progress: 1, failure: undefined }, { sent: true, serverId: job.messageId });
        return "sent";
      };
      const promise = run().finally(() => photoInFlightRef.current.delete(tempId));
      photoInFlightRef.current.set(tempId, promise);
      return promise;
    },
    [selfId, canMessage, patchPhoto],
  );

  const sendDirectImage = useCallback(
    async (otherId: string, photo: ProcessedChatImage, text: string, replyToId?: string): Promise<SendMessageResult> => {
      if (!selfId) return "failed";
      const messageId = crypto.randomUUID();
      const tempId = `temp-${messageId}`;
      const trimmed = text.trim();
      const replyTo = replyToId && repliesSupported ? replyToId : null;
      const conversationId = conversationIdWith(otherId) ?? null;
      photoJobsRef.current.set(tempId, {
        otherId,
        conversationId,
        messageId,
        blob: photo.blob,
        localUrl: photo.previewUrl,
        width: photo.width,
        height: photo.height,
        thumb: photo.thumb,
        text: trimmed,
        replyTo,
        uploaded: false,
        generation: generationRef.current,
      });
      setPendingMessages((prev) => [
        ...prev,
        {
          tempId,
          conversation_id: conversationId ?? "",
          otherId,
          sender_id: selfId,
          text: trimmed,
          created_at: new Date().toISOString(),
          reply_to_message_id: replyTo,
          photo: { messageId, blob: photo.blob, localUrl: photo.previewUrl, width: photo.width, height: photo.height, thumb: photo.thumb, state: "sending", progress: 0, uploaded: false },
        },
      ]);
      return attemptPhoto(tempId);
    },
    [selfId, repliesSupported, conversationIdWith, attemptPhoto],
  );

  const retryDirectImage = useCallback(
    async (tempId: string): Promise<SendMessageResult> => {
      if (!photoJobsRef.current.has(tempId)) return "failed";
      if (!photoInFlightRef.current.has(tempId)) patchPhoto(tempId, { state: "sending", failure: undefined });
      return attemptPhoto(tempId);
    },
    [attemptPhoto, patchPhoto],
  );

  const discardDirectImage = useCallback((tempId: string) => {
    const job = photoJobsRef.current.get(tempId);
    photoJobsRef.current.delete(tempId);
    setPendingMessages((prev) => prev.filter((p) => p.tempId !== tempId));
    if (!job) return;
    if (job.media) {
      // Items already stored (and staged originals) are removed; the
      // bucket's delete policy refuses if a row points at them after all.
      if (job.conversationId && selfId) void removeUnsentMedia(job.media, { scope: "dm", scopeId: job.conversationId, messageId: job.messageId, userId: selfId });
      for (const it of job.media) {
        URL.revokeObjectURL(it.localUrl);
        if (it.posterUrl) URL.revokeObjectURL(it.posterUrl);
      }
      return;
    }
    // Uploaded but never stored: remove the orphan (the bucket's delete
    // policy refuses if a row does point at it after all).
    if (job.uploaded && job.conversationId) void removeChatImage(jobPath(job));
    URL.revokeObjectURL(job.localUrl);
  }, [selfId]);

  // ---- Videos and albums (lib/chatMedia.ts, migration 20261107220000) ----
  const mediaSupported = useMemo(
    () => !mediaColumnMissing && (mediaProbe === "yes" || rowsHaveMediaColumn(messages)),
    [mediaColumnMissing, mediaProbe, messages],
  );
  const sendDirectMedia = useCallback(
    async (otherId: string, draft: ChatMediaDraftItem[], text: string, replyToId?: string): Promise<SendMessageResult> => {
      if (!selfId || draft.length === 0) return "failed";
      const messageId = crypto.randomUUID();
      const tempId = `temp-${messageId}`;
      const replyTo = replyToId && repliesSupported ? replyToId : null;
      const conversationId = conversationIdWith(otherId) ?? null;
      const items = toMediaSendItems(draft);
      const kinds = items.map((it) => ({ kind: it.kind, width: it.width, height: it.height, durationMs: it.durationMs, thumb: it.thumb }));
      photoJobsRef.current.set(tempId, {
        otherId,
        conversationId,
        messageId,
        blob: items[0].blob,
        localUrl: items[0].localUrl,
        width: items[0].width,
        height: items[0].height,
        thumb: null,
        text: text.trim(),
        replyTo,
        uploaded: false,
        generation: generationRef.current,
        media: items,
      });
      setPendingMessages((prev) => [
        ...prev,
        {
          tempId,
          conversation_id: conversationId ?? "",
          otherId,
          sender_id: selfId,
          text: text.trim(),
          created_at: new Date().toISOString(),
          reply_to_message_id: replyTo,
          photo: {
            messageId,
            blob: items[0].blob,
            localUrl: items[0].localUrl,
            width: items[0].width,
            height: items[0].height,
            thumb: null,
            state: "sending",
            progress: 0,
            uploaded: false,
            media: outgoingItems(items),
            mediaKinds: kinds,
          },
        },
      ]);
      return attemptPhoto(tempId);
    },
    [selfId, repliesSupported, conversationIdWith, attemptPhoto],
  );

  // ---- Voice messages (lib/chatVoice.ts, migration 20261107180000) ----
  // Same send path as photos (upload first, then the row with that id;
  // Not sent · Retry / Discard through retryDirectImage / discardDirectImage).
  const voiceSupported = useMemo(
    () => !voiceColumnMissing && (voiceProbe === "yes" || rowsHaveVoiceColumn(messages)),
    [voiceColumnMissing, voiceProbe, messages],
  );
  const sendDirectVoice = useCallback(
    async (otherId: string, clip: VoiceClip, replyToId?: string): Promise<SendMessageResult> => {
      if (!selfId) return "failed";
      const messageId = crypto.randomUUID();
      const tempId = `temp-${messageId}`;
      const replyTo = replyToId && repliesSupported ? replyToId : null;
      const conversationId = conversationIdWith(otherId) ?? null;
      const audio = { durationMs: clip.durationMs, mime: clip.mime };
      photoJobsRef.current.set(tempId, {
        otherId,
        conversationId,
        messageId,
        blob: clip.blob,
        localUrl: clip.localUrl,
        width: 0,
        height: 0,
        thumb: null,
        text: "",
        replyTo,
        uploaded: false,
        generation: generationRef.current,
        audio,
      });
      setPendingMessages((prev) => [
        ...prev,
        {
          tempId,
          conversation_id: conversationId ?? "",
          otherId,
          sender_id: selfId,
          text: "",
          created_at: new Date().toISOString(),
          reply_to_message_id: replyTo,
          photo: { messageId, blob: clip.blob, localUrl: clip.localUrl, width: 0, height: 0, thumb: null, state: "sending", progress: 0, uploaded: false, audio },
        },
      ]);
      return attemptPhoto(tempId);
    },
    [selfId, repliesSupported, conversationIdWith, attemptPhoto],
  );

  // Optimistic: the pill shows the latest tap now. Writes go through
  // reactionWrites (one in flight per message, the latest tap queued, no
  // duplicate writes), so a quick A-then-B can't end as A on the server.
  // false = this tap was my latest intent and the write carrying it failed
  // or timed out (any error, including the database's uniform
  // reaction_not_allowed), so the page shows its toast; a failed tap that a
  // newer tap superseded stays quiet.
  // When nothing is pending any more the pill settles on what the server
  // confirmed (a rollback only if no newer tap exists) and a fetch
  // reconciles.
  const setMessageReaction = useCallback(
    async (messageId: string, emoji: QuickReaction | null): Promise<boolean> => {
      if (!selfId || reactionsSupportRef.current !== "yes") return false;
      const message = messagesRef.current.find((m) => m.id === messageId);
      if (!message || message.unsent_at) return false;
      const generation = generationRef.current;
      // This account's ordering state, captured now: a queued write that
      // runs after an account switch still uses (and updates) the old one.
      const ordering = reactionOrderingRef.current;
      const transport: ReactionTransport = {
        upsert: async (row, signal) =>
          (await supabase.from("message_reactions").upsert(row, { onConflict: "message_id,user_id" }).abortSignal(signal)).error,
        remove: async (id, signal) =>
          (await supabase.from("message_reactions").delete().eq("message_id", id).eq("user_id", selfId).abortSignal(signal)).error,
      };
      const done = reactionWrites.set(messageId, emoji, {
        // Ignored while a write for this message is pending; otherwise the
        // shown state is the last fetched (server) state.
        saved: myReaction(reactionsRef.current, messageId, selfId),
        // Bounded by the queue (REACTION_WRITE_TIMEOUT_MS): `signal` aborts
        // the request on timeout or account switch. Sequenced (a removal is
        // a tombstone), with one fallback to the old upsert/DELETE when the
        // ordering migration isn't applied (lib/reactionOrder.ts).
        write: async (id, next, signal) => {
          const error = await sendReactionWrite({ transport, clock: reactionSeqClock, ordering, userId: selfId, now: Date.now }, id, next, signal);
          if (error && !signal.aborted) {
            console.error("GolfMe: failed to update message reaction.", error);
            if (generationRef.current === generation && isMissingReactionsTableError(error)) {
              reactionsSupportRef.current = "no";
              setReactionsSupport("no");
            }
          }
          return error;
        },
        // Settles on the last confirmed state, then refetches. After a
        // timeout (`uncertain`) the server may have applied the write
        // anyway: the refetch's rows replace this rollback, so the pill ends
        // on what the server really holds, not on an assumption.
        onSettled: (id, saved) => {
          if (generationRef.current !== generation) return;
          applyReactions(withReaction(reactionsRef.current, id, selfId, saved));
          void fetchReactions(conversationIdsRef.current);
        },
        onLateSuccess: () => {
          if (generationRef.current !== generation) return;
          void fetchReactions(conversationIdsRef.current);
        },
      });
      applyReactions(withReaction(reactionsRef.current, messageId, selfId, emoji));
      return done;
    },
    [selfId, applyReactions, fetchReactions, reactionWrites, reactionSeqClock],
  );

  const markConversationRead = useCallback(
    async (otherId: string) => {
      if (!selfId) return;
      const convId = conversationIdWith(otherId);
      if (!convId) return;
      // Defense in depth against any caller that ends up invoking this
      // repeatedly in a tight loop (e.g. an effect re-firing because this
      // function's own identity changed) — skipping a call this soon after
      // the last successful one for the same conversation is always safe
      // (last_read_at a couple seconds stale is never wrong in a way that
      // matters) and turns a potential request storm into a no-op.
      const lastMarked = recentlyMarkedReadRef.current.get(convId);
      if (lastMarked && Date.now() - lastMarked < 2000) return;
      recentlyMarkedReadRef.current.set(convId, Date.now());
      const { error } = await supabase
        .from("conversation_participants")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", convId)
        .eq("user_id", selfId);
      if (error) console.error("GolfMe: failed to mark conversation read.", error);
      else await refetch();
    },
    [selfId, conversationIdWith, refetch],
  );

  // "Clear for me" — messages up to now become invisible to the caller
  // only, enforced by the messages_select_participant RLS policy (which
  // compares each row's created_at against the caller's own
  // cleared_before), not just filtered client-side. The other participant
  // is untouched: their own cleared_before stays whatever it was.
  const clearChatHistory = useCallback(
    async (otherId: string) => {
      if (!selfId) return;
      const convId = conversationIdWith(otherId);
      if (!convId) return;
      const { error } = await supabase
        .from("conversation_participants")
        .update({ cleared_before: new Date().toISOString() })
        .eq("conversation_id", convId)
        .eq("user_id", selfId);
      if (error) throw new Error(error.message);
      await refetch();
    },
    [selfId, conversationIdWith, refetch],
  );

  // Removes the conversation from the caller's own inbox only — never
  // deletes messages, never affects the other participant. See
  // dmConversations below for the "reappears once a newer message
  // arrives" half of this.
  const deleteConversation = useCallback(
    async (otherId: string) => {
      if (!selfId) return;
      const convId = conversationIdWith(otherId);
      if (!convId) return;
      const { error } = await supabase
        .from("conversation_participants")
        .update({ hidden_at: new Date().toISOString() })
        .eq("conversation_id", convId)
        .eq("user_id", selfId);
      if (error) throw new Error(error.message);
      await refetch();
    },
    [selfId, conversationIdWith, refetch],
  );

  const dmConversations = useMemo<DmConversation[]>(() => {
    if (!selfId) return [];
    const myConvIds = new Set(participants.filter((p) => p.user_id === selfId).map((p) => p.conversation_id));
    const byConv = new Map<string, MessageRow[]>();
    for (const m of messages) {
      if (!myConvIds.has(m.conversation_id)) continue;
      const list = byConv.get(m.conversation_id);
      if (list) list.push(m);
      else byConv.set(m.conversation_id, [m]);
    }
    // Pending messages update an EXISTING conversation's preview instantly.
    // A brand-new conversation's very first message can't appear in this
    // list yet regardless -- conversation_participants hasn't been fetched
    // for it, so there's no otherGolfer/otherParticipant to build a
    // DmConversation row from until the next refetch.
    for (const p of visiblePending) {
      if (!myConvIds.has(p.conversation_id)) continue;
      const row: MessageRow = {
        id: p.serverId ?? p.tempId,
        conversation_id: p.conversation_id,
        sender_id: p.sender_id,
        text: p.text,
        created_at: p.created_at,
        reply_to_message_id: p.reply_to_message_id,
      };
      const list = byConv.get(p.conversation_id);
      if (list) list.push(row);
      else byConv.set(p.conversation_id, [row]);
    }
    const result: DmConversation[] = [];
    for (const [conversationId, msgs] of byConv) {
      const otherParticipant = participants.find((p) => p.conversation_id === conversationId && p.user_id !== selfId);
      if (!otherParticipant) continue;
      if (blockedIds.includes(otherParticipant.user_id) || blockedByIds.includes(otherParticipant.user_id)) continue;
      const otherGolfer = profilesById.get(otherParticipant.user_id);
      if (!otherGolfer) continue;
      const sorted = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const lastMessageRow = sorted[sorted.length - 1];
      const myParticipation = participants.find((p) => p.conversation_id === conversationId && p.user_id === selfId);
      // "Delete Conversation" (hidden_at) only hides the inbox row — it
      // naturally reappears the moment a message newer than hidden_at
      // shows up, rather than needing an explicit "undelete" action.
      if (myParticipation?.hidden_at && lastMessageRow.created_at <= myParticipation.hidden_at) continue;
      const unread = lastMessageRow.sender_id !== selfId && (!myParticipation?.last_read_at || myParticipation.last_read_at < lastMessageRow.created_at);
      result.push({ conversationId, otherGolfer, lastMessage: messageRowToDirectMessage(lastMessageRow), unread });
    }
    return result.sort((a, b) => b.lastMessage.createdAt.localeCompare(a.lastMessage.createdAt));
  }, [participants, messages, visiblePending, profilesById, selfId, blockedIds, blockedByIds]);

  const hasUnreadMessages = useMemo(() => dmConversations.some((c) => c.unread), [dmConversations]);

  const discoverableGolfers = useMemo(
    () => discoverableCandidates(directoryIds, profileCache, selfId, new Set([...blockedIds, ...blockedByIds])),
    [directoryIds, profileCache, selfId, blockedIds, blockedByIds],
  );
  // Any profile this client already holds (directory + connected people),
  // for resolving a known id -- never a list to browse.
  const getKnownProfile = useCallback((id: string) => profileCache.get(id), [profileCache]);
  // Every block this account made, named where allowed (lib/blockedContacts):
  // server blocked-names first, then anything already cached.
  const blockedContacts = useMemo(
    () => blockedContactRows(blockedIds, new Set(blockedByIds), [(id) => blockedNames.get(id), (id) => profileCache.get(id)]),
    [blockedIds, blockedByIds, blockedNames, profileCache],
  );

  const reportUser = useCallback(
    async (reportedId: string, category: ReportCategory, details: string, context: Report["context"], meta?: ReportTarget) => {
      // Never a silent "success": the report form waits for this answer.
      if (!selfId) throw new Error("You need to be signed in to report.");
      const input = { reporterId: selfId, reportedUserId: reportedId, category, details, context, ...meta };
      let { error } = await supabase.from("reports").insert(reportRow(input, true));
      // Database without the post/comment columns yet (see lib/reportRow).
      if (error && isMissingColumnError(error)) ({ error } = await supabase.from("reports").insert(reportRow(input, false)));
      if (error) throw new Error(error.message);
    },
    [selfId],
  );

  const notifications = useMemo(
    () => withLocallyRead(notificationRows.map(notificationRowToAppNotification), locallyReadIds),
    [notificationRows, locallyReadIds],
  );
  const unreadNotificationCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;

  const setLocallyRead = useCallback((ids: readonly string[], read: boolean) => {
    const next = new Set(locallyReadRef.current);
    for (const id of ids) {
      if (read) next.add(id);
      else next.delete(id);
    }
    locallyReadRef.current = next;
    setLocallyReadIds(next);
  }, []);

  // One request per call however many ids (chunked only to keep the URL
  // short; the window is 200 rows). notifications_update_own already
  // limits it to this account's rows; read = false skips rows another
  // device already marked, so their read_at isn't moved.
  const markNotificationsRead = useCallback(
    async (ids: readonly string[]) => {
      if (!selfId) return;
      const fresh = [...new Set(ids)].filter((id) => !locallyReadRef.current.has(id));
      if (fresh.length === 0) return;
      const generation = generationRef.current;
      setLocallyRead(fresh, true);
      const readAt = new Date().toISOString();
      const failed: string[] = [];
      for (let i = 0; i < fresh.length; i += 100) {
        const part = fresh.slice(i, i + 100);
        const { error } = await supabase
          .from("notifications")
          .update({ read: true, read_at: readAt })
          .eq("user_id", selfId)
          .eq("read", false)
          .in("id", part);
        if (error) {
          console.error("GolfMe: failed to mark notifications read.", error);
          failed.push(...part);
        }
      }
      if (generationRef.current !== generation) return;
      if (failed.length > 0) setLocallyRead(failed, false);
      if (failed.length < fresh.length) await refetch();
    },
    [selfId, setLocallyRead, refetch],
  );

  const markNotificationRead = useCallback((id: string) => markNotificationsRead([id]), [markNotificationsRead]);

  const markAllNotificationsRead = useCallback(async () => {
    if (!selfId) return;
    const generation = generationRef.current;
    // Shown read at once; the update itself covers every unread row,
    // including any outside the fetched window.
    const shown = notificationsRef.current.filter((n) => !n.read).map((n) => n.id);
    setLocallyRead(shown, true);
    const { error } = await supabase
      .from("notifications")
      .update({ read: true, read_at: new Date().toISOString() })
      .eq("user_id", selfId)
      .eq("read", false);
    if (generationRef.current !== generation) return;
    if (error) {
      console.error("GolfMe: failed to mark all notifications read.", error);
      setLocallyRead(shown, false);
    } else await refetch();
  }, [selfId, setLocallyRead, refetch]);

  // Memoized so an unchanged refetch (every piece of state kept by
  // reference, see keepIfSame) doesn't re-render every consumer.
  const value = useMemo<RealSocialContextValue>(
    () => ({
      profilesById,
      messageHistoryCut: !isDemo && messageHistoryCut,
      isLoading,
      hasLoaded: isDemo || loadStatus.settled,
      loadError: !isDemo && isFirstLoadError(loadStatus),
      refreshFailed: !isDemo && isRefreshError(loadStatus),
      retry,
      discoverableGolfers,
      getKnownProfile,
      blockedContacts,
      canMessage,
      isBlocked,
      isBlockedBy,
      blockedIds,
      blockUser,
      unblockUser,
      isFollowing,
      followingGolfers,
      getFollowerCount,
      getProfileFollowers,
      followUser,
      unfollowUser,
      dmConversations,
      hasUnreadMessages,
      messagesWithGolfer,
      sendDirectMessage,
      repliesSupported,
      unsendSupported,
      unsendDirectMessage,
      editSupported,
      editDirectMessage,
      imagesSupported,
      sendDirectImage,
      retryDirectImage,
      discardDirectImage,
      voiceSupported,
      sendDirectVoice,
      mediaSupported,
      sendDirectMedia,
      reactionsSupported: reactionsLive,
      messageReactions: reactions,
      setMessageReaction,
      markConversationRead,
      clearChatHistory,
      deleteConversation,
      isOtherTyping,
      typingConversationIds,
      sendTypingSignal,
      reportUser,
      notifications,
      unreadNotificationCount,
      markNotificationRead,
      markNotificationsRead,
      markAllNotificationsRead,
    }),
    [
      profilesById,
      messageHistoryCut,
      isLoading,
      isDemo,
      loadStatus,
      retry,
      discoverableGolfers,
      getKnownProfile,
      blockedContacts,
      canMessage,
      isBlocked,
      isBlockedBy,
      blockedIds,
      blockUser,
      unblockUser,
      isFollowing,
      followingGolfers,
      getFollowerCount,
      getProfileFollowers,
      followUser,
      unfollowUser,
      dmConversations,
      hasUnreadMessages,
      messagesWithGolfer,
      sendDirectMessage,
      repliesSupported,
      unsendSupported,
      unsendDirectMessage,
      editSupported,
      editDirectMessage,
      imagesSupported,
      sendDirectImage,
      retryDirectImage,
      discardDirectImage,
      voiceSupported,
      sendDirectVoice,
      mediaSupported,
      sendDirectMedia,
      reactionsLive,
      reactions,
      setMessageReaction,
      markConversationRead,
      clearChatHistory,
      deleteConversation,
      isOtherTyping,
      typingConversationIds,
      sendTypingSignal,
      reportUser,
      notifications,
      unreadNotificationCount,
      markNotificationRead,
      markNotificationsRead,
      markAllNotificationsRead,
    ],
  );

  return <RealSocialContext.Provider value={value}>{children}</RealSocialContext.Provider>;
}

export function useRealSocial(): RealSocialContextValue {
  const ctx = useContext(RealSocialContext);
  if (!ctx) throw new Error("useRealSocial must be used within a RealSocialProvider");
  return ctx;
}

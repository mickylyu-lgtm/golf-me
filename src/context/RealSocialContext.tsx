import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import { profileRowToGolferProfile } from "../lib/profile";
import type { ProfileRow } from "../lib/profile";
import type { GolferProfile, AppNotification, DirectMessage, NotificationType, ReportCategory, Report } from "../types";
import type { DmConversation } from "./DataContext";

interface ConversationParticipantRow {
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
  cleared_before: string | null;
  hidden_at: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  created_at: string;
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
  isLoading: boolean;
  // Every other real profile (minus self, minus blocked either direction) —
  // the real-mode data source for Discover/Find, distinct from profilesById
  // above (which only ever holds people already connected via a round/DM/
  // notification, not a broad discovery list).
  discoverableGolfers: GolferProfile[];

  canMessage: (otherId: string) => boolean;
  isBlocked: (id: string) => boolean;
  isBlockedBy: (id: string) => boolean;
  blockedIds: string[];
  blockUser: (id: string) => Promise<void>;
  unblockUser: (id: string) => Promise<void>;

  isFollowing: (id: string) => boolean;
  followingGolfers: GolferProfile[];
  followUser: (id: string) => Promise<void>;
  unfollowUser: (id: string) => Promise<void>;

  dmConversations: DmConversation[];
  hasUnreadMessages: boolean;
  messagesWithGolfer: (otherId: string) => DirectMessage[];
  sendDirectMessage: (otherId: string, text: string) => Promise<boolean>;
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
    meta?: { golfCallId?: string },
  ) => Promise<void>;

  notifications: AppNotification[];
  unreadNotificationCount: number;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
}

const RealSocialContext = createContext<RealSocialContextValue | null>(null);

function messageRowToDirectMessage(row: MessageRow): DirectMessage {
  return { id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, text: row.text, createdAt: row.created_at };
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

export function RealSocialProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser } = useAuth();
  const [participants, setParticipants] = useState<ConversationParticipantRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [follows, setFollows] = useState<FollowRow[]>([]);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [notificationRows, setNotificationRows] = useState<NotificationRow[]>([]);
  // Every real profile this client knows about: the discovery directory
  // (refreshed on full refetches) plus any profile a conversation,
  // notification or follow needed before the next directory refresh.
  const [profileCache, setProfileCache] = useState<Map<string, GolferProfile>>(new Map());
  // Ids of people this user is connected to (conversation participants,
  // notification actors) -- profilesById is exactly these, as before.
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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
        // Discover/Find's real-mode candidate pool — every registered real
        // golfer, RLS already allows any authenticated user to read every
        // profile row (mirrors the old mock world's fully-open
        // visibleGolfers()). Self/blocked filtering happens in the
        // discoverableGolfers memo below, not here. Only on full refetches:
        // it used to be re-downloaded on every poll tick and every realtime
        // event.
        // Promise.resolve() starts the (lazy) query now, in parallel with
        // the batch below, rather than only when it is awaited.
        const directoryPromise = full ? Promise.resolve(supabase.from("profiles").select("*")) : null;
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
        let directoryRows: ProfileRow[] | null = null;
        if (directoryPromise) {
          const { data, error } = await directoryPromise;
          if (error) throw error;
          directoryRows = (data ?? []) as ProfileRow[];
        }
        if (!isCurrent()) return;

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
            : supabase.from("messages").select("*").in("conversation_id", conversationIds).order("created_at", { ascending: false }).limit(MESSAGE_WINDOW);
          const [{ data: allParticipants, error: pErr }, { data: messageRows, error: mErr }] = await Promise.all([participantsQuery, messagesQuery]);
          if (pErr) throw pErr;
          if (mErr) throw mErr;
          if (!isCurrent()) return;
          nextParticipants = (allParticipants ?? []) as ConversationParticipantRow[];
          const fetched = (messageRows ?? []) as MessageRow[];
          if (incremental) {
            const known = new Set(messagesRef.current.map((m) => m.id));
            const added = fetched.filter((m) => !known.has(m.id));
            nextMessages =
              added.length === 0 ? messagesRef.current : [...messagesRef.current, ...added].sort((a, b) => a.created_at.localeCompare(b.created_at));
          } else {
            nextMessages = keepIfSame(messagesRef.current, fetched.reverse());
          }
        }
        setParticipants((prev) => keepIfSame(prev, nextParticipants));
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        convKeyRef.current = convKey;
        clearedKeyRef.current = clearedKey;

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
        if (directoryRows) cache = new Map(directoryRows.map((row) => [row.id, profileRowToGolferProfile(row)]));
        const missing = [...needed].filter((id) => !cache.has(id));
        if (missing.length > 0) {
          const { data: profileRows, error: profErr } = await supabase.from("profiles").select("*").in("id", missing);
          if (profErr) throw profErr;
          if (!isCurrent()) return;
          cache = new Map(cache);
          for (const row of (profileRows ?? []) as ProfileRow[]) cache.set(row.id, profileRowToGolferProfile(row));
        }
        if (cache !== profileCacheRef.current) {
          profileCacheRef.current = cache;
          setProfileCache((prev) => (sameProfileMap(prev, cache) ? prev : cache));
        }
        setConnectedIds((prev) => keepIfSame(prev, [...connected].sort()));
        if (full) lastFullAtRef.current = Date.now();
      } catch (err) {
        // Retry the full reload next time rather than silently falling
        // back to incremental on a half-applied state.
        if (full) forceFullRef.current = true;
        console.error("GolfMe: failed to load messages/blocks/notifications.", err);
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
    [selfId],
  );

  useEffect(() => {
    // New account (or signed out / demo): nothing fetched so far applies.
    generationRef.current += 1;
    forceFullRef.current = true;
    lastFullAtRef.current = 0;
    messagesRef.current = [];
    profileCacheRef.current = new Map();
    convKeyRef.current = null;
    clearedKeyRef.current = null;
    realtimeHealthyRef.current = false;
    // A fetch from the previous account may still be "in flight"; its
    // results are discarded by the generation check, so don't let it
    // block this account's first fetch.
    fetchingRef.current = false;
    pendingRefetchRef.current = false;

    if (isDemo || !selfId) {
      setParticipants([]);
      setMessages([]);
      setBlocks([]);
      setNotificationRows([]);
      setProfileCache(new Map());
      setConnectedIds([]);
      setFollows([]);
      setPendingMessages([]);
      return;
    }

    setIsLoading(true);
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
      // new-messages fetch, so DELETE forces the full window.
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) =>
        refetch(payload.eventType === "DELETE" ? { full: true } : undefined),
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
  }, [isDemo, selfId, refetch]);

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
  // above brings in the real row it corresponds to -- matched by
  // conversation + sender + exact text, canonical row created no earlier
  // than the pending entry's own local timestamp. This is what prevents the
  // optimistic render and the realtime-delivered row from both staying on
  // screen as two separate bubbles.
  useEffect(() => {
    if (pendingMessages.length === 0) return;
    setPendingMessages((prevPending) =>
      prevPending.filter(
        (p) =>
          !messages.some(
            (m) => m.conversation_id === p.conversation_id && m.sender_id === p.sender_id && m.text === p.text && m.created_at >= p.created_at,
          ),
      ),
    );
  }, [messages, pendingMessages.length]);

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
      await refetch();
    },
    [selfId, refetch],
  );

  const unblockUser = useCallback(
    async (id: string) => {
      if (!selfId) return;
      const { error } = await supabase.from("blocks").delete().eq("blocker_id", selfId).eq("blocked_id", id);
      if (error) throw new Error(error.message);
      await refetch();
    },
    [selfId, refetch],
  );

  const followingIds = useMemo(() => (selfId ? follows.filter((f) => f.follower_id === selfId).map((f) => f.following_id) : []), [follows, selfId]);
  const isFollowing = useCallback((id: string) => followingIds.includes(id), [followingIds]);
  const followingGolfers = useMemo(() => followingIds.map((id) => allProfiles.find((g) => g.id === id)).filter((g): g is GolferProfile => Boolean(g)), [followingIds, allProfiles]);

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
      const pending = pendingMessages
        .filter((p) => p.otherId === otherId)
        .map((p): MessageRow => ({ id: p.tempId, conversation_id: p.conversation_id, sender_id: p.sender_id, text: p.text, created_at: p.created_at }));
      return [...canonical, ...pending].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(messageRowToDirectMessage);
    },
    [conversationIdWith, messages, pendingMessages],
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

  const sendDirectMessage = useCallback(
    async (otherId: string, text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || !selfId || !canMessage(otherId)) return false;
      const { data: convId, error: convErr } = await supabase.rpc("get_or_create_dm_conversation", { p_other_user_id: otherId });
      if (convErr) {
        console.error("GolfMe: failed to open conversation.", convErr);
        return false;
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
      setPendingMessages((prev) => [...prev, { tempId, conversation_id: convId, otherId, sender_id: selfId, text: trimmed, created_at: optimisticCreatedAt }]);

      const { error } = await supabase.from("messages").insert({ conversation_id: convId, sender_id: selfId, text: trimmed });
      if (error) {
        console.error("GolfMe: failed to send message.", error);
        setPendingMessages((prev) => prev.filter((p) => p.tempId !== tempId));
        return false;
      }
      return true;
    },
    [selfId, canMessage],
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
    for (const p of pendingMessages) {
      if (!myConvIds.has(p.conversation_id)) continue;
      const row: MessageRow = { id: p.tempId, conversation_id: p.conversation_id, sender_id: p.sender_id, text: p.text, created_at: p.created_at };
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
  }, [participants, messages, pendingMessages, profilesById, selfId, blockedIds, blockedByIds]);

  const hasUnreadMessages = useMemo(() => dmConversations.some((c) => c.unread), [dmConversations]);

  const discoverableGolfers = useMemo(
    () => allProfiles.filter((g) => g.id !== selfId && !blockedIds.includes(g.id) && !blockedByIds.includes(g.id)),
    [allProfiles, selfId, blockedIds, blockedByIds],
  );

  const reportUser = useCallback(
    async (reportedId: string, category: ReportCategory, details: string, context: Report["context"], meta?: { golfCallId?: string }) => {
      if (!selfId) return;
      const { error } = await supabase.from("reports").insert({
        reporter_id: selfId,
        reported_user_id: reportedId,
        round_id: meta?.golfCallId ?? null,
        category,
        details,
        context,
      });
      if (error) throw new Error(error.message);
    },
    [selfId],
  );

  const notifications = useMemo(() => notificationRows.map(notificationRowToAppNotification), [notificationRows]);
  const unreadNotificationCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const markNotificationRead = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("notifications").update({ read: true, read_at: new Date().toISOString() }).eq("id", id);
      if (error) console.error("GolfMe: failed to mark notification read.", error);
      else await refetch();
    },
    [refetch],
  );

  const markAllNotificationsRead = useCallback(async () => {
    if (!selfId) return;
    const { error } = await supabase
      .from("notifications")
      .update({ read: true, read_at: new Date().toISOString() })
      .eq("user_id", selfId)
      .eq("read", false);
    if (error) console.error("GolfMe: failed to mark all notifications read.", error);
    else await refetch();
  }, [selfId, refetch]);

  // Memoized so an unchanged refetch (every piece of state kept by
  // reference, see keepIfSame) doesn't re-render every consumer.
  const value = useMemo<RealSocialContextValue>(
    () => ({
      profilesById,
      isLoading,
      discoverableGolfers,
      canMessage,
      isBlocked,
      isBlockedBy,
      blockedIds,
      blockUser,
      unblockUser,
      isFollowing,
      followingGolfers,
      followUser,
      unfollowUser,
      dmConversations,
      hasUnreadMessages,
      messagesWithGolfer,
      sendDirectMessage,
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
      markAllNotificationsRead,
    }),
    [
      profilesById,
      isLoading,
      discoverableGolfers,
      canMessage,
      isBlocked,
      isBlockedBy,
      blockedIds,
      blockUser,
      unblockUser,
      isFollowing,
      followingGolfers,
      followUser,
      unfollowUser,
      dmConversations,
      hasUnreadMessages,
      messagesWithGolfer,
      sendDirectMessage,
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

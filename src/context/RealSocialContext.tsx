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

export function RealSocialProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser } = useAuth();
  const [participants, setParticipants] = useState<ConversationParticipantRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [follows, setFollows] = useState<FollowRow[]>([]);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [notificationRows, setNotificationRows] = useState<NotificationRow[]>([]);
  const [profilesById, setProfilesById] = useState<Map<string, GolferProfile>>(new Map());
  const [allProfiles, setAllProfiles] = useState<GolferProfile[]>([]);
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
  const selfId = authUser?.id;

  const refetch = useCallback(async () => {
    if (!selfId) return;
    if (fetchingRef.current) {
      pendingRefetchRef.current = true;
      return;
    }
    fetchingRef.current = true;
    try {
      const [
        { data: myConvIds, error: convErr },
        { data: blockRows, error: blockErr },
        { data: notifRows, error: notifErr },
        { data: allProfileRows, error: allProfilesErr },
        { data: followRows, error: followErr },
      ] = await Promise.all([
        supabase.from("conversation_participants").select("conversation_id, user_id, last_read_at, cleared_before, hidden_at").eq("user_id", selfId),
        supabase.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${selfId},blocked_id.eq.${selfId}`),
        supabase.from("notifications").select("*").eq("user_id", selfId).order("created_at", { ascending: false }),
        // Discover/Find's real-mode candidate pool — every registered real
        // golfer, RLS already allows any authenticated user to read every
        // profile row (mirrors the old mock world's fully-open
        // visibleGolfers()). Self/blocked filtering happens in the
        // discoverableGolfers memo below, not here.
        supabase.from("profiles").select("*"),
        supabase.from("follows").select("follower_id, following_id").or(`follower_id.eq.${selfId},following_id.eq.${selfId}`),
      ]);
      if (convErr) throw convErr;
      if (blockErr) throw blockErr;
      if (notifErr) throw notifErr;
      if (allProfilesErr) throw allProfilesErr;
      if (followErr) throw followErr;

      setBlocks((blockRows ?? []) as BlockRow[]);
      setNotificationRows((notifRows ?? []) as NotificationRow[]);
      setAllProfiles(((allProfileRows ?? []) as ProfileRow[]).map(profileRowToGolferProfile));
      setFollows((followRows ?? []) as FollowRow[]);

      const conversationIds = [...new Set((myConvIds ?? []).map((r) => r.conversation_id))];
      if (conversationIds.length === 0) {
        setParticipants([]);
        setMessages([]);
        return;
      }

      const [{ data: allParticipants, error: pErr }, { data: allMessages, error: mErr }] = await Promise.all([
        supabase.from("conversation_participants").select("conversation_id, user_id, last_read_at, cleared_before, hidden_at").in("conversation_id", conversationIds),
        supabase.from("messages").select("*").in("conversation_id", conversationIds).order("created_at", { ascending: true }),
      ]);
      if (pErr) throw pErr;
      if (mErr) throw mErr;

      const nextParticipants = (allParticipants ?? []) as ConversationParticipantRow[];
      const nextMessages = (allMessages ?? []) as MessageRow[];
      setParticipants(nextParticipants);
      setMessages(nextMessages);

      const ids = new Set<string>();
      for (const p of nextParticipants) ids.add(p.user_id);
      for (const n of notifRows ?? []) if (n.actor_id) ids.add(n.actor_id);
      if (ids.size > 0) {
        const { data: profileRows, error: profErr } = await supabase.from("profiles").select("*").in("id", Array.from(ids));
        if (profErr) throw profErr;
        const map = new Map<string, GolferProfile>();
        for (const row of (profileRows ?? []) as ProfileRow[]) map.set(row.id, profileRowToGolferProfile(row));
        setProfilesById(map);
      } else {
        setProfilesById(new Map());
      }
    } catch (err) {
      console.error("Golf Me: failed to load messages/blocks/notifications.", err);
    } finally {
      fetchingRef.current = false;
      if (pendingRefetchRef.current) {
        pendingRefetchRef.current = false;
        refetch();
      }
    }
  }, [selfId]);

  useEffect(() => {
    if (isDemo || !selfId) {
      setParticipants([]);
      setMessages([]);
      setBlocks([]);
      setNotificationRows([]);
      setProfilesById(new Map());
      setAllProfiles([]);
      setFollows([]);
      setPendingMessages([]);
      return;
    }

    setIsLoading(true);
    refetch().finally(() => setIsLoading(false));

    const channel = supabase
      .channel("social-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "blocks" }, () => refetch())
      .subscribe();

    // Defense in depth against the realtime websocket silently dying —
    // known to happen on mobile browsers when the tab is backgrounded
    // (phone locked, app-switched away from) for a while, and Supabase's
    // own client doesn't always reliably reconnect + catch up on its own.
    // Without this, a message or notification that arrived while the
    // socket was dead would only ever show up once something else (like
    // manually opening the inbox, which does a real fetch) happened to
    // trigger a refetch — reads as "the live popup never fired" even
    // though the data was there all along. A refetch on regaining
    // visibility, plus a modest poll while actively visible, means the
    // user is never more than moments away from a fresh fetch either way.
    function onVisible() {
      if (document.visibilityState === "visible") refetch();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const pollInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") refetch();
    }, 6000);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(pollInterval);
    };
  }, [isDemo, selfId, refetch]);

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

  const sendDirectMessage = useCallback(
    async (otherId: string, text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || !selfId || !canMessage(otherId)) return false;
      const { data: convId, error: convErr } = await supabase.rpc("get_or_create_dm_conversation", { p_other_user_id: otherId });
      if (convErr) {
        console.error("Golf Me: failed to open conversation.", convErr);
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
        console.error("Golf Me: failed to send message.", error);
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
      if (error) console.error("Golf Me: failed to mark conversation read.", error);
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
      if (error) console.error("Golf Me: failed to mark notification read.", error);
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
    if (error) console.error("Golf Me: failed to mark all notifications read.", error);
    else await refetch();
  }, [selfId, refetch]);

  const value: RealSocialContextValue = {
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
    reportUser,
    notifications,
    unreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
  };

  return <RealSocialContext.Provider value={value}>{children}</RealSocialContext.Provider>;
}

export function useRealSocial(): RealSocialContextValue {
  const ctx = useContext(RealSocialContext);
  if (!ctx) throw new Error("useRealSocial must be used within a RealSocialProvider");
  return ctx;
}

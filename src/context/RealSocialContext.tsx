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
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  created_at: string;
}

interface BlockRow {
  blocker_id: string;
  blocked_id: string;
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  actor_id: string | null;
  text: string;
  link_to: string;
  read: boolean;
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

  dmConversations: DmConversation[];
  hasUnreadMessages: boolean;
  messagesWithGolfer: (otherId: string) => DirectMessage[];
  sendDirectMessage: (otherId: string, text: string) => Promise<boolean>;
  markConversationRead: (otherId: string) => Promise<void>;

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
    createdAt: row.created_at,
  };
}

export function RealSocialProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser } = useAuth();
  const [participants, setParticipants] = useState<ConversationParticipantRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [notificationRows, setNotificationRows] = useState<NotificationRow[]>([]);
  const [profilesById, setProfilesById] = useState<Map<string, GolferProfile>>(new Map());
  const [allProfiles, setAllProfiles] = useState<GolferProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fetchingRef = useRef(false);
  const selfId = authUser?.id;

  const refetch = useCallback(async () => {
    if (!selfId || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const [
        { data: myConvIds, error: convErr },
        { data: blockRows, error: blockErr },
        { data: notifRows, error: notifErr },
        { data: allProfileRows, error: allProfilesErr },
      ] = await Promise.all([
        supabase.from("conversation_participants").select("conversation_id, user_id, last_read_at").eq("user_id", selfId),
        supabase.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${selfId},blocked_id.eq.${selfId}`),
        supabase.from("notifications").select("*").eq("user_id", selfId).order("created_at", { ascending: false }),
        // Discover/Find's real-mode candidate pool — every registered real
        // golfer, RLS already allows any authenticated user to read every
        // profile row (mirrors the old mock world's fully-open
        // visibleGolfers()). Self/blocked filtering happens in the
        // discoverableGolfers memo below, not here.
        supabase.from("profiles").select("*"),
      ]);
      if (convErr) throw convErr;
      if (blockErr) throw blockErr;
      if (notifErr) throw notifErr;
      if (allProfilesErr) throw allProfilesErr;

      setBlocks((blockRows ?? []) as BlockRow[]);
      setNotificationRows((notifRows ?? []) as NotificationRow[]);
      setAllProfiles(((allProfileRows ?? []) as ProfileRow[]).map(profileRowToGolferProfile));

      const conversationIds = [...new Set((myConvIds ?? []).map((r) => r.conversation_id))];
      if (conversationIds.length === 0) {
        setParticipants([]);
        setMessages([]);
        return;
      }

      const [{ data: allParticipants, error: pErr }, { data: allMessages, error: mErr }] = await Promise.all([
        supabase.from("conversation_participants").select("conversation_id, user_id, last_read_at").in("conversation_id", conversationIds),
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

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isDemo, selfId, refetch]);

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
      if (!convId) return [];
      return messages.filter((m) => m.conversation_id === convId).map(messageRowToDirectMessage);
    },
    [conversationIdWith, messages],
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
      const { error } = await supabase.from("messages").insert({ conversation_id: convId, sender_id: selfId, text: trimmed });
      if (error) {
        console.error("Golf Me: failed to send message.", error);
        return false;
      }
      await refetch();
      return true;
    },
    [selfId, canMessage, refetch],
  );

  const markConversationRead = useCallback(
    async (otherId: string) => {
      if (!selfId) return;
      const convId = conversationIdWith(otherId);
      if (!convId) return;
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
      const unread = lastMessageRow.sender_id !== selfId && (!myParticipation?.last_read_at || myParticipation.last_read_at < lastMessageRow.created_at);
      result.push({ conversationId, otherGolfer, lastMessage: messageRowToDirectMessage(lastMessageRow), unread });
    }
    return result.sort((a, b) => b.lastMessage.createdAt.localeCompare(a.lastMessage.createdAt));
  }, [participants, messages, profilesById, selfId, blockedIds, blockedByIds]);

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
      const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
      if (error) console.error("Golf Me: failed to mark notification read.", error);
      else await refetch();
    },
    [refetch],
  );

  const markAllNotificationsRead = useCallback(async () => {
    if (!selfId) return;
    const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", selfId).eq("read", false);
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
    dmConversations,
    hasUnreadMessages,
    messagesWithGolfer,
    sendDirectMessage,
    markConversationRead,
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

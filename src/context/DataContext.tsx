import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  AgeRange,
  AppData,
  AppNotification,
  AvailabilitySlot,
  ChatMessage,
  CircleConnection,
  CommentVote,
  CommunityPost,
  DirectMessage,
  FollowConnection,
  GameFormat,
  GenderPreference,
  GolfCall,
  GolferProfile,
  HandicapAccuracy,
  Holes,
  JoinMode,
  NotificationType,
  PaceOfPlay,
  PostCategory,
  PostComment,
  PostType,
  PostVote,
  Report,
  ReportCategory,
  Review,
  RoundLengthPreference,
  SavedPost,
  SessionState,
  SkillFilter,
  GolfVibe,
  WalkOrCart,
} from "../types";
import { AGE_PREF_MAX, AGE_PREF_MIN } from "../types";
import { generateId } from "../lib/id";
import type { GeoPoint } from "../lib/geo";
import { loadData, saveData, resetToSeedData } from "../lib/storage";
import { avatarColorForName, initialsFromName } from "../lib/avatar";
import { dmConversationId, otherParticipant } from "../lib/dm";

export interface DmConversation {
  conversationId: string;
  otherGolfer: GolferProfile;
  lastMessage: DirectMessage;
  unread: boolean;
}

export interface CreateGolfCallInput {
  course: string;
  areaLabel: string;
  distanceMiles: number;
  dateISO: string;
  timeLabel: string;
  estimatedPricePerPerson: number;
  totalSpots: number;
  joinMode: JoinMode;
  skillLevel: SkillFilter;
  vibe: GolfVibe;
  walkOrCart: WalkOrCart;
  holes: Holes;
  gameFormat: GameFormat;
  notes?: string;
  // Friends already confirmed for the round when hosting via "Fill My
  // Foursome" — added to the roster alongside the host at creation time.
  additionalJoinedGolferIds?: string[];
}

export interface ReviewInput {
  showedUp: boolean;
  onTime: boolean;
  respectful: boolean;
  paceOfPlay: PaceOfPlay;
  wouldPlayAgain: boolean;
  handicapAccuracy: HandicapAccuracy;
  privateNote?: string;
}

export interface CreatePostInput {
  type: PostType;
  text: string;
  imageUrl?: string;
  courseTag?: string;
  golfCallId?: string;
  category: PostCategory;
}

export interface NewGolferInput {
  name: string;
  photoUrl?: string;
  ageRange: AgeRange;
  gender: string;
  areaLabel: string;
  playingAreaCoords?: GeoPoint;
  handicap: number | null;
  vibes: GolfVibe[];
  walkOrCart: WalkOrCart;
  budgetMin: number;
  budgetMax: number;
  favoriteCourses?: string[];
  // Onboarding no longer collects a full availability picker or partner-
  // matching preferences (age/gender range) — those are secondary signals
  // completed later from Profile > Match Preferences, so they're optional
  // here with the same "no preference" defaults everyone else starts with.
  availability?: AvailabilitySlot[];
  preferredCourses: string[];
  travelRadiusMiles: number;
  roundLengthPreference?: RoundLengthPreference;
  agePreferenceMin?: number;
  agePreferenceMax?: number;
  noAgePreference?: boolean;
  genderPreference?: GenderPreference;
}

interface DataContextValue {
  data: AppData;
  isLoading: boolean;
  currentUser: GolferProfile;
  golfers: GolferProfile[];
  golfCalls: GolfCall[];
  messages: ChatMessage[];
  reviews: Review[];
  reports: Report[];

  getGolfer: (id: string) => GolferProfile | undefined;
  getGolfCall: (id: string) => GolfCall | undefined;
  messagesForCall: (callId: string) => ChatMessage[];
  visibleGolfers: (excludeSelf?: boolean) => GolferProfile[];
  reviewsAbout: (golferId: string) => Review[];

  session: SessionState;
  logIn: (userId: string) => void;
  logOut: () => void;
  signUpNewGolfer: (input: NewGolferInput) => GolferProfile;

  switchCurrentUser: (id: string) => void;
  updateCurrentUserProfile: (patch: Partial<GolferProfile>) => void;
  setPhoneVerified: (value: boolean) => void;
  setEmailVerified: (value: boolean) => void;
  requestVerifiedGolfer: () => void;

  createGolfCall: (input: CreateGolfCallInput) => GolfCall;
  cancelGolfCall: (callId: string) => void;
  simulateCallCompletion: (callId: string) => void;
  joinGolfCall: (callId: string) => void;
  cancelJoinRequest: (callId: string) => void;
  leaveGolfCall: (callId: string) => void;
  approveRequest: (callId: string, golferId: string) => void;
  declineRequest: (callId: string, golferId: string) => void;

  sendMessage: (callId: string, text: string) => void;

  hasReviewed: (callId: string, revieweeId: string) => boolean;
  submitReview: (callId: string, revieweeId: string, input: ReviewInput) => void;

  reportUser: (
    reportedId: string,
    category: ReportCategory,
    details: string,
    context: Report["context"],
    meta?: { golfCallId?: string; postId?: string; commentId?: string },
  ) => void;
  blockUser: (blockedId: string) => void;
  unblockUser: (blockedId: string) => void;
  isBlocked: (id: string) => boolean;
  blockedIds: string[];

  circleGolfers: GolferProfile[];
  isInCircle: (golferId: string) => boolean;
  addToCircle: (memberId: string) => void;
  hasPlayedWith: (golferId: string) => boolean;
  playedWithIds: Set<string>;

  // Following: "interested in playing with / keeping tabs on" — distinct
  // from Golf Circle ("actually played with, would again"). Never
  // auto-syncs into Golf Circle.
  followingGolfers: GolferProfile[];
  isFollowing: (golferId: string) => boolean;
  followUser: (golferId: string) => void;
  unfollowUser: (golferId: string) => void;

  // Direct messages between two golfers, gated by canMessage().
  canMessage: (golferId: string) => boolean;
  dmConversations: DmConversation[];
  hasUnreadMessages: boolean;
  messagesWithGolfer: (golferId: string) => DirectMessage[];
  sendDirectMessage: (golferId: string, text: string) => boolean;
  markConversationRead: (golferId: string) => void;

  // --- Community — a social/discussion layer embedded in the core loop.
  // Votes are popularity signals only; they never touch reputation/credibility. ---
  posts: CommunityPost[];
  getPost: (id: string) => CommunityPost | undefined;
  visiblePosts: () => CommunityPost[]; // excludes blocked-either-direction + hidden-by-me
  createPost: (input: CreatePostInput) => CommunityPost;
  deletePost: (postId: string) => void;
  attachGolfCallToPost: (postId: string, callId: string) => void;

  isPostUpvoted: (postId: string) => boolean;
  postUpvoteCount: (postId: string) => number;
  togglePostUpvote: (postId: string) => void;

  isPostSaved: (postId: string) => boolean;
  savePost: (postId: string) => void;
  unsavePost: (postId: string) => void;
  savedPostsList: CommunityPost[];

  isPostHidden: (postId: string) => boolean;
  hidePost: (postId: string) => void;

  comments: PostComment[];
  commentsForPost: (postId: string) => PostComment[];
  createComment: (postId: string, text: string, parentCommentId?: string) => void;
  deleteComment: (commentId: string) => void;
  isCommentUpvoted: (commentId: string) => boolean;
  commentUpvoteCount: (commentId: string) => number;
  toggleCommentUpvote: (commentId: string) => void;

  notifications: AppNotification[];
  unreadNotificationCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  resetDemoData: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => loadData());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoading) saveData(data);
  }, [data, isLoading]);

  const currentUser = useMemo(
    () => data.golfers.find((g) => g.id === data.currentUserId) ?? data.golfers[0],
    [data.golfers, data.currentUserId],
  );

  const getGolfer = useCallback((id: string) => data.golfers.find((g) => g.id === id), [data.golfers]);
  const getGolfCall = useCallback((id: string) => data.golfCalls.find((c) => c.id === id), [data.golfCalls]);
  const messagesForCall = useCallback(
    (callId: string) => data.messages.filter((m) => m.golfCallId === callId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [data.messages],
  );
  const reviewsAbout = useCallback((golferId: string) => data.reviews.filter((r) => r.revieweeId === golferId), [data.reviews]);

  const blockedIds = useMemo(
    () => data.blocks.filter((b) => b.blockerId === currentUser.id).map((b) => b.blockedId),
    [data.blocks, currentUser.id],
  );

  const isBlocked = useCallback((id: string) => blockedIds.includes(id), [blockedIds]);

  const visibleGolfers = useCallback(
    (excludeSelf = true) =>
      data.golfers.filter((g) => (excludeSelf ? g.id !== currentUser.id : true) && !blockedIds.includes(g.id)),
    [data.golfers, currentUser.id, blockedIds],
  );

  const addSystemMessage = useCallback((callId: string, text: string) => {
    setData((prev) => ({
      ...prev,
      messages: [
        ...prev.messages,
        { id: generateId("msg"), golfCallId: callId, senderId: "system", text, createdAt: new Date().toISOString(), system: true },
      ],
    }));
  }, []);

  // Defined early so any action below (follow, comment, attach-round) can
  // push a notification without worrying about declaration order.
  const pushNotification = useCallback(
    (userId: string, type: NotificationType, text: string, linkTo: string, actorId?: string) => {
      if (userId === actorId) return; // never notify yourself about your own action
      setData((prev) => ({
        ...prev,
        notifications: [
          { id: generateId("ntf"), userId, type, actorId, text, linkTo, read: false, createdAt: new Date().toISOString() },
          ...prev.notifications,
        ],
      }));
    },
    [],
  );

  const switchCurrentUser = useCallback((id: string) => {
    setData((prev) => ({ ...prev, currentUserId: id }));
  }, []);

  const updateCurrentUserProfile = useCallback((patch: Partial<GolferProfile>) => {
    setData((prev) => ({
      ...prev,
      golfers: prev.golfers.map((g) => (g.id === prev.currentUserId ? { ...g, ...patch } : g)),
    }));
  }, []);

  const setPhoneVerified = useCallback((value: boolean) => {
    setData((prev) => ({
      ...prev,
      golfers: prev.golfers.map((g) =>
        g.id === prev.currentUserId ? { ...g, verification: { ...g.verification, phoneVerified: value } } : g,
      ),
    }));
  }, []);

  const setEmailVerified = useCallback((value: boolean) => {
    setData((prev) => ({
      ...prev,
      golfers: prev.golfers.map((g) =>
        g.id === prev.currentUserId ? { ...g, verification: { ...g.verification, emailVerified: value } } : g,
      ),
    }));
  }, []);

  const requestVerifiedGolfer = useCallback(() => {
    setData((prev) => ({
      ...prev,
      golfers: prev.golfers.map((g) =>
        g.id === prev.currentUserId ? { ...g, verification: { ...g.verification, verifiedGolfer: true } } : g,
      ),
    }));
  }, []);

  const createGolfCall = useCallback(
    (input: CreateGolfCallInput): GolfCall => {
      const joinedGolferIds = [data.currentUserId, ...(input.additionalJoinedGolferIds ?? [])];
      const call: GolfCall = {
        id: generateId("call"),
        hostId: data.currentUserId,
        course: input.course,
        areaLabel: input.areaLabel,
        distanceMiles: input.distanceMiles,
        dateISO: input.dateISO,
        timeLabel: input.timeLabel,
        estimatedPricePerPerson: input.estimatedPricePerPerson,
        totalSpots: input.totalSpots,
        joinedGolferIds,
        pendingRequestIds: [],
        joinMode: input.joinMode,
        skillLevel: input.skillLevel,
        vibe: input.vibe,
        walkOrCart: input.walkOrCart,
        holes: input.holes,
        gameFormat: input.gameFormat,
        status: joinedGolferIds.length >= input.totalSpots ? "full" : "open",
        notes: input.notes,
        createdAt: new Date().toISOString(),
      };
      setData((prev) => ({ ...prev, golfCalls: [call, ...prev.golfCalls] }));
      return call;
    },
    [data.currentUserId],
  );

  const cancelGolfCall = useCallback(
    (callId: string) => {
      setData((prev) => ({
        ...prev,
        golfCalls: prev.golfCalls.map((c) => (c.id === callId ? { ...c, status: "cancelled" } : c)),
      }));
      addSystemMessage(callId, "The host cancelled this Golf Call.");
    },
    [addSystemMessage],
  );

  // Prototype-only: in a real app a round transitions to "completed" once
  // its tee time has passed. Here that's simulated on demand so the
  // review/credibility loop is testable without waiting for a real clock.
  const simulateCallCompletion = useCallback((callId: string) => {
    setData((prev) => ({
      ...prev,
      golfCalls: prev.golfCalls.map((c) => (c.id === callId ? { ...c, status: "completed" } : c)),
    }));
  }, []);

  const joinGolfCall = useCallback(
    (callId: string) => {
      const call = data.golfCalls.find((c) => c.id === callId);
      if (!call) return;
      const uid = data.currentUserId;
      if (call.joinedGolferIds.includes(uid) || call.pendingRequestIds.includes(uid)) return;

      if (call.joinMode === "instant") {
        setData((prev) => ({
          ...prev,
          golfCalls: prev.golfCalls.map((c) => {
            if (c.id !== callId) return c;
            const joined = [...c.joinedGolferIds, uid];
            return { ...c, joinedGolferIds: joined, status: joined.length >= c.totalSpots ? "full" : c.status };
          }),
        }));
        addSystemMessage(callId, `${currentUser.name} joined the round.`);
      } else {
        setData((prev) => ({
          ...prev,
          golfCalls: prev.golfCalls.map((c) =>
            c.id === callId ? { ...c, pendingRequestIds: [...c.pendingRequestIds, uid] } : c,
          ),
        }));
        addSystemMessage(callId, `${currentUser.name} requested to join. Waiting on host approval.`);
      }
    },
    [data.golfCalls, data.currentUserId, currentUser.name, addSystemMessage],
  );

  const cancelJoinRequest = useCallback(
    (callId: string) => {
      setData((prev) => ({
        ...prev,
        golfCalls: prev.golfCalls.map((c) =>
          c.id === callId ? { ...c, pendingRequestIds: c.pendingRequestIds.filter((id) => id !== prev.currentUserId) } : c,
        ),
      }));
    },
    [],
  );

  const leaveGolfCall = useCallback(
    (callId: string) => {
      setData((prev) => ({
        ...prev,
        golfCalls: prev.golfCalls.map((c) =>
          c.id === callId
            ? { ...c, joinedGolferIds: c.joinedGolferIds.filter((id) => id !== prev.currentUserId), status: "open" }
            : c,
        ),
      }));
      addSystemMessage(callId, `${currentUser.name} left the round.`);
    },
    [addSystemMessage, currentUser.name],
  );

  const approveRequest = useCallback(
    (callId: string, golferId: string) => {
      setData((prev) => ({
        ...prev,
        golfCalls: prev.golfCalls.map((c) => {
          if (c.id !== callId) return c;
          const joined = [...c.joinedGolferIds, golferId];
          return {
            ...c,
            joinedGolferIds: joined,
            pendingRequestIds: c.pendingRequestIds.filter((id) => id !== golferId),
            status: joined.length >= c.totalSpots ? "full" : c.status,
          };
        }),
      }));
      const golfer = getGolfer(golferId);
      addSystemMessage(callId, `${golfer?.name ?? "A golfer"} was approved to join the round.`);
    },
    [addSystemMessage, getGolfer],
  );

  const declineRequest = useCallback((callId: string, golferId: string) => {
    setData((prev) => ({
      ...prev,
      golfCalls: prev.golfCalls.map((c) =>
        c.id === callId ? { ...c, pendingRequestIds: c.pendingRequestIds.filter((id) => id !== golferId) } : c,
      ),
    }));
  }, []);

  const sendMessage = useCallback(
    (callId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setData((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: generateId("msg"),
            golfCallId: callId,
            senderId: prev.currentUserId,
            text: trimmed,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
    },
    [],
  );

  const hasReviewed = useCallback(
    (callId: string, revieweeId: string) =>
      data.reviews.some((r) => r.golfCallId === callId && r.revieweeId === revieweeId && r.reviewerId === data.currentUserId),
    [data.reviews, data.currentUserId],
  );

  const submitReview = useCallback(
    (callId: string, revieweeId: string, input: ReviewInput) => {
      setData((prev) => {
        const already = prev.reviews.some(
          (r) => r.golfCallId === callId && r.revieweeId === revieweeId && r.reviewerId === prev.currentUserId,
        );
        if (already) return prev;
        const review: Review = {
          id: generateId("rev"),
          golfCallId: callId,
          reviewerId: prev.currentUserId,
          revieweeId,
          ...input,
          createdAt: new Date().toISOString(),
        };
        return { ...prev, reviews: [...prev.reviews, review] };
      });
    },
    [],
  );

  const reportUser = useCallback(
    (
      reportedId: string,
      category: ReportCategory,
      details: string,
      context: Report["context"],
      meta?: { golfCallId?: string; postId?: string; commentId?: string },
    ) => {
      setData((prev) => ({
        ...prev,
        reports: [
          ...prev.reports,
          {
            id: generateId("rpt"),
            reporterId: prev.currentUserId,
            reportedId,
            category,
            details,
            context,
            golfCallId: meta?.golfCallId,
            postId: meta?.postId,
            commentId: meta?.commentId,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
    },
    [],
  );

  const blockUser = useCallback((blockedId: string) => {
    setData((prev) => ({
      ...prev,
      blocks: [...prev.blocks, { blockerId: prev.currentUserId, blockedId, createdAt: new Date().toISOString() }],
    }));
  }, []);

  const unblockUser = useCallback((blockedId: string) => {
    setData((prev) => ({
      ...prev,
      blocks: prev.blocks.filter((b) => !(b.blockerId === prev.currentUserId && b.blockedId === blockedId)),
    }));
  }, []);

  const hasPlayedWith = useCallback(
    (golferId: string) =>
      data.golfCalls.some(
        (c) => c.status === "completed" && c.joinedGolferIds.includes(data.currentUserId) && c.joinedGolferIds.includes(golferId),
      ),
    [data.golfCalls, data.currentUserId],
  );

  // Bulk form of hasPlayedWith — used by the "New Golfers" Group Type
  // preference check, which needs to test a whole round's roster at once.
  const playedWithIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of data.golfCalls) {
      if (c.status === "completed" && c.joinedGolferIds.includes(data.currentUserId)) {
        for (const id of c.joinedGolferIds) if (id !== data.currentUserId) ids.add(id);
      }
    }
    return ids;
  }, [data.golfCalls, data.currentUserId]);

  const circleGolfers = useMemo(
    () =>
      data.circle
        .filter((c) => c.ownerId === currentUser.id)
        .map((c) => data.golfers.find((g) => g.id === c.memberId))
        .filter((g): g is GolferProfile => Boolean(g)),
    [data.circle, data.golfers, currentUser.id],
  );

  const isInCircle = useCallback(
    (golferId: string) => data.circle.some((c) => c.ownerId === currentUser.id && c.memberId === golferId),
    [data.circle, currentUser.id],
  );

  const addToCircle = useCallback((memberId: string) => {
    setData((prev) => {
      const already = prev.circle.some((c) => c.ownerId === prev.currentUserId && c.memberId === memberId);
      if (already) return prev;
      const connection: CircleConnection = {
        id: generateId("circ"),
        ownerId: prev.currentUserId,
        memberId,
        createdAt: new Date().toISOString(),
      };
      return { ...prev, circle: [...prev.circle, connection] };
    });
  }, []);

  // Explicit account selection, not an implicit fallback — the caller
  // (Auth.tsx) always passes the golfer id the person actually picked, so
  // login never silently lands on whichever currentUserId happened to
  // already be in storage.
  const logIn = useCallback((userId: string) => {
    setData((prev) => ({ ...prev, currentUserId: userId, session: { isLoggedIn: true, hasOnboarded: true } }));
  }, []);

  const logOut = useCallback(() => {
    setData((prev) => ({ ...prev, session: { ...prev.session, isLoggedIn: false } }));
  }, []);

  const blockedByIds = useMemo(
    () => data.blocks.filter((b) => b.blockedId === currentUser.id).map((b) => b.blockerId),
    [data.blocks, currentUser.id],
  );
  const isBlockedBy = useCallback((id: string) => blockedByIds.includes(id), [blockedByIds]);

  const isFollowing = useCallback(
    (id: string) => data.follows.some((f) => f.followerId === currentUser.id && f.followingId === id),
    [data.follows, currentUser.id],
  );

  const followUser = useCallback(
    (golferId: string) => {
      setData((prev) => {
        const already = prev.follows.some((f) => f.followerId === prev.currentUserId && f.followingId === golferId);
        if (already) return prev;
        const connection: FollowConnection = {
          id: generateId("flw"),
          followerId: prev.currentUserId,
          followingId: golferId,
          createdAt: new Date().toISOString(),
        };
        return { ...prev, follows: [...prev.follows, connection] };
      });
      pushNotification(golferId, "new_follower", `${currentUser.name} started following you.`, `/golfer/${currentUser.id}`, currentUser.id);
    },
    [pushNotification, currentUser.name, currentUser.id],
  );

  const unfollowUser = useCallback((golferId: string) => {
    setData((prev) => ({
      ...prev,
      follows: prev.follows.filter((f) => !(f.followerId === prev.currentUserId && f.followingId === golferId)),
    }));
  }, []);

  const followingGolfers = useMemo(
    () =>
      data.follows
        .filter((f) => f.followerId === currentUser.id)
        .map((f) => data.golfers.find((g) => g.id === f.followingId))
        .filter((g): g is GolferProfile => Boolean(g)),
    [data.follows, data.golfers, currentUser.id],
  );

  // Messaging never requires following — Follow and Message are independent
  // actions. The only limits are the obvious ones: not yourself, and not
  // blocked in either direction.
  const canMessage = useCallback(
    (id: string) => {
      if (id === currentUser.id) return false;
      if (isBlocked(id) || isBlockedBy(id)) return false;
      return true;
    },
    [currentUser.id, isBlocked, isBlockedBy],
  );

  // Basic anti-spam guard: a golfer can't fire off more than one direct
  // message per second. Not real moderation infrastructure — just enough to
  // stop accidental double-sends and rapid-fire spam-clicking.
  const DM_RATE_LIMIT_MS = 1000;
  const canSendMessageNow = useCallback(() => {
    const mine = data.directMessages.filter((m) => m.senderId === currentUser.id);
    if (mine.length === 0) return true;
    const last = mine[mine.length - 1];
    return Date.now() - new Date(last.createdAt).getTime() >= DM_RATE_LIMIT_MS;
  }, [data.directMessages, currentUser.id]);

  const messagesWithGolfer = useCallback(
    (golferId: string) => {
      const convId = dmConversationId(currentUser.id, golferId);
      return data.directMessages
        .filter((m) => m.conversationId === convId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    [data.directMessages, currentUser.id],
  );

  // Returns whether the message actually sent, so the UI can tell a
  // rate-limited send apart from a normal successful one.
  const sendDirectMessage = useCallback(
    (golferId: string, text: string): boolean => {
      const trimmed = text.trim();
      if (!trimmed || !canMessage(golferId) || !canSendMessageNow()) return false;
      const convId = dmConversationId(currentUser.id, golferId);
      setData((prev) => ({
        ...prev,
        directMessages: [
          ...prev.directMessages,
          { id: generateId("dm"), conversationId: convId, senderId: prev.currentUserId, text: trimmed, createdAt: new Date().toISOString() },
        ],
      }));
      return true;
    },
    [canMessage, canSendMessageNow, currentUser.id],
  );

  const markConversationRead = useCallback(
    (golferId: string) => {
      const convId = dmConversationId(currentUser.id, golferId);
      setData((prev) => {
        const now = new Date().toISOString();
        const existing = prev.dmReads.find((r) => r.conversationId === convId && r.userId === prev.currentUserId);
        const dmReads = existing
          ? prev.dmReads.map((r) => (r === existing ? { ...r, lastReadAt: now } : r))
          : [...prev.dmReads, { conversationId: convId, userId: prev.currentUserId, lastReadAt: now }];
        return { ...prev, dmReads };
      });
    },
    [currentUser.id],
  );

  const dmConversations = useMemo<DmConversation[]>(() => {
    const byConv = new Map<string, DirectMessage[]>();
    for (const m of data.directMessages) {
      if (!m.conversationId.split("__").includes(currentUser.id)) continue;
      const list = byConv.get(m.conversationId);
      if (list) list.push(m);
      else byConv.set(m.conversationId, [m]);
    }
    const conversations: DmConversation[] = [];
    for (const [conversationId, msgs] of byConv) {
      const otherId = otherParticipant(conversationId, currentUser.id);
      if (blockedIds.includes(otherId) || blockedByIds.includes(otherId)) continue;
      const otherGolfer = data.golfers.find((g) => g.id === otherId);
      if (!otherGolfer) continue;
      const sorted = [...msgs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const lastMessage = sorted[sorted.length - 1];
      const readState = data.dmReads.find((r) => r.conversationId === conversationId && r.userId === currentUser.id);
      const unread = lastMessage.senderId !== currentUser.id && (!readState || readState.lastReadAt < lastMessage.createdAt);
      conversations.push({ conversationId, otherGolfer, lastMessage, unread });
    }
    return conversations.sort((a, b) => b.lastMessage.createdAt.localeCompare(a.lastMessage.createdAt));
  }, [data.directMessages, data.dmReads, data.golfers, currentUser.id, blockedIds, blockedByIds]);

  const hasUnreadMessages = useMemo(() => dmConversations.some((c) => c.unread), [dmConversations]);

  const signUpNewGolfer = useCallback((input: NewGolferInput): GolferProfile => {
    const id = generateId("g");
    const golfer: GolferProfile = {
      id,
      name: input.name.trim() || "New Golfer",
      avatarColor: avatarColorForName(input.name),
      avatarInitials: initialsFromName(input.name),
      photoUrl: input.photoUrl,
      ageRange: input.ageRange,
      gender: input.gender,
      areaLabel: input.areaLabel.trim() || "Nearby",
      playingAreaCoords: input.playingAreaCoords,
      distanceMiles: 0,
      handicap: input.handicap,
      favoriteCourses: input.favoriteCourses ?? [],
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      noBudgetPreference: false,
      availability: input.availability ?? [],
      walkOrCart: input.walkOrCart,
      vibes: input.vibes.length > 0 ? input.vibes : ["Casual & Social"],
      preferredCourses: input.preferredCourses,
      travelRadiusMiles: input.travelRadiusMiles,
      // Handicap-range preference for playing partners isn't collected
      // during onboarding — starts at the slider's full span ("no
      // preference"), same as everyone's default until edited from Profile.
      handicapPreferenceMin: 0,
      handicapPreferenceMax: 36,
      // Age/gender-preference-for-partners isn't collected during
      // onboarding either — same "no preference" default, completed later
      // from Profile > Match Preferences if the golfer wants it.
      agePreferenceMin: input.agePreferenceMin ?? AGE_PREF_MIN,
      agePreferenceMax: input.agePreferenceMax ?? AGE_PREF_MAX,
      noAgePreference: input.noAgePreference ?? true,
      genderPreference: input.genderPreference ?? "No preference",
      // Round Length is the one Match Preference onboarding does collect
      // (see ProfileSetup step 4); Group Type / Game Format / Networking
      // aren't part of onboarding — set later from Profile > Match
      // Preferences if the golfer wants to.
      roundLengthPreference: input.roundLengthPreference ?? "No Preference",
      groupTypePreference: "No Preference",
      gameFormatPreference: "No Preference",
      networkingPreference: "No Preference",
      bio: "New to Golf Me — excited to find my next round.",
      verification: { phoneVerified: false, emailVerified: false, verifiedGolfer: false },
      reputation: {
        completedRounds: 0,
        showUpRatePct: 0,
        wouldPlayAgainPct: 0,
        onTimePct: 0,
        respectfulPct: 0,
        goodPacePct: 0,
      },
      memberSince: new Date().toISOString(),
      circleSize: 0,
    };
    setData((prev) => ({
      ...prev,
      golfers: [...prev.golfers, golfer],
      currentUserId: id,
      session: { isLoggedIn: true, hasOnboarded: true },
    }));
    return golfer;
  }, []);

  // --- Community ---

  const getPost = useCallback((id: string) => data.posts.find((p) => p.id === id), [data.posts]);

  const isPostHidden = useCallback(
    (postId: string) => data.hiddenPosts.some((h) => h.ownerId === currentUser.id && h.postId === postId),
    [data.hiddenPosts, currentUser.id],
  );

  // Excludes anyone blocked in either direction and anything the current
  // user has individually hidden — the same block relationship used by
  // messaging and profiles, never a second "community block" list.
  const visiblePosts = useCallback(
    () => data.posts.filter((p) => !blockedIds.includes(p.authorId) && !blockedByIds.includes(p.authorId) && !isPostHidden(p.id)),
    [data.posts, blockedIds, blockedByIds, isPostHidden],
  );

  const createPost = useCallback(
    (input: CreatePostInput): CommunityPost => {
      const post: CommunityPost = {
        id: generateId("post"),
        authorId: data.currentUserId,
        type: input.type,
        text: input.text.trim(),
        imageUrl: input.imageUrl,
        courseTag: input.courseTag,
        golfCallId: input.golfCallId,
        category: input.category,
        createdAt: new Date().toISOString(),
      };
      setData((prev) => ({ ...prev, posts: [post, ...prev.posts] }));
      return post;
    },
    [data.currentUserId],
  );

  const deletePost = useCallback((postId: string) => {
    setData((prev) => {
      const post = prev.posts.find((p) => p.id === postId);
      if (!post || post.authorId !== prev.currentUserId) return prev;
      const commentIds = prev.comments.filter((c) => c.postId === postId).map((c) => c.id);
      return {
        ...prev,
        posts: prev.posts.filter((p) => p.id !== postId),
        comments: prev.comments.filter((c) => c.postId !== postId),
        postVotes: prev.postVotes.filter((v) => v.postId !== postId),
        commentVotes: prev.commentVotes.filter((v) => !commentIds.includes(v.commentId)),
        savedPosts: prev.savedPosts.filter((s) => s.postId !== postId),
        hiddenPosts: prev.hiddenPosts.filter((h) => h.postId !== postId),
      };
    });
  }, []);

  // Attaches a real Golf Call to the post it came from ("Create a Round
  // From This Post"), then fans out the two follow-up notification types:
  // the actor's followers ("someone you follow created a Golf Call from a
  // post"), and everyone who posted or commented in the thread ("a
  // conversation you participated in became a real Golf Call").
  const attachGolfCallToPost = useCallback(
    (postId: string, callId: string) => {
      const post = getPost(postId);
      if (!post) return;
      const actorId = data.currentUserId;
      const call = getGolfCall(callId);
      const roundText = call ? `${call.course}` : "a round";

      setData((prev) => ({ ...prev, posts: prev.posts.map((p) => (p.id === postId ? { ...p, golfCallId: callId } : p)) }));

      const followerIds = data.follows.filter((f) => f.followingId === actorId).map((f) => f.followerId);
      for (const followerId of followerIds) {
        pushNotification(
          followerId,
          "round_created_from_post",
          `${currentUser.name} created a Golf Call at ${roundText} from a post.`,
          `/community/${postId}`,
          actorId,
        );
      }

      const participantIds = new Set<string>([post.authorId, ...data.comments.filter((c) => c.postId === postId).map((c) => c.authorId)]);
      for (const participantId of participantIds) {
        if (participantId === actorId) continue;
        pushNotification(participantId, "post_became_round", `A post you were part of turned into a real Golf Call.`, `/community/${postId}`, actorId);
      }
    },
    [getPost, data.currentUserId, data.follows, data.comments, getGolfCall, currentUser.name, pushNotification],
  );

  const isPostUpvoted = useCallback(
    (postId: string) => data.postVotes.some((v) => v.postId === postId && v.voterId === currentUser.id),
    [data.postVotes, currentUser.id],
  );
  const postUpvoteCount = useCallback((postId: string) => data.postVotes.filter((v) => v.postId === postId).length, [data.postVotes]);
  const togglePostUpvote = useCallback((postId: string) => {
    setData((prev) => {
      const existing = prev.postVotes.find((v) => v.postId === postId && v.voterId === prev.currentUserId);
      if (existing) return { ...prev, postVotes: prev.postVotes.filter((v) => v !== existing) };
      const vote: PostVote = { id: generateId("pv"), postId, voterId: prev.currentUserId, createdAt: new Date().toISOString() };
      return { ...prev, postVotes: [...prev.postVotes, vote] };
    });
  }, []);

  const isPostSaved = useCallback(
    (postId: string) => data.savedPosts.some((s) => s.ownerId === currentUser.id && s.postId === postId),
    [data.savedPosts, currentUser.id],
  );
  const savePost = useCallback((postId: string) => {
    setData((prev) => {
      const already = prev.savedPosts.some((s) => s.ownerId === prev.currentUserId && s.postId === postId);
      if (already) return prev;
      const saved: SavedPost = { id: generateId("sav"), ownerId: prev.currentUserId, postId, createdAt: new Date().toISOString() };
      return { ...prev, savedPosts: [...prev.savedPosts, saved] };
    });
  }, []);
  const unsavePost = useCallback((postId: string) => {
    setData((prev) => ({ ...prev, savedPosts: prev.savedPosts.filter((s) => !(s.ownerId === prev.currentUserId && s.postId === postId)) }));
  }, []);
  const savedPostsList = useMemo(
    () =>
      data.savedPosts
        .filter((s) => s.ownerId === currentUser.id)
        .map((s) => data.posts.find((p) => p.id === s.postId))
        .filter((p): p is CommunityPost => Boolean(p)),
    [data.savedPosts, data.posts, currentUser.id],
  );

  const hidePost = useCallback((postId: string) => {
    setData((prev) => {
      const already = prev.hiddenPosts.some((h) => h.ownerId === prev.currentUserId && h.postId === postId);
      if (already) return prev;
      return { ...prev, hiddenPosts: [...prev.hiddenPosts, { ownerId: prev.currentUserId, postId, createdAt: new Date().toISOString() }] };
    });
  }, []);

  const commentsForPost = useCallback(
    (postId: string) => data.comments.filter((c) => c.postId === postId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [data.comments],
  );

  const createComment = useCallback(
    (postId: string, text: string, parentCommentId?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const actorId = data.currentUserId;
      const comment: PostComment = {
        id: generateId("cmt"),
        postId,
        authorId: actorId,
        text: trimmed,
        parentCommentId,
        createdAt: new Date().toISOString(),
      };
      setData((prev) => ({ ...prev, comments: [...prev.comments, comment] }));

      if (parentCommentId) {
        const parent = data.comments.find((c) => c.id === parentCommentId);
        if (parent) pushNotification(parent.authorId, "comment_reply", `${currentUser.name} replied to your comment.`, `/community/${postId}`, actorId);
      } else {
        const post = getPost(postId);
        if (post) pushNotification(post.authorId, "post_reply", `${currentUser.name} commented on your post.`, `/community/${postId}`, actorId);
      }
    },
    [data.currentUserId, data.comments, getPost, currentUser.name, pushNotification],
  );

  const deleteComment = useCallback((commentId: string) => {
    setData((prev) => {
      const comment = prev.comments.find((c) => c.id === commentId);
      if (!comment || comment.authorId !== prev.currentUserId) return prev;
      // Also drop direct replies to this comment, so the thread never shows
      // an orphaned reply to a comment that no longer exists.
      const replyIds = prev.comments.filter((c) => c.parentCommentId === commentId).map((c) => c.id);
      const removedIds = new Set([commentId, ...replyIds]);
      return {
        ...prev,
        comments: prev.comments.filter((c) => !removedIds.has(c.id)),
        commentVotes: prev.commentVotes.filter((v) => !removedIds.has(v.commentId)),
      };
    });
  }, []);

  const isCommentUpvoted = useCallback(
    (commentId: string) => data.commentVotes.some((v) => v.commentId === commentId && v.voterId === currentUser.id),
    [data.commentVotes, currentUser.id],
  );
  const commentUpvoteCount = useCallback(
    (commentId: string) => data.commentVotes.filter((v) => v.commentId === commentId).length,
    [data.commentVotes],
  );
  const toggleCommentUpvote = useCallback((commentId: string) => {
    setData((prev) => {
      const existing = prev.commentVotes.find((v) => v.commentId === commentId && v.voterId === prev.currentUserId);
      if (existing) return { ...prev, commentVotes: prev.commentVotes.filter((v) => v !== existing) };
      const vote: CommentVote = { id: generateId("cv"), commentId, voterId: prev.currentUserId, createdAt: new Date().toISOString() };
      return { ...prev, commentVotes: [...prev.commentVotes, vote] };
    });
  }, []);

  const notifications = useMemo(
    () => data.notifications.filter((n) => n.userId === currentUser.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.notifications, currentUser.id],
  );
  const unreadNotificationCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  const markNotificationRead = useCallback((id: string) => {
    setData((prev) => ({ ...prev, notifications: prev.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
  }, []);
  const markAllNotificationsRead = useCallback(() => {
    setData((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) => (n.userId === prev.currentUserId ? { ...n, read: true } : n)),
    }));
  }, []);

  const resetDemoData = useCallback(() => {
    setData(resetToSeedData());
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({
      data,
      isLoading,
      currentUser,
      golfers: data.golfers,
      golfCalls: data.golfCalls,
      messages: data.messages,
      reviews: data.reviews,
      reports: data.reports,
      getGolfer,
      getGolfCall,
      messagesForCall,
      visibleGolfers,
      reviewsAbout,
      session: data.session,
      logIn,
      logOut,
      signUpNewGolfer,
      switchCurrentUser,
      updateCurrentUserProfile,
      setPhoneVerified,
      setEmailVerified,
      requestVerifiedGolfer,
      createGolfCall,
      cancelGolfCall,
      simulateCallCompletion,
      joinGolfCall,
      cancelJoinRequest,
      leaveGolfCall,
      approveRequest,
      declineRequest,
      sendMessage,
      hasReviewed,
      submitReview,
      reportUser,
      blockUser,
      unblockUser,
      isBlocked,
      blockedIds,
      circleGolfers,
      isInCircle,
      addToCircle,
      hasPlayedWith,
      playedWithIds,
      followingGolfers,
      isFollowing,
      followUser,
      unfollowUser,
      canMessage,
      dmConversations,
      hasUnreadMessages,
      messagesWithGolfer,
      sendDirectMessage,
      markConversationRead,
      posts: data.posts,
      getPost,
      visiblePosts,
      createPost,
      deletePost,
      attachGolfCallToPost,
      isPostUpvoted,
      postUpvoteCount,
      togglePostUpvote,
      isPostSaved,
      savePost,
      unsavePost,
      savedPostsList,
      isPostHidden,
      hidePost,
      comments: data.comments,
      commentsForPost,
      createComment,
      deleteComment,
      isCommentUpvoted,
      commentUpvoteCount,
      toggleCommentUpvote,
      notifications,
      unreadNotificationCount,
      markNotificationRead,
      markAllNotificationsRead,
      resetDemoData,
    }),
    [
      data,
      isLoading,
      currentUser,
      getGolfer,
      getGolfCall,
      messagesForCall,
      visibleGolfers,
      reviewsAbout,
      logIn,
      logOut,
      signUpNewGolfer,
      switchCurrentUser,
      updateCurrentUserProfile,
      setPhoneVerified,
      setEmailVerified,
      requestVerifiedGolfer,
      createGolfCall,
      cancelGolfCall,
      simulateCallCompletion,
      joinGolfCall,
      cancelJoinRequest,
      leaveGolfCall,
      approveRequest,
      declineRequest,
      sendMessage,
      hasReviewed,
      submitReview,
      reportUser,
      blockUser,
      unblockUser,
      isBlocked,
      blockedIds,
      circleGolfers,
      isInCircle,
      addToCircle,
      hasPlayedWith,
      playedWithIds,
      followingGolfers,
      isFollowing,
      followUser,
      unfollowUser,
      canMessage,
      dmConversations,
      hasUnreadMessages,
      messagesWithGolfer,
      sendDirectMessage,
      markConversationRead,
      getPost,
      visiblePosts,
      createPost,
      deletePost,
      attachGolfCallToPost,
      isPostUpvoted,
      postUpvoteCount,
      togglePostUpvote,
      isPostSaved,
      savePost,
      unsavePost,
      savedPostsList,
      isPostHidden,
      hidePost,
      commentsForPost,
      createComment,
      deleteComment,
      isCommentUpvoted,
      commentUpvoteCount,
      toggleCommentUpvote,
      notifications,
      unreadNotificationCount,
      markNotificationRead,
      markAllNotificationsRead,
      resetDemoData,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within a DataProvider");
  return ctx;
}

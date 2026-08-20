import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  AgeRange,
  AppData,
  AppNotification,
  AvailabilitySlot,
  CaddieAnalysis,
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
import { useAuth } from "./AuthContext";
import { placeholderGolferProfile, golferPatchToProfileRow } from "../lib/profile";
import { useRealRounds } from "./RealRoundsContext";
import { useRealSocial } from "./RealSocialContext";
import { useRealCommunity } from "./RealCommunityContext";
import { useRealCaddie } from "./RealCaddieContext";
import type { CreateAnalysisInput } from "./RealCaddieContext";
import { buildDemoCaddieAnalyses } from "../data/caddie";

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
  videoUrl?: string; // swing posts only — real accounts, ignored by the demo path
  videoThumbnailUrl?: string; // real accounts only, ignored by the demo path
  courseTag?: string;
  golfCallId?: string;
  category: PostCategory;
  coachReviewRequested?: boolean; // real accounts only, ignored by the demo path (Coach Reviewer is a real-account-only role)
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
  updateCurrentUserProfile: (patch: Partial<GolferProfile>) => Promise<void>;
  setPhoneVerified: (value: boolean) => void;
  setEmailVerified: (value: boolean) => void;
  requestVerifiedGolfer: () => void;

  createGolfCall: (input: CreateGolfCallInput) => GolfCall;
  cancelGolfCall: (callId: string) => Promise<void>;
  simulateCallCompletion: (callId: string) => void;
  completeGolfCall: (callId: string) => Promise<void>;
  joinGolfCall: (callId: string) => Promise<void>;
  cancelJoinRequest: (callId: string) => void;
  leaveGolfCall: (callId: string) => Promise<void>;
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
  followUser: (golferId: string) => Promise<void>;
  unfollowUser: (golferId: string) => Promise<void>;

  // Direct messages between two golfers, gated by canMessage().
  canMessage: (golferId: string) => boolean;
  dmConversations: DmConversation[];
  hasUnreadMessages: boolean;
  messagesWithGolfer: (golferId: string) => DirectMessage[];
  sendDirectMessage: (golferId: string, text: string) => Promise<boolean>;
  markConversationRead: (golferId: string) => Promise<void>;
  clearChatHistory: (golferId: string) => Promise<void>;
  deleteConversation: (golferId: string) => Promise<void>;

  // --- Community — a social/discussion layer embedded in the core loop.
  // Votes are popularity signals only; they never touch reputation/credibility. ---
  posts: CommunityPost[];
  getPost: (id: string) => CommunityPost | undefined;
  visiblePosts: () => CommunityPost[]; // excludes blocked-either-direction + hidden-by-me
  createPost: (input: CreatePostInput) => Promise<CommunityPost>;
  deletePost: (postId: string) => Promise<void>;
  attachGolfCallToPost: (postId: string, callId: string) => Promise<void>;

  isPostUpvoted: (postId: string) => boolean;
  postUpvoteCount: (postId: string) => number;
  togglePostUpvote: (postId: string) => Promise<void>;

  isPostSaved: (postId: string) => boolean;
  savePost: (postId: string) => Promise<void>;
  unsavePost: (postId: string) => Promise<void>;
  savedPostsList: CommunityPost[];

  isPostHidden: (postId: string) => boolean;
  hidePost: (postId: string) => Promise<void>;

  comments: PostComment[];
  commentsForPost: (postId: string) => PostComment[];
  createComment: (postId: string, text: string, parentCommentId?: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  isCommentUpvoted: (commentId: string) => boolean;
  commentUpvoteCount: (commentId: string) => number;
  toggleCommentUpvote: (commentId: string) => Promise<void>;

  caddieAnalyses: CaddieAnalysis[];
  getCaddieAnalysis: (id: string) => CaddieAnalysis | undefined;
  createCaddieAnalysis: (input: CreateAnalysisInput) => Promise<CaddieAnalysis>;

  notifications: AppNotification[];
  unreadNotificationCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  resetDemoData: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const realRounds = useRealRounds();
  const realSocial = useRealSocial();
  const realCommunity = useRealCommunity();
  const realCaddie = useRealCaddie();
  const [demoCaddieAnalyses, setDemoCaddieAnalyses] = useState<CaddieAnalysis[]>(() => buildDemoCaddieAnalyses());
  const [data, setData] = useState<AppData>(() => loadData());
  const [isLoading, setIsLoading] = useState(true);
  // Serializes real-account profile saves — see updateCurrentUserProfile
  // below for why two rapid edits racing was a real correctness bug, not
  // just a UX one.
  const profileSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoading) saveData(data);
  }, [data, isLoading]);

  const mockCurrentUser = useMemo(
    () => data.golfers.find((g) => g.id === data.currentUserId) ?? data.golfers[0],
    [data.golfers, data.currentUserId],
  );

  // Real (non-demo) accounts source identity from the real profiles row,
  // never from the shared mock golfers array — that array stays the shared
  // demo world every account still sees for Find/Discover/Community this
  // phase. Falls back to a placeholder only in the brief window before a
  // freshly-created auth session's stub profile row has loaded.
  const currentUser = useMemo(() => {
    if (auth.isDemo) return mockCurrentUser;
    if (auth.profile) return auth.profile;
    if (auth.authUser) return placeholderGolferProfile(auth.authUser.id, auth.authUser.email?.split("@")[0] ?? "Golfer");
    return mockCurrentUser;
  }, [auth.isDemo, auth.profile, auth.authUser, mockCurrentUser]);

  const session = useMemo<SessionState>(() => {
    if (auth.isDemo) return data.session;
    return { isLoggedIn: Boolean(auth.authUser), hasOnboarded: auth.hasOnboarded };
  }, [auth.isDemo, auth.authUser, auth.hasOnboarded, data.session]);

  // Real rounds' participants and real social contacts (DM partners, blocked
  // users, notification actors) are real accounts, never in the shared mock
  // golfers array — resolved from RealRoundsContext's/RealSocialContext's
  // batch profile fetches instead. currentUser itself is checked first
  // since it's always known even before either cache has loaded anyone.
  const golfCalls = auth.isDemo ? data.golfCalls : realRounds.golfCalls;
  const getGolfer = useCallback(
    (id: string) => {
      if (auth.isDemo) return data.golfers.find((g) => g.id === id);
      if (id === currentUser.id) return currentUser;
      // discoverableGolfers covers someone found via Discover/Find
      // Friends who isn't (yet) a round participant or DM/notification
      // contact — without it, tapping a search result or a Discover card
      // for a not-yet-connected real golfer would incorrectly resolve to
      // "not found" on their profile page.
      return (
        realRounds.profilesById.get(id) ??
        realSocial.profilesById.get(id) ??
        realSocial.discoverableGolfers.find((g) => g.id === id)
      );
    },
    [auth.isDemo, data.golfers, currentUser, realRounds.profilesById, realSocial.profilesById, realSocial.discoverableGolfers],
  );
  const getGolfCall = useCallback((id: string) => golfCalls.find((c) => c.id === id), [golfCalls]);
  const messagesForCall = useCallback(
    (callId: string) => {
      if (!auth.isDemo) return realRounds.messagesForCall(callId);
      return data.messages.filter((m) => m.golfCallId === callId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    [auth.isDemo, realRounds, data.messages],
  );
  const reviewsAbout = useCallback((golferId: string) => data.reviews.filter((r) => r.revieweeId === golferId), [data.reviews]);

  const mockBlockedIds = useMemo(
    () => data.blocks.filter((b) => b.blockerId === currentUser.id).map((b) => b.blockedId),
    [data.blocks, currentUser.id],
  );
  const blockedIds = auth.isDemo ? mockBlockedIds : realSocial.blockedIds;

  const isBlocked = useCallback((id: string) => (auth.isDemo ? mockBlockedIds.includes(id) : realSocial.isBlocked(id)), [auth.isDemo, mockBlockedIds, realSocial]);

  // Real accounts must only ever discover other real, registered golfers —
  // never the shared mock roster. realSocial.discoverableGolfers already
  // excludes self/blocked; the excludeSelf param only matters for the demo
  // path's own occasional excludeSelf=false caller.
  const visibleGolfers = useCallback(
    (excludeSelf = true) => {
      if (!auth.isDemo) return realSocial.discoverableGolfers;
      return data.golfers.filter((g) => (excludeSelf ? g.id !== currentUser.id : true) && !blockedIds.includes(g.id));
    },
    [auth.isDemo, realSocial.discoverableGolfers, data.golfers, currentUser.id, blockedIds],
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

  // Every profile-editing surface in the app (Profile page edit, Match
  // Preferences, location change, availability, AutoMatch's quick-set
  // buttons) already funnels through this one function — branching here
  // (demo: mock golfers array; real: real profiles row) gives every one of
  // those surfaces real persistence with no changes to their own code.
  const updateCurrentUserProfile = useCallback(
    (patch: Partial<GolferProfile>): Promise<void> => {
      if (auth.isDemo) {
        setData((prev) => ({
          ...prev,
          golfers: prev.golfers.map((g) => (g.id === prev.currentUserId ? { ...g, ...patch } : g)),
        }));
        return Promise.resolve();
      }
      // Real accounts: each save is UPDATE-then-refetch (see
      // AuthContext.saveProfile), and several surfaces (Match Preferences'
      // pill grid especially) fire one of these per click with nothing
      // batching them. Run in parallel, and the refetch responses can
      // arrive out of order — whichever one's setProfileRow happens to
      // resolve LAST wins, which isn't guaranteed to be the one initiated
      // last. Every individual UPDATE still lands in Postgres either way,
      // but the in-memory currentUser (and anything computed from it, like
      // Home's "complete your profile" reminder) could transiently or
      // persistently show a stale/regressed value. Chaining off the queue
      // makes each save's full round trip finish before the next one
      // starts, so completion order always matches initiation order.
      const row = golferPatchToProfileRow(patch);
      const thisSave = profileSaveQueueRef.current.then(
        () => auth.saveProfile(row),
        () => auth.saveProfile(row), // a previous save's failure must never block this one
      );
      // Two independent subscribers on the same promise: a default logger
      // (most existing callers don't await this at all, and shouldn't
      // start producing "unhandled rejection" console noise now that this
      // returns something rejectable) and the queue's own bookkeeping.
      // Neither prevents a caller who DOES want to await/catch `thisSave`
      // itself (see MatchPreferencesDetail.tsx) from doing so.
      thisSave.catch((err) => console.error("Golf Me: failed to save profile.", err));
      profileSaveQueueRef.current = thisSave.catch(() => {});
      return thisSave;
    },
    [auth],
  );

  const setPhoneVerified = useCallback(
    (value: boolean) => {
      if (auth.isDemo) {
        setData((prev) => ({
          ...prev,
          golfers: prev.golfers.map((g) =>
            g.id === prev.currentUserId ? { ...g, verification: { ...g.verification, phoneVerified: value } } : g,
          ),
        }));
      } else {
        auth.saveProfile({ phone_verified: value }).catch((err) => console.error("Golf Me: failed to save profile.", err));
      }
    },
    [auth],
  );

  const setEmailVerified = useCallback(
    (value: boolean) => {
      if (auth.isDemo) {
        setData((prev) => ({
          ...prev,
          golfers: prev.golfers.map((g) =>
            g.id === prev.currentUserId ? { ...g, verification: { ...g.verification, emailVerified: value } } : g,
          ),
        }));
      } else {
        auth.saveProfile({ email_verified: value }).catch((err) => console.error("Golf Me: failed to save profile.", err));
      }
    },
    [auth],
  );

  const requestVerifiedGolfer = useCallback(() => {
    if (auth.isDemo) {
      setData((prev) => ({
        ...prev,
        golfers: prev.golfers.map((g) =>
          g.id === prev.currentUserId ? { ...g, verification: { ...g.verification, verifiedGolfer: true } } : g,
        ),
      }));
    } else {
      auth.saveProfile({ verified_golfer: true }).catch((err) => console.error("Golf Me: failed to save profile.", err));
    }
  }, [auth]);

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
        // Demo mode has no booking-proof upload UI (Storage/RPCs are real-
        // account only) — every demo round is simply "manual".
        teeTimeSource: "manual",
      };
      setData((prev) => ({ ...prev, golfCalls: [call, ...prev.golfCalls] }));
      return call;
    },
    [data.currentUserId],
  );

  const cancelGolfCall = useCallback(
    async (callId: string) => {
      if (!auth.isDemo) {
        await realRounds.cancelRound(callId);
        return;
      }
      setData((prev) => ({
        ...prev,
        golfCalls: prev.golfCalls.map((c) => (c.id === callId ? { ...c, status: "cancelled" } : c)),
      }));
      addSystemMessage(callId, "The host cancelled this Golf Call.");
    },
    [auth.isDemo, realRounds, addSystemMessage],
  );

  // Demo-only prototype shortcut — real completion is completeGolfCall
  // below (host-triggered, real accounts only).
  const simulateCallCompletion = useCallback((callId: string) => {
    setData((prev) => ({
      ...prev,
      golfCalls: prev.golfCalls.map((c) => (c.id === callId ? { ...c, status: "completed" } : c)),
    }));
  }, []);

  // Real, host-only round completion — "keep the beta logic simple" means
  // this is a manual host action, not a scheduled job watching tee times.
  const completeGolfCall = useCallback(
    async (callId: string) => {
      if (!auth.isDemo) {
        await realRounds.completeRound(callId);
        return;
      }
      simulateCallCompletion(callId);
    },
    [auth.isDemo, realRounds, simulateCallCompletion],
  );

  const joinGolfCall = useCallback(
    async (callId: string) => {
      if (!auth.isDemo) {
        // Atomic, database-side overfill check (join_golf_call RPC) —
        // throws (e.g. "This round is full.") if someone else took the last
        // spot first; the caller surfaces that, never silently no-ops.
        await realRounds.joinRound(callId);
        return;
      }
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
    [auth.isDemo, realRounds, data.golfCalls, data.currentUserId, currentUser.name, addSystemMessage],
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
    async (callId: string) => {
      if (!auth.isDemo) {
        await realRounds.leaveRound(callId);
        return;
      }
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
    [auth.isDemo, realRounds, addSystemMessage, currentUser.name],
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
      if (!auth.isDemo) {
        realRounds.sendRoundMessage(callId, trimmed).catch((err) => console.error("Golf Me: failed to send round message.", err));
        return;
      }
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
    [auth.isDemo, realRounds],
  );

  const hasReviewed = useCallback(
    (callId: string, revieweeId: string) => {
      if (!auth.isDemo) return realRounds.hasReviewed(callId, revieweeId);
      return data.reviews.some((r) => r.golfCallId === callId && r.revieweeId === revieweeId && r.reviewerId === data.currentUserId);
    },
    [auth.isDemo, realRounds, data.reviews, data.currentUserId],
  );

  const submitReview = useCallback(
    (callId: string, revieweeId: string, input: ReviewInput) => {
      if (!auth.isDemo) {
        realRounds.submitReview(callId, revieweeId, input).catch((err) => console.error("Golf Me: failed to submit review.", err));
        return;
      }
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
    [auth.isDemo, realRounds],
  );

  const reportUser = useCallback(
    (
      reportedId: string,
      category: ReportCategory,
      details: string,
      context: Report["context"],
      meta?: { golfCallId?: string; postId?: string; commentId?: string },
    ) => {
      if (!auth.isDemo) {
        realSocial.reportUser(reportedId, category, details, context, { golfCallId: meta?.golfCallId }).catch((err) => console.error("Golf Me: failed to submit report.", err));
        return;
      }
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
    [auth.isDemo, realSocial],
  );

  const blockUser = useCallback(
    (blockedId: string) => {
      if (!auth.isDemo) {
        realSocial.blockUser(blockedId).catch((err) => console.error("Golf Me: failed to block user.", err));
        return;
      }
      setData((prev) => ({
        ...prev,
        blocks: [...prev.blocks, { blockerId: prev.currentUserId, blockedId, createdAt: new Date().toISOString() }],
      }));
    },
    [auth.isDemo, realSocial],
  );

  const unblockUser = useCallback(
    (blockedId: string) => {
      if (!auth.isDemo) {
        realSocial.unblockUser(blockedId).catch((err) => console.error("Golf Me: failed to unblock user.", err));
        return;
      }
      setData((prev) => ({
        ...prev,
        blocks: prev.blocks.filter((b) => !(b.blockerId === prev.currentUserId && b.blockedId === blockedId)),
      }));
    },
    [auth.isDemo, realSocial],
  );

  // golfCalls here is the branched variable (demo -> data.golfCalls, real ->
  // realRounds.golfCalls), not the raw mock data.golfCalls -- a real
  // account's "played with" signal must reflect its own real round history,
  // never the shared mock world's completed rounds.
  const hasPlayedWith = useCallback(
    (golferId: string) =>
      golfCalls.some((c) => c.status === "completed" && c.joinedGolferIds.includes(currentUser.id) && c.joinedGolferIds.includes(golferId)),
    [golfCalls, currentUser.id],
  );

  // Bulk form of hasPlayedWith — used by the "New Golfers" Group Type
  // preference check, which needs to test a whole round's roster at once.
  const playedWithIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of golfCalls) {
      if (c.status === "completed" && c.joinedGolferIds.includes(currentUser.id)) {
        for (const id of c.joinedGolferIds) if (id !== currentUser.id) ids.add(id);
      }
    }
    return ids;
  }, [golfCalls, currentUser.id]);

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

  // Demo-only now — the only caller is Auth.tsx's "Try Demo Account"
  // button. Explicitly flips into demo mode so currentUser/session read from
  // the mock golfers array rather than any real Supabase session.
  const logIn = useCallback(
    (userId: string) => {
      auth.enterDemoMode();
      setData((prev) => ({ ...prev, currentUserId: userId, session: { isLoggedIn: true, hasOnboarded: true } }));
    },
    [auth],
  );

  const logOut = useCallback(() => {
    if (auth.isDemo) {
      auth.exitDemoMode();
      setData((prev) => ({ ...prev, session: { ...prev.session, isLoggedIn: false } }));
    } else {
      void auth.signOut();
    }
  }, [auth]);

  const blockedByIds = useMemo(
    () => data.blocks.filter((b) => b.blockedId === currentUser.id).map((b) => b.blockerId),
    [data.blocks, currentUser.id],
  );
  const isBlockedBy = useCallback((id: string) => blockedByIds.includes(id), [blockedByIds]);

  const demoIsFollowing = useCallback(
    (id: string) => data.follows.some((f) => f.followerId === currentUser.id && f.followingId === id),
    [data.follows, currentUser.id],
  );

  const demoFollowUser = useCallback(
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

  const demoUnfollowUser = useCallback((golferId: string) => {
    setData((prev) => ({
      ...prev,
      follows: prev.follows.filter((f) => !(f.followerId === prev.currentUserId && f.followingId === golferId)),
    }));
  }, []);

  const demoFollowingGolfers = useMemo(
    () =>
      data.follows
        .filter((f) => f.followerId === currentUser.id)
        .map((f) => data.golfers.find((g) => g.id === f.followingId))
        .filter((g): g is GolferProfile => Boolean(g)),
    [data.follows, data.golfers, currentUser.id],
  );

  // Real accounts previously shared this exact block's mock state, keyed
  // off the mock blob's default currentUserId rather than the real user's
  // uuid — the write (followUser) and the read (isFollowing) used two
  // different identities, which is why Follow never reliably showed as
  // "Following" for a real account. Now branches to a real Supabase-backed
  // follows table (RealSocialContext) with proper optimistic update +
  // rollback-on-failure, same as the rest of this file's real/demo split.
  const isFollowing = useCallback((id: string) => (auth.isDemo ? demoIsFollowing(id) : realSocial.isFollowing(id)), [auth.isDemo, demoIsFollowing, realSocial]);
  const followingGolfers = auth.isDemo ? demoFollowingGolfers : realSocial.followingGolfers;
  const followUser = useCallback(
    async (golferId: string) => {
      if (auth.isDemo) {
        demoFollowUser(golferId);
        return;
      }
      await realSocial.followUser(golferId);
    },
    [auth.isDemo, demoFollowUser, realSocial],
  );
  const unfollowUser = useCallback(
    async (golferId: string) => {
      if (auth.isDemo) {
        demoUnfollowUser(golferId);
        return;
      }
      await realSocial.unfollowUser(golferId);
    },
    [auth.isDemo, demoUnfollowUser, realSocial],
  );

  // Messaging never requires following — Follow and Message are independent
  // actions. The only limits are the obvious ones: not yourself, and not
  // blocked in either direction. Real mode's version is also enforced at
  // the database level (see messages_insert_participant_not_blocked) — this
  // is UI-side, not the only line of defense.
  const canMessage = useCallback(
    (id: string) => {
      if (!auth.isDemo) return realSocial.canMessage(id);
      if (id === currentUser.id) return false;
      if (isBlocked(id) || isBlockedBy(id)) return false;
      return true;
    },
    [auth.isDemo, realSocial, currentUser.id, isBlocked, isBlockedBy],
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

  // Demo-only, intentionally not persisted to localStorage (unlike
  // dmReads) — a lightweight preview of the real feature, not a full
  // second implementation. Resets on reload, an acceptable demo-mode-only
  // limitation; the real per-account behavior is what's actually tested
  // and DB-enforced (see RealSocialContext's cleared_before/hidden_at).
  const [demoDmCleared, setDemoDmCleared] = useState<Record<string, string>>({});
  const [demoDmHidden, setDemoDmHidden] = useState<Record<string, string>>({});

  const messagesWithGolfer = useCallback(
    (golferId: string) => {
      if (!auth.isDemo) return realSocial.messagesWithGolfer(golferId);
      const convId = dmConversationId(currentUser.id, golferId);
      const clearedBefore = demoDmCleared[convId];
      return data.directMessages
        .filter((m) => m.conversationId === convId && (!clearedBefore || m.createdAt > clearedBefore))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    [auth.isDemo, realSocial, data.directMessages, currentUser.id, demoDmCleared],
  );

  // Returns whether the message actually sent, so the UI can tell a
  // rate-limited/blocked send apart from a normal successful one.
  const sendDirectMessage = useCallback(
    async (golferId: string, text: string): Promise<boolean> => {
      if (!auth.isDemo) return realSocial.sendDirectMessage(golferId, text);
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
    [auth.isDemo, realSocial, canMessage, canSendMessageNow, currentUser.id],
  );

  const markConversationRead = useCallback(
    async (golferId: string) => {
      if (!auth.isDemo) {
        await realSocial.markConversationRead(golferId);
        return;
      }
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
    [auth.isDemo, realSocial, currentUser.id],
  );

  const clearChatHistory = useCallback(
    async (golferId: string) => {
      if (!auth.isDemo) {
        await realSocial.clearChatHistory(golferId);
        return;
      }
      const convId = dmConversationId(currentUser.id, golferId);
      setDemoDmCleared((prev) => ({ ...prev, [convId]: new Date().toISOString() }));
    },
    [auth.isDemo, realSocial, currentUser.id],
  );

  const deleteConversation = useCallback(
    async (golferId: string) => {
      if (!auth.isDemo) {
        await realSocial.deleteConversation(golferId);
        return;
      }
      const convId = dmConversationId(currentUser.id, golferId);
      setDemoDmHidden((prev) => ({ ...prev, [convId]: new Date().toISOString() }));
    },
    [auth.isDemo, realSocial, currentUser.id],
  );

  const mockDmConversations = useMemo<DmConversation[]>(() => {
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
      const hiddenAt = demoDmHidden[conversationId];
      if (hiddenAt && lastMessage.createdAt <= hiddenAt) continue;
      const readState = data.dmReads.find((r) => r.conversationId === conversationId && r.userId === currentUser.id);
      const unread = lastMessage.senderId !== currentUser.id && (!readState || readState.lastReadAt < lastMessage.createdAt);
      conversations.push({ conversationId, otherGolfer, lastMessage, unread });
    }
    return conversations.sort((a, b) => b.lastMessage.createdAt.localeCompare(a.lastMessage.createdAt));
  }, [data.directMessages, data.dmReads, data.golfers, currentUser.id, blockedIds, blockedByIds, demoDmHidden]);

  const dmConversations = auth.isDemo ? mockDmConversations : realSocial.dmConversations;
  const hasUnreadMessages = auth.isDemo ? mockDmConversations.some((c) => c.unread) : realSocial.hasUnreadMessages;

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
  // Every function below now branches real vs demo — previously NONE of
  // them did, so every real account silently shared the same local/mock
  // blob and (worse) every write was attributed to a fixed mock placeholder
  // id (data.currentUserId, never updated for real accounts) instead of the
  // real signed-in user. See RealCommunityContext for the real-backed half.

  const posts = auth.isDemo ? data.posts : realCommunity.posts;
  const comments = auth.isDemo ? data.comments : realCommunity.comments;

  const demoGetPost = useCallback((id: string) => data.posts.find((p) => p.id === id), [data.posts]);
  const getPost = useCallback((id: string) => (auth.isDemo ? demoGetPost(id) : realCommunity.getPost(id)), [auth.isDemo, demoGetPost, realCommunity]);

  const demoIsPostHidden = useCallback(
    (postId: string) => data.hiddenPosts.some((h) => h.ownerId === currentUser.id && h.postId === postId),
    [data.hiddenPosts, currentUser.id],
  );
  const isPostHidden = useCallback(
    (postId: string) => (auth.isDemo ? demoIsPostHidden(postId) : realCommunity.isPostHidden(postId)),
    [auth.isDemo, demoIsPostHidden, realCommunity],
  );

  // Excludes anyone blocked in either direction and anything the current
  // user has individually hidden — the same block relationship used by
  // messaging and profiles, never a second "community block" list.
  const visiblePosts = useCallback(
    () => posts.filter((p) => !blockedIds.includes(p.authorId) && !blockedByIds.includes(p.authorId) && !isPostHidden(p.id)),
    [posts, blockedIds, blockedByIds, isPostHidden],
  );

  const demoCreatePost = useCallback(
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
  const createPost = useCallback(
    async (input: CreatePostInput): Promise<CommunityPost> => (auth.isDemo ? demoCreatePost(input) : realCommunity.createPost(input)),
    [auth.isDemo, demoCreatePost, realCommunity],
  );

  const demoDeletePost = useCallback((postId: string) => {
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
  const deletePost = useCallback(
    async (postId: string) => {
      if (auth.isDemo) {
        demoDeletePost(postId);
        return;
      }
      await realCommunity.deletePost(postId);
    },
    [auth.isDemo, demoDeletePost, realCommunity],
  );

  // Attaches a real Golf Call to the post it came from ("Create a Round
  // From This Post"). Demo fans out the two follow-up notification types
  // itself (mock pushNotification); the real path's equivalent fan-out
  // (round_created_from_post / post_became_round) happens via a database
  // trigger on community_posts (see the migration), not client-side, so it
  // can't be skipped by a client that forgets to call it.
  const demoAttachGolfCallToPost = useCallback(
    (postId: string, callId: string) => {
      const post = demoGetPost(postId);
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
    [demoGetPost, data.currentUserId, data.follows, data.comments, getGolfCall, currentUser.name, pushNotification],
  );
  const attachGolfCallToPost = useCallback(
    async (postId: string, callId: string) => {
      if (auth.isDemo) {
        demoAttachGolfCallToPost(postId, callId);
        return;
      }
      await realCommunity.attachGolfCallToPost(postId, callId);
    },
    [auth.isDemo, demoAttachGolfCallToPost, realCommunity],
  );

  const demoIsPostUpvoted = useCallback(
    (postId: string) => data.postVotes.some((v) => v.postId === postId && v.voterId === currentUser.id),
    [data.postVotes, currentUser.id],
  );
  const isPostUpvoted = useCallback(
    (postId: string) => (auth.isDemo ? demoIsPostUpvoted(postId) : realCommunity.isPostUpvoted(postId)),
    [auth.isDemo, demoIsPostUpvoted, realCommunity],
  );
  const demoPostUpvoteCount = useCallback((postId: string) => data.postVotes.filter((v) => v.postId === postId).length, [data.postVotes]);
  const postUpvoteCount = useCallback(
    (postId: string) => (auth.isDemo ? demoPostUpvoteCount(postId) : realCommunity.postUpvoteCount(postId)),
    [auth.isDemo, demoPostUpvoteCount, realCommunity],
  );
  const demoTogglePostUpvote = useCallback((postId: string) => {
    setData((prev) => {
      const existing = prev.postVotes.find((v) => v.postId === postId && v.voterId === prev.currentUserId);
      if (existing) return { ...prev, postVotes: prev.postVotes.filter((v) => v !== existing) };
      const vote: PostVote = { id: generateId("pv"), postId, voterId: prev.currentUserId, createdAt: new Date().toISOString() };
      return { ...prev, postVotes: [...prev.postVotes, vote] };
    });
  }, []);
  const togglePostUpvote = useCallback(
    async (postId: string) => {
      if (auth.isDemo) {
        demoTogglePostUpvote(postId);
        return;
      }
      await realCommunity.togglePostUpvote(postId);
    },
    [auth.isDemo, demoTogglePostUpvote, realCommunity],
  );

  const demoIsPostSaved = useCallback(
    (postId: string) => data.savedPosts.some((s) => s.ownerId === currentUser.id && s.postId === postId),
    [data.savedPosts, currentUser.id],
  );
  const isPostSaved = useCallback(
    (postId: string) => (auth.isDemo ? demoIsPostSaved(postId) : realCommunity.isPostSaved(postId)),
    [auth.isDemo, demoIsPostSaved, realCommunity],
  );
  const demoSavePost = useCallback((postId: string) => {
    setData((prev) => {
      const already = prev.savedPosts.some((s) => s.ownerId === prev.currentUserId && s.postId === postId);
      if (already) return prev;
      const saved: SavedPost = { id: generateId("sav"), ownerId: prev.currentUserId, postId, createdAt: new Date().toISOString() };
      return { ...prev, savedPosts: [...prev.savedPosts, saved] };
    });
  }, []);
  const savePost = useCallback(
    async (postId: string) => {
      if (auth.isDemo) {
        demoSavePost(postId);
        return;
      }
      await realCommunity.savePost(postId);
    },
    [auth.isDemo, demoSavePost, realCommunity],
  );
  const demoUnsavePost = useCallback((postId: string) => {
    setData((prev) => ({ ...prev, savedPosts: prev.savedPosts.filter((s) => !(s.ownerId === prev.currentUserId && s.postId === postId)) }));
  }, []);
  const unsavePost = useCallback(
    async (postId: string) => {
      if (auth.isDemo) {
        demoUnsavePost(postId);
        return;
      }
      await realCommunity.unsavePost(postId);
    },
    [auth.isDemo, demoUnsavePost, realCommunity],
  );
  const demoSavedPostsList = useMemo(
    () =>
      data.savedPosts
        .filter((s) => s.ownerId === currentUser.id)
        .map((s) => data.posts.find((p) => p.id === s.postId))
        .filter((p): p is CommunityPost => Boolean(p)),
    [data.savedPosts, data.posts, currentUser.id],
  );
  const realSavedPostsList = useMemo(
    () => realCommunity.savedPostIds.map((id) => realCommunity.posts.find((p) => p.id === id)).filter((p): p is CommunityPost => Boolean(p)),
    [realCommunity.savedPostIds, realCommunity.posts],
  );
  const savedPostsList = auth.isDemo ? demoSavedPostsList : realSavedPostsList;

  const demoHidePost = useCallback((postId: string) => {
    setData((prev) => {
      const already = prev.hiddenPosts.some((h) => h.ownerId === prev.currentUserId && h.postId === postId);
      if (already) return prev;
      return { ...prev, hiddenPosts: [...prev.hiddenPosts, { ownerId: prev.currentUserId, postId, createdAt: new Date().toISOString() }] };
    });
  }, []);
  const hidePost = useCallback(
    async (postId: string) => {
      if (auth.isDemo) {
        demoHidePost(postId);
        return;
      }
      await realCommunity.hidePost(postId);
    },
    [auth.isDemo, demoHidePost, realCommunity],
  );

  const demoCommentsForPost = useCallback(
    (postId: string) => data.comments.filter((c) => c.postId === postId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [data.comments],
  );
  const commentsForPost = useCallback(
    (postId: string) => (auth.isDemo ? demoCommentsForPost(postId) : realCommunity.commentsForPost(postId)),
    [auth.isDemo, demoCommentsForPost, realCommunity],
  );

  const demoCreateComment = useCallback(
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
        const post = demoGetPost(postId);
        if (post) pushNotification(post.authorId, "post_reply", `${currentUser.name} commented on your post.`, `/community/${postId}`, actorId);
      }
    },
    [data.currentUserId, data.comments, demoGetPost, currentUser.name, pushNotification],
  );
  const createComment = useCallback(
    async (postId: string, text: string, parentCommentId?: string) => {
      if (auth.isDemo) {
        demoCreateComment(postId, text, parentCommentId);
        return;
      }
      await realCommunity.createComment(postId, text, parentCommentId);
    },
    [auth.isDemo, demoCreateComment, realCommunity],
  );

  const demoDeleteComment = useCallback((commentId: string) => {
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
  const deleteComment = useCallback(
    async (commentId: string) => {
      if (auth.isDemo) {
        demoDeleteComment(commentId);
        return;
      }
      await realCommunity.deleteComment(commentId);
    },
    [auth.isDemo, demoDeleteComment, realCommunity],
  );

  const demoIsCommentUpvoted = useCallback(
    (commentId: string) => data.commentVotes.some((v) => v.commentId === commentId && v.voterId === currentUser.id),
    [data.commentVotes, currentUser.id],
  );
  const isCommentUpvoted = useCallback(
    (commentId: string) => (auth.isDemo ? demoIsCommentUpvoted(commentId) : realCommunity.isCommentUpvoted(commentId)),
    [auth.isDemo, demoIsCommentUpvoted, realCommunity],
  );
  const demoCommentUpvoteCount = useCallback(
    (commentId: string) => data.commentVotes.filter((v) => v.commentId === commentId).length,
    [data.commentVotes],
  );
  const commentUpvoteCount = useCallback(
    (commentId: string) => (auth.isDemo ? demoCommentUpvoteCount(commentId) : realCommunity.commentUpvoteCount(commentId)),
    [auth.isDemo, demoCommentUpvoteCount, realCommunity],
  );
  const demoToggleCommentUpvote = useCallback((commentId: string) => {
    setData((prev) => {
      const existing = prev.commentVotes.find((v) => v.commentId === commentId && v.voterId === prev.currentUserId);
      if (existing) return { ...prev, commentVotes: prev.commentVotes.filter((v) => v !== existing) };
      const vote: CommentVote = { id: generateId("cv"), commentId, voterId: prev.currentUserId, createdAt: new Date().toISOString() };
      return { ...prev, commentVotes: [...prev.commentVotes, vote] };
    });
  }, []);
  const toggleCommentUpvote = useCallback(
    async (commentId: string) => {
      if (auth.isDemo) {
        demoToggleCommentUpvote(commentId);
        return;
      }
      await realCommunity.toggleCommentUpvote(commentId);
    },
    [auth.isDemo, demoToggleCommentUpvote, realCommunity],
  );

  // Caddie — a real user's private AI swing-analysis history. Demo mode
  // gets its own openly-illustrative mock array (never persisted, reset on
  // reload); real accounts go through RealCaddieContext, whose RLS makes
  // this genuinely private (see the caddie_analyses migration). Neither
  // path ever fabricates a "complete" result for a real account — see
  // src/lib/swingAnalysis.ts.
  const caddieAnalyses = auth.isDemo ? demoCaddieAnalyses : realCaddie.analyses;
  const getCaddieAnalysis = useCallback((id: string) => caddieAnalyses.find((a) => a.id === id), [caddieAnalyses]);
  const createCaddieAnalysis = useCallback(
    async (input: CreateAnalysisInput): Promise<CaddieAnalysis> => {
      if (auth.isDemo) {
        const created: CaddieAnalysis = {
          id: generateId("caddie"),
          ownerId: currentUser.id,
          sourceType: input.sourceType,
          sourcePostId: input.sourcePostId,
          sourceMediaUrl: input.sourceMediaUrl,
          thumbnailUrl: input.thumbnailUrl,
          swingType: input.swingType,
          status: "pending",
          strengths: [],
          issues: [],
          recommendations: [],
          drills: [],
          sharedToCommunity: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setDemoCaddieAnalyses((prev) => [created, ...prev]);
        return created;
      }
      return realCaddie.createAnalysis(input);
    },
    [auth.isDemo, currentUser.id, realCaddie],
  );

  const mockNotifications = useMemo(
    () => data.notifications.filter((n) => n.userId === currentUser.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.notifications, currentUser.id],
  );
  const notifications = auth.isDemo ? mockNotifications : realSocial.notifications;
  const unreadNotificationCount = auth.isDemo ? mockNotifications.filter((n) => !n.read).length : realSocial.unreadNotificationCount;
  const markNotificationRead = useCallback(
    (id: string) => {
      if (!auth.isDemo) {
        realSocial.markNotificationRead(id).catch((err) => console.error("Golf Me: failed to mark notification read.", err));
        return;
      }
      setData((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) => (n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n)),
      }));
    },
    [auth.isDemo, realSocial],
  );
  const markAllNotificationsRead = useCallback(() => {
    if (!auth.isDemo) {
      realSocial.markAllNotificationsRead().catch((err) => console.error("Golf Me: failed to mark all notifications read.", err));
      return;
    }
    setData((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) => (n.userId === prev.currentUserId ? { ...n, read: true, readAt: new Date().toISOString() } : n)),
    }));
  }, [auth.isDemo, realSocial]);

  const resetDemoData = useCallback(() => {
    setData(resetToSeedData());
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({
      data,
      isLoading,
      currentUser,
      golfers: data.golfers,
      golfCalls,
      messages: data.messages,
      reviews: data.reviews,
      reports: data.reports,
      getGolfer,
      getGolfCall,
      messagesForCall,
      visibleGolfers,
      reviewsAbout,
      session,
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
      completeGolfCall,
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
      clearChatHistory,
      deleteConversation,
      posts,
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
      comments,
      commentsForPost,
      createComment,
      deleteComment,
      isCommentUpvoted,
      commentUpvoteCount,
      toggleCommentUpvote,
      caddieAnalyses,
      getCaddieAnalysis,
      createCaddieAnalysis,
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
      session,
      golfCalls,
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
      completeGolfCall,
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
      clearChatHistory,
      deleteConversation,
      posts,
      comments,
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
      caddieAnalyses,
      getCaddieAnalysis,
      createCaddieAnalysis,
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

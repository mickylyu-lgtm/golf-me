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
import type { ProfileFollowers } from "../lib/profileFollowers";
import { blockedContactRows } from "../lib/blockedContacts";
import type { BlockedContact } from "../lib/blockedContacts";
import type { GeoPoint } from "../lib/geo";
import { loadData, saveData, resetToSeedData } from "../lib/storage";
import { avatarColorForName, initialsFromName } from "../lib/avatar";
import { dmConversationId, otherParticipant } from "../lib/dm";
import { useAuth } from "./AuthContext";
import { placeholderGolferProfile, golferPatchToProfileRow } from "../lib/profile";
import type { SendMessageResult } from "../lib/objectionableContent";
import { useRealRounds } from "./RealRoundsContext";
import { useRealSocial } from "./RealSocialContext";
import { useRealCommunity } from "./RealCommunityContext";
import { useRealCaddie } from "./RealCaddieContext";
import type { CreateAnalysisInput } from "./RealCaddieContext";
import { buildDemoCaddieAnalyses } from "../data/caddie";
import { canSaveAnalysis, loadDemoSaved, storeDemoSaved } from "../lib/caddieSaved";

// localStorage can throw on access (blocked site data, some private modes).
function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
import { canUnsendMessage } from "../lib/unsend";
import type { UnsendResult } from "../lib/unsend";
import { demoEdit } from "../lib/messageEdit";
import type { EditResult } from "../lib/messageEdit";
import { DEMO_IMAGE_PREFIX } from "../lib/chatImages";
import type { ChatImageRef, ProcessedChatImage } from "../lib/chatImages";
import { chatImageUrls } from "../lib/chatImageClient";
import { DEMO_VOICE_PREFIX, clampDuration } from "../lib/chatVoice";
import type { ChatVoiceRef } from "../lib/chatVoice";
import { DEMO_MEDIA_PREFIX, localWindowUrl, toMediaSendItems } from "../lib/chatMedia";
import type { ChatMediaDraftItem, ChatMediaItem } from "../lib/chatMedia";
import { chatVideoUrls } from "../lib/chatVideoClient";
import type { VoiceClip } from "../lib/voiceRecorder";
import { claimVoiceSend, type SentVoiceClip } from "../lib/voiceSession";
import { withReaction } from "../lib/reactions";
import { placeholderNameFromEmail } from "../lib/authInput";
import type { MessageReaction, QuickReaction } from "../lib/reactions";

export interface DraftSwingVideo {
  file: File;
  previewUrl: string;
  swingType: string;
  // Set only when the source video was longer than Caddie's clip-length cap
  // and the golfer picked a window with VideoTrimSelector — undefined means
  // "analyze the whole (already-short) clip," not "starts at 0."
  trimStartSeconds?: number;
  trimEndSeconds?: number;
}

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
  // Only asked (and only ever real) when showedUp is true — undefined
  // otherwise, never a fabricated answer for a no-show.
  onTime?: boolean;
  respectful: boolean;
  wouldPlayAgain: boolean;
  // Always a real value — "not_sure" when a no-show skipped the question,
  // same as when it's genuinely asked but unknown.
  handicapAccuracy: HandicapAccuracy;
  privateNote?: string;
}

export interface CreatePostMediaInput {
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string;
}

export interface CreatePostInput {
  type: PostType;
  text: string;
  imageUrl?: string;
  media?: CreatePostMediaInput[]; // multi-photo/video posts, in display order
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
  ageRange?: AgeRange;
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
  /** A round chat is open (real accounts: also loads that round's newest page). Returns the unwatch. */
  watchRoundMessages: (callId: string) => () => void;
  /** An open round chat holds only its latest `held` messages; more exist (never in demo). */
  roundHistoryCut: (callId: string) => { cut: boolean; held: number };
  /** The DM window is full: older DM history may be missing (never in demo). */
  dmHistoryMayBeCut: boolean;
  visibleGolfers: (excludeSelf?: boolean) => GolferProfile[];
  reviewsAbout: (golferId: string) => Review[];

  session: SessionState;
  logIn: (userId: string) => void;
  logOut: () => void;
  signUpNewGolfer: (input: NewGolferInput) => GolferProfile;

  switchCurrentUser: (id: string) => void;
  updateCurrentUserProfile: (patch: Partial<GolferProfile>) => Promise<void>;
  setEmailVerified: (value: boolean) => void;
  syncDemoVerifiedGolfer: (value: boolean) => void;

  createGolfCall: (input: CreateGolfCallInput) => GolfCall;
  cancelGolfCall: (callId: string) => Promise<void>;
  simulateCallCompletion: (callId: string) => void;
  completeGolfCall: (callId: string) => Promise<void>;
  joinGolfCall: (callId: string) => Promise<void>;
  cancelJoinRequest: (callId: string) => void;
  leaveGolfCall: (callId: string) => Promise<void>;
  approveRequest: (callId: string, golferId: string) => void;
  declineRequest: (callId: string, golferId: string) => void;

  /** Round chat. Real: the message shows at once as sending; "failed" leaves it on screen as a failed bubble (retry/discard); "objectionable" leaves it as a "Not sent: ..." bubble (edit/discard, never resent). Demo: instant. */
  sendMessage: (callId: string, text: string, replyToId?: string | null) => Promise<SendMessageResult>;
  /** Re-sends a failed round message (a ChatMessage with delivery "failed"). No-op in demo. */
  retryRoundMessage: (message: ChatMessage) => Promise<SendMessageResult>;
  /** Drops a failed round message from this device. No-op in demo. */
  discardRoundMessage: (clientId: string) => void;
  // Round chat parity with DMs (migration 20261107130000): always in demo;
  // for real accounts each one once the database supports it
  // (RealRoundsContext feature detection).
  canReplyToRoundMessages: boolean;
  canUnsendRoundMessages: boolean;
  unsendRoundMessage: (messageId: string) => Promise<UnsendResult>;
  // Edit my text message within 5 minutes (lib/messageEdit.ts): always in
  // demo; for real accounts once the edit migration is applied.
  canEditRoundMessages: boolean;
  editRoundMessage: (messageId: string, text: string, expectedText?: string) => Promise<EditResult>;
  canReactToRoundMessages: boolean;
  // Photos in round chat (lib/chatImages.ts, migration 20261107170000):
  // always in demo (page-local photos); for real accounts once the database
  // has the image columns. Failures go through retryRoundMessage /
  // discardRoundMessage like text.
  canSendRoundImages: boolean;
  sendRoundImage: (callId: string, photo: ProcessedChatImage, text: string, replyToId?: string | null) => Promise<SendMessageResult>;
  // Voice messages in round chat (lib/chatVoice.ts, migration 20261107180000).
  // Videos and albums in round chat (lib/chatMedia.ts, migration 20261107220000).
  canSendRoundMedia: boolean;
  sendRoundMedia: (callId: string, items: ChatMediaDraftItem[], text: string, replyToId?: string | null) => Promise<SendMessageResult>;
  canSendRoundVoice: boolean;
  // The round is clip.origin (captured when the recording started), never a
  // page argument: a clip can only ever go to the conversation it was
  // recorded in (lib/voiceSession.ts claimVoiceSend).
  sendRoundVoice: (clip: SentVoiceClip, replyToId?: string | null) => Promise<SendMessageResult>;
  roundMessageReactions: MessageReaction[];
  setRoundMessageReaction: (messageId: string, emoji: QuickReaction | null) => Promise<boolean>;
  /** The current golfer was in this round and left it. */
  hasLeftGolfCall: (callId: string) => boolean;
  /** A block exists either way between the current golfer and this golfer. */
  isBlockedEitherWay: (id: string) => boolean;

  hasReviewed: (callId: string, revieweeId: string) => boolean;
  // Both resolve only once the server has the write (real accounts) and
  // reject on failure, so the forms can keep the input and offer a retry.
  submitReview: (callId: string, revieweeId: string, input: ReviewInput) => Promise<void>;

  reportUser: (
    reportedId: string,
    category: ReportCategory,
    details: string,
    context: Report["context"],
    meta?: { golfCallId?: string; postId?: string; commentId?: string; messageId?: string },
  ) => Promise<void>;
  // Reject on failure, so callers only confirm a block that actually saved.
  blockUser: (blockedId: string) => Promise<void>;
  unblockUser: (blockedId: string) => Promise<void>;
  isBlocked: (id: string) => boolean;
  blockedIds: string[];
  // Settings' unblock list: every block this account made, named where
  // allowed, golfer null otherwise ("Blocked contact"). Never drops a row
  // because a profile can't be resolved (lib/blockedContacts).
  blockedContacts: BlockedContact<GolferProfile>[];

  circleGolfers: GolferProfile[];
  isInCircle: (golferId: string) => boolean;
  addToCircle: (memberId: string) => void;
  hasPlayedWith: (golferId: string) => boolean;
  playedWithIds: Set<string>;

  // Following: "interested in playing with / keeping tabs on" — distinct
  // from Golf Circle ("actually played with, would again"). Never
  // auto-syncs into Golf Circle.
  followingGolfers: GolferProfile[];
  getFollowerCount: (id: string) => Promise<number>;
  getProfileFollowers: (id: string) => Promise<ProfileFollowers>;
  isFollowing: (golferId: string) => boolean;
  followUser: (golferId: string) => Promise<void>;
  unfollowUser: (golferId: string) => Promise<void>;

  // Direct messages between two golfers, gated by canMessage().
  canMessage: (golferId: string) => boolean;
  dmConversations: DmConversation[];
  hasUnreadMessages: boolean;
  messagesWithGolfer: (golferId: string) => DirectMessage[];
  sendDirectMessage: (golferId: string, text: string, replyToId?: string) => Promise<SendMessageResult>;
  // Whether swipe-to-reply can be offered: always in demo; for real accounts
  // only once the database has messages.reply_to_message_id (see
  // RealSocialContext.repliesSupported).
  canReplyToMessages: boolean;
  // Unsend within 5 minutes (lib/unsend.ts): always in demo; for real
  // accounts once the unsend migration is applied.
  canUnsendMessages: boolean;
  unsendDirectMessage: (messageId: string) => Promise<UnsendResult>;
  // Edit my text DM within 5 minutes (lib/messageEdit.ts): always in demo;
  // for real accounts once the edit migration is applied.
  canEditMessages: boolean;
  editDirectMessage: (messageId: string, text: string, expectedText?: string) => Promise<EditResult>;
  // Photos in DMs (lib/chatImages.ts): always in demo; for real accounts
  // once the database has messages.image_path. A failed photo send stays as
  // a "Not sent" bubble (delivery "failed") until retried or discarded.
  canSendDirectImages: boolean;
  sendDirectImage: (golferId: string, photo: ProcessedChatImage, text: string, replyToId?: string) => Promise<SendMessageResult>;
  retryDirectImage: (tempId: string) => Promise<SendMessageResult>;
  discardDirectImage: (tempId: string) => void;
  // Voice messages in DMs: same retry / discard as photos.
  // Videos and albums in DMs: same retry / discard as photos.
  canSendDirectMedia: boolean;
  sendDirectMedia: (golferId: string, items: ChatMediaDraftItem[], text: string, replyToId?: string) => Promise<SendMessageResult>;
  canSendDirectVoice: boolean;
  // The recipient is clip.origin, as sendRoundVoice.
  sendDirectVoice: (clip: SentVoiceClip, replyToId?: string) => Promise<SendMessageResult>;
  // Quick reactions (lib/reactions.ts): always in demo (page-local, not
  // persisted); for real accounts once public.message_reactions exists.
  canReactToMessages: boolean;
  messageReactions: MessageReaction[];
  // Set (or with null remove) my reaction; false = it failed and was rolled back.
  setMessageReaction: (messageId: string, emoji: QuickReaction | null) => Promise<boolean>;
  markConversationRead: (golferId: string) => Promise<void>;
  clearChatHistory: (golferId: string) => Promise<void>;
  deleteConversation: (golferId: string) => Promise<void>;

  // Ephemeral typing indicator -- real accounts only; demo has no real
  // second person to type, so this is always false/no-op there.
  isOtherTyping: (golferId: string) => boolean;
  typingConversationIds: Set<string>;
  sendTypingSignal: (golferId: string, active: boolean) => void;

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
  /** Try again on a failed analysis: re-runs the SAME row server-side (no new record). Demo: no-op that returns it unchanged. */
  retryCaddieAnalysis: (analysis: CaddieAnalysis) => Promise<CaddieAnalysis>;
  /** Deletes an analysis (not a live one) and its private files; never refunds the allowance. Demo: removes the fixture locally. */
  deleteCaddieAnalysis: (id: string) => Promise<void>;
  markCaddieAnalysisShared: (id: string) => Promise<void>;
  /** Saved swings: save / un-save a complete analysis. Optimistic; rejects (after putting it back) on failure. Demo: this device only. */
  setCaddieAnalysisSaved: (id: string, saved: boolean) => Promise<void>;
  /** Whether Save can be offered: always in demo; real accounts once migration 20261107210000 is applied. */
  caddieSavedSupported: boolean;
  translateCaddieAnalysis: (id: string, locale: string) => Promise<void>;
  // Lives here (DataProvider is mounted for the whole app session, unlike
  // AnalyzeSwing itself) so a video someone picked but hasn't submitted yet
  // survives navigating away from /caddie/analyze and back instead of being
  // silently lost.
  draftSwingVideo: DraftSwingVideo | undefined;
  setDraftSwingVideo: (draft: DraftSwingVideo | undefined) => void;

  notifications: AppNotification[];
  unreadNotificationCount: number;
  markNotificationRead: (id: string) => void;
  /** Batched: one update for all of them (real), one state change (demo). */
  markNotificationsRead: (ids: readonly string[]) => void;
  markAllNotificationsRead: () => void;

  resetDemoData: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

// Stable empty-Set reference for demo mode's typingConversationIds -- avoids
// handing consumers a brand-new Set() (and therefore a new reference) on
// every render, which would defeat any memoization keyed on it.
const EMPTY_TYPING_SET = new Set<string>();

export function DataProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const realRounds = useRealRounds();
  const realSocial = useRealSocial();
  const realCommunity = useRealCommunity();
  const realCaddie = useRealCaddie();
  const [demoCaddieAnalyses, setDemoCaddieAnalyses] = useState<CaddieAnalysis[]>(() => buildDemoCaddieAnalyses());
  const [draftSwingVideo, setDraftSwingVideoState] = useState<DraftSwingVideo | undefined>(undefined);
  const draftSwingVideoRef = useRef<DraftSwingVideo | undefined>(undefined);
  draftSwingVideoRef.current = draftSwingVideo;
  const setDraftSwingVideo = useCallback((draft: DraftSwingVideo | undefined) => {
    const previous = draftSwingVideoRef.current;
    if (previous && previous.previewUrl !== draft?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
    setDraftSwingVideoState(draft);
  }, []);
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
    // Never a Hide My Email relay's random local part as a name.
    if (auth.authUser) return placeholderGolferProfile(auth.authUser.id, placeholderNameFromEmail(auth.authUser.email));
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
  const allGolfCalls = auth.isDemo ? data.golfCalls : realRounds.golfCalls;
  const { isBlocked: realIsBlocked, isBlockedBy: realIsBlockedBy, getKnownProfile: realGetKnownProfile } = realSocial;
  // Blocking hides the other side's rounds in both directions (product
  // decision, health audit Batch C P1-5) -- a round hosted by someone you
  // blocked, or who blocked you, never appears in browse/Home/Auto-Match or
  // resolves via getGolfCall. Rounds you host or are already in stay
  // visible so an existing participant's own round list never breaks. Real
  // mode's join/chat block is also enforced in the database
  // (join_golf_call, round_messages_insert_member) -- this is the UI half.
  const golfCalls = useMemo(() => {
    const selfId = currentUser.id;
    const blockedEitherWay = (otherId: string) =>
      auth.isDemo
        ? data.blocks.some(
            (b) => (b.blockerId === selfId && b.blockedId === otherId) || (b.blockerId === otherId && b.blockedId === selfId),
          )
        : realIsBlocked(otherId) || realIsBlockedBy(otherId);
    return allGolfCalls.filter(
      (c) => c.hostId === selfId || c.joinedGolferIds.includes(selfId) || !blockedEitherWay(c.hostId),
    );
  }, [allGolfCalls, currentUser.id, auth.isDemo, data.blocks, realIsBlocked, realIsBlockedBy]);
  const getGolfer = useCallback(
    (id: string) => {
      if (auth.isDemo) return data.golfers.find((g) => g.id === id);
      if (id === currentUser.id) return currentUser;
      // getKnownProfile covers someone found via Discover/Find Friends who
      // isn't (yet) a round participant or DM/notification contact, and a
      // follower/followee who turned Discoverable off; community profiles
      // cover a post or comment author (hidden or not, their posts stay
      // visible). Without these, tapping such a golfer would incorrectly
      // resolve to "not found" on their profile page.
      return (
        realRounds.profilesById.get(id) ??
        realSocial.profilesById.get(id) ??
        realGetKnownProfile(id) ??
        realCommunity.profilesById.get(id)
      );
    },
    [auth.isDemo, data.golfers, currentUser, realRounds.profilesById, realSocial.profilesById, realGetKnownProfile, realCommunity.profilesById],
  );
  const getGolfCall = useCallback((id: string) => golfCalls.find((c) => c.id === id), [golfCalls]);
  // Same either-way check the golfCalls filter above uses.
  const isBlockedEitherWay = useCallback(
    (otherId: string) => {
      const selfId = currentUser.id;
      if (!otherId || otherId === selfId) return false;
      return auth.isDemo
        ? data.blocks.some((b) => (b.blockerId === selfId && b.blockedId === otherId) || (b.blockerId === otherId && b.blockedId === selfId))
        : realIsBlocked(otherId) || realIsBlockedBy(otherId);
    },
    [currentUser.id, auth.isDemo, data.blocks, realIsBlocked, realIsBlockedBy],
  );
  // Demo has no participant rows, so "left" is remembered for this session
  // only (cleared on rejoin). Real: round_participants.participant_status.
  const [demoLeftCallIds, setDemoLeftCallIds] = useState<ReadonlySet<string>>(() => new Set());
  const hasLeftGolfCall = useCallback(
    (callId: string) => (auth.isDemo ? demoLeftCallIds.has(callId) : realRounds.hasLeftRound(callId)),
    [auth.isDemo, demoLeftCallIds, realRounds],
  );
  const messagesForCall = useCallback(
    (callId: string) => {
      if (!auth.isDemo) return realRounds.messagesForCall(callId);
      return data.messages.filter((m) => m.golfCallId === callId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    [auth.isDemo, realRounds, data.messages],
  );
  const realWatchRoundMessages = realRounds.watchRoundMessages;
  const watchRoundMessages = useCallback(
    (callId: string) => (auth.isDemo ? () => {} : realWatchRoundMessages(callId)),
    [auth.isDemo, realWatchRoundMessages],
  );
  const realRoundHistoryCut = realRounds.roundHistoryCut;
  const roundHistoryCut = useCallback(
    (callId: string) => (auth.isDemo ? { cut: false, held: 0 } : realRoundHistoryCut(callId)),
    [auth.isDemo, realRoundHistoryCut],
  );
  const dmHistoryMayBeCut = !auth.isDemo && realSocial.messageHistoryCut;
  const reviewsAbout = useCallback((golferId: string) => data.reviews.filter((r) => r.revieweeId === golferId), [data.reviews]);

  const mockBlockedIds = useMemo(
    () => data.blocks.filter((b) => b.blockerId === currentUser.id).map((b) => b.blockedId),
    [data.blocks, currentUser.id],
  );
  const blockedIds = auth.isDemo ? mockBlockedIds : realSocial.blockedIds;
  const realBlockedContacts = realSocial.blockedContacts;
  const blockedContacts = useMemo(
    () =>
      auth.isDemo
        ? blockedContactRows(mockBlockedIds, new Set<string>(), [(id: string) => data.golfers.find((g) => g.id === id)])
        : realBlockedContacts,
    [auth.isDemo, mockBlockedIds, data.golfers, realBlockedContacts],
  );

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
      thisSave.catch((err) => console.error("GolfMe: failed to save profile.", err));
      profileSaveQueueRef.current = thisSave.catch(() => {});
      return thisSave;
    },
    [auth],
  );

  // Demo only. Real accounts: email confirmation is auth.users.email_confirmed_at
  // and the Verified Golfer badge is derived in Postgres (20261107230000); the
  // old profile columns are retired/server-owned, so nothing is written here.
  const setEmailVerified = useCallback(
    (value: boolean) => {
      if (!auth.isDemo) return;
      setData((prev) => ({
        ...prev,
        golfers: prev.golfers.map((g) =>
          g.id === prev.currentUserId ? { ...g, verification: { ...g.verification, emailVerified: value } } : g,
        ),
      }));
    },
    [auth],
  );

  // Demo only: mirrors the demo checklist onto the demo account so its own
  // badge shows on cards/profile. Real accounts never set the badge.
  const syncDemoVerifiedGolfer = useCallback(
    (value: boolean) => {
      if (!auth.isDemo) return;
      setData((prev) => {
        const me = prev.golfers.find((g) => g.id === prev.currentUserId);
        if (!me || me.verification.verifiedGolfer === value) return prev;
        return {
          ...prev,
          golfers: prev.golfers.map((g) =>
            g.id === prev.currentUserId ? { ...g, verification: { ...g.verification, verifiedGolfer: value } } : g,
          ),
        };
      });
    },
    [auth],
  );

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
      setDemoLeftCallIds((prev) => {
        if (!prev.has(callId)) return prev;
        const next = new Set(prev);
        next.delete(callId);
        return next;
      });
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
      setDemoLeftCallIds((prev) => new Set(prev).add(callId));
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
    async (callId: string, text: string, replyToId?: string | null): Promise<SendMessageResult> => {
      const trimmed = text.trim();
      if (!trimmed) return "failed";
      if (!auth.isDemo) {
        // Pending/sent/failed lives in RealRoundsContext (never throws): a
        // failure stays on screen as a "Not sent" bubble instead of vanishing.
        return realRounds.sendRoundMessage(callId, trimmed, replyToId);
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
            // Same rule the database enforces for real accounts: only a
            // message of this same round can be quoted.
            replyToId: replyToId && prev.messages.some((m) => m.id === replyToId && m.golfCallId === callId && !m.system) ? replyToId : null,
          },
        ],
      }));
      return "sent";
    },
    [auth.isDemo, realRounds],
  );

  // Demo photos: kept in this page's memory only (an object URL under a
  // demo-image/ key, lib/chatImageUrlCache); the message (with the tiny
  // placeholder) is saved like any demo message, so after a reload it shows
  // "Photo unavailable" over the blurred placeholder.
  const demoPhoto = useCallback((photo: ProcessedChatImage): ChatImageRef => {
    const path = `${DEMO_IMAGE_PREFIX}${generateId("photo")}`;
    chatImageUrls().setLocal(path, photo.previewUrl);
    return { path, width: photo.width, height: photo.height, thumb: photo.thumb };
  }, []);

  const canSendRoundImages = auth.isDemo || realRounds.imagesSupported;
  const sendRoundImage = useCallback(
    async (callId: string, photo: ProcessedChatImage, text: string, replyToId?: string | null): Promise<SendMessageResult> => {
      if (!auth.isDemo) return realRounds.sendRoundImage(callId, photo, text, replyToId);
      const image = demoPhoto(photo);
      setData((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: generateId("msg"),
            golfCallId: callId,
            senderId: prev.currentUserId,
            text: text.trim(),
            createdAt: new Date().toISOString(),
            replyToId: replyToId && prev.messages.some((m) => m.id === replyToId && m.golfCallId === callId && !m.system) ? replyToId : null,
            image,
          },
        ],
      }));
      return "sent";
    },
    [auth.isDemo, realRounds, demoPhoto],
  );

  // Demo voice: page-local like demo photos (after a reload it can't play).
  const demoVoice = useCallback((clip: VoiceClip): ChatVoiceRef => {
    const path = `${DEMO_VOICE_PREFIX}${generateId("voice")}`;
    chatImageUrls().setLocal(path, clip.localUrl);
    return { path, durationMs: clampDuration(clip.durationMs) };
  }, []);
  const canSendRoundVoice = auth.isDemo || realRounds.voiceSupported;
  const sendRoundVoice = useCallback(
    async (clip: SentVoiceClip, replyToId?: string | null): Promise<SendMessageResult> => {
      // Send-once (lib/voiceSession.ts): the first hand-over owns the
      // message and its bubble shows its real state; a repeat is dropped.
      // The round is the clip's own origin; a clip without one is refused.
      const claim = claimVoiceSend(clip, "round");
      if (!claim.ok) return claim.reason === "duplicate" ? "sent" : "failed";
      const callId = claim.to;
      if (!auth.isDemo) return realRounds.sendRoundVoice(callId, clip, replyToId);
      const voice = demoVoice(clip);
      setData((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: generateId("msg"),
            golfCallId: callId,
            senderId: prev.currentUserId,
            text: "",
            createdAt: new Date().toISOString(),
            replyToId: replyToId && prev.messages.some((m) => m.id === replyToId && m.golfCallId === callId && !m.system) ? replyToId : null,
            voice,
          },
        ],
      }));
      return "sent";
    },
    [auth.isDemo, realRounds, demoVoice],
  );

  // Demo videos / albums: page-local like demo photos (object URLs under
  // demo-media/ keys in the chat-video URL cache; a video plays only its
  // trimmed window via a media fragment). After a reload: "unavailable".
  const demoMedia = useCallback((draft: ChatMediaDraftItem[]): ChatMediaItem[] => {
    const base = `${DEMO_MEDIA_PREFIX}${generateId("media")}`;
    const urls = chatVideoUrls();
    return toMediaSendItems(draft).map((it, i) => {
      const path = `${base}/${i}`;
      urls.setLocal(path, it.kind === "video" ? localWindowUrl(it.localUrl, it.trim) : it.localUrl);
      if (it.kind === "video") {
        const poster = it.posterUrl ? `${base}/${i}.poster` : null;
        if (poster && it.posterUrl) urls.setLocal(poster, it.posterUrl);
        return { kind: "video", path, poster, width: it.width, height: it.height, durationMs: it.durationMs };
      }
      return { kind: "image", path, width: it.width, height: it.height, thumb: it.thumb };
    });
  }, []);
  const canSendRoundMedia = auth.isDemo || realRounds.mediaSupported;
  const sendRoundMedia = useCallback(
    async (callId: string, draft: ChatMediaDraftItem[], text: string, replyToId?: string | null): Promise<SendMessageResult> => {
      if (!auth.isDemo) return realRounds.sendRoundMedia(callId, draft, text, replyToId);
      const media = demoMedia(draft);
      setData((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: generateId("msg"),
            golfCallId: callId,
            senderId: prev.currentUserId,
            text: text.trim(),
            createdAt: new Date().toISOString(),
            replyToId: replyToId && prev.messages.some((m) => m.id === replyToId && m.golfCallId === callId && !m.system) ? replyToId : null,
            media,
          },
        ],
      }));
      return "sent";
    },
    [auth.isDemo, realRounds, demoMedia],
  );

  const canReplyToRoundMessages = auth.isDemo || realRounds.repliesSupported;
  const canUnsendRoundMessages = auth.isDemo || realRounds.unsendSupported;
  // Demo: same rule as public.unsend_round_message (my own message, within
  // the window), on the localStorage copy; the text is wiped there too.
  const unsendRoundMessage = useCallback(
    async (messageId: string): Promise<UnsendResult> => {
      if (!auth.isDemo) return realRounds.unsendRoundMessage(messageId);
      const target = data.messages.find((m) => m.id === messageId);
      if (!target || target.system || target.senderId !== currentUser.id) return "failed";
      if (target.unsentAt) return "unsent";
      if (!canUnsendMessage(target, currentUser.id, Date.now())) return "expired";
      const unsentAt = new Date().toISOString();
      setData((prev) => ({
        ...prev,
        messages: prev.messages.map((m) => (m.id === messageId ? { ...m, text: "", unsentAt, image: null, voice: null, media: null } : m)),
      }));
      setDemoRoundReactions((prev) => prev.filter((r) => r.messageId !== messageId));
      return "unsent";
    },
    [auth.isDemo, realRounds, data.messages, currentUser.id],
  );

  const canEditRoundMessages = auth.isDemo || realRounds.editSupported;
  // Demo: the same rules as public.edit_round_message (lib/messageEdit
  // demoEdit) on the localStorage copy.
  const editRoundMessage = useCallback(
    async (messageId: string, text: string, expectedText?: string): Promise<EditResult> => {
      if (!auth.isDemo) return realRounds.editRoundMessage(messageId, text, expectedText);
      const target = data.messages.find((m) => m.id === messageId);
      const outcome = demoEdit(target, currentUser.id, text, expectedText, Date.now());
      if (outcome.result === "edited") {
        setData((prev) => ({
          ...prev,
          messages: prev.messages.map((m) => (m.id === messageId ? { ...m, text: outcome.text!, editedAt: outcome.editedAt } : m)),
        }));
      }
      return outcome.result;
    },
    [auth.isDemo, realRounds, data.messages, currentUser.id],
  );

  // Demo round reactions: page-local like the DM ones (resets on reload),
  // same rules as the database (not on an unsent message, only while the
  // round is open/full). Cleared when the signed-in identity changes.
  const [demoRoundReactions, setDemoRoundReactions] = useState<MessageReaction[]>([]);
  const demoRoundReactionsOwner = auth.isDemo ? `demo:${currentUser.id}` : `real:${auth.authUser?.id ?? ""}`;
  useEffect(() => {
    setDemoRoundReactions((prev) => (prev.length === 0 ? prev : []));
  }, [demoRoundReactionsOwner]);
  const canReactToRoundMessages = auth.isDemo || realRounds.reactionsSupported;
  const roundMessageReactions = auth.isDemo ? demoRoundReactions : realRounds.roundReactions;
  const setRoundMessageReaction = useCallback(
    async (messageId: string, emoji: QuickReaction | null): Promise<boolean> => {
      if (!auth.isDemo) return realRounds.setRoundReaction(messageId, emoji);
      const target = data.messages.find((m) => m.id === messageId);
      if (!target || target.system || target.unsentAt) return false;
      const status = data.golfCalls.find((c) => c.id === target.golfCallId)?.status;
      if (status !== "open" && status !== "full") return false;
      setDemoRoundReactions((prev) => withReaction(prev, messageId, currentUser.id, emoji));
      return true;
    },
    [auth.isDemo, realRounds, data.messages, data.golfCalls, currentUser.id],
  );

  const retryRoundMessage = useCallback(
    async (message: ChatMessage): Promise<SendMessageResult> => {
      if (auth.isDemo || !message.clientId) return "failed";
      return realRounds.retryRoundMessage({ clientId: message.clientId, roundId: message.golfCallId, text: message.text, replyToId: message.replyToId });
    },
    [auth.isDemo, realRounds],
  );
  const discardRoundMessage = useCallback(
    (clientId: string) => {
      if (!auth.isDemo) realRounds.discardRoundMessage(clientId);
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
    async (callId: string, revieweeId: string, input: ReviewInput) => {
      if (!auth.isDemo) {
        // Awaited: ReviewModal shows success only after the RPC answers.
        await realRounds.submitReview(callId, revieweeId, input);
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
    async (
      reportedId: string,
      category: ReportCategory,
      details: string,
      context: Report["context"],
      meta?: { golfCallId?: string; postId?: string; commentId?: string; messageId?: string },
    ) => {
      if (!auth.isDemo) {
        // The whole target goes through (it used to forward only the round
        // id), and failures reach the form instead of the console.
        await realSocial.reportUser(reportedId, category, details, context, meta);
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
    async (blockedId: string) => {
      if (!auth.isDemo) {
        await realSocial.blockUser(blockedId).catch((err) => {
          console.error("GolfMe: failed to block user.", err);
          throw err;
        });
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
    async (blockedId: string) => {
      if (!auth.isDemo) {
        await realSocial.unblockUser(blockedId).catch((err) => {
          console.error("GolfMe: failed to unblock user.", err);
          throw err;
        });
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

  // Demo Golf Circle: the mock localStorage circle. Real accounts branch
  // below (after the follow helpers) onto real follows.
  const demoCircleGolfers = useMemo(
    () =>
      data.circle
        .filter((c) => c.ownerId === currentUser.id)
        .map((c) => data.golfers.find((g) => g.id === c.memberId))
        .filter((g): g is GolferProfile => Boolean(g)),
    [data.circle, data.golfers, currentUser.id],
  );

  const demoIsInCircle = useCallback(
    (golferId: string) => data.circle.some((c) => c.ownerId === currentUser.id && c.memberId === golferId),
    [data.circle, currentUser.id],
  );

  const demoAddToCircle = useCallback((memberId: string) => {
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
      // Same rule as the server (20261108150000): once per follower per
      // golfer, ever (unfollow + re-follow never repeats it), never across a
      // block. pushNotification already skips yourself.
      if (isBlockedEitherWay(golferId)) return;
      const already = data.notifications.some((n) => n.userId === golferId && n.type === "new_follower" && n.actorId === currentUser.id);
      if (!already) pushNotification(golferId, "new_follower", `${currentUser.name} followed you.`, `/golfer/${currentUser.id}`, currentUser.id);
    },
    [pushNotification, isBlockedEitherWay, data.notifications, currentUser.name, currentUser.id],
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
  const { getFollowerCount: realFollowerCount, getProfileFollowers: realProfileFollowers } = realSocial;
  const getFollowerCount = useCallback(async (id: string) => {
    if (!auth.isDemo) return realFollowerCount(id);
    return data.follows.filter((f) => f.followingId === id).length;
  }, [auth.isDemo, data.follows, realFollowerCount]);
  const getProfileFollowers = useCallback(async (id: string): Promise<ProfileFollowers> => {
    if (!auth.isDemo) return realProfileFollowers(id);
    const ids = new Set(data.follows.filter((f) => f.followingId === id).map((f) => f.followerId));
    return { total: ids.size, mutualIds: data.follows.filter((f) => f.followerId === currentUser.id && ids.has(f.followingId)).map((f) => f.followingId), golfers: data.golfers.filter((g) => ids.has(g.id) && !isBlockedEitherWay(g.id)) };
  }, [auth.isDemo, data.follows, data.golfers, currentUser.id, isBlockedEitherWay, realProfileFollowers]);
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

  // Golf Circle = "golfers you've played with and would play with again".
  // Real accounts have no circle table — the old mock-localStorage write
  // under a mock id meant "Add to Golf Circle" silently did nothing. Real
  // circle is derived from real data instead: golfers you follow AND have
  // completed a round with; adding someone follows them (the Add button only
  // shows for people you've played with).
  const circleGolfers = useMemo(
    () => (auth.isDemo ? demoCircleGolfers : followingGolfers.filter((g) => playedWithIds.has(g.id))),
    [auth.isDemo, demoCircleGolfers, followingGolfers, playedWithIds],
  );
  const isInCircle = useCallback(
    (golferId: string) => (auth.isDemo ? demoIsInCircle(golferId) : isFollowing(golferId) && playedWithIds.has(golferId)),
    [auth.isDemo, demoIsInCircle, isFollowing, playedWithIds],
  );
  const addToCircle = useCallback(
    (memberId: string) => {
      if (auth.isDemo) {
        demoAddToCircle(memberId);
        return;
      }
      if (isFollowing(memberId)) return;
      followUser(memberId).catch((err) => console.error("GolfMe: failed to add to Golf Circle.", err));
    },
    [auth.isDemo, demoAddToCircle, isFollowing, followUser],
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
    async (golferId: string, text: string, replyToId?: string): Promise<SendMessageResult> => {
      if (!auth.isDemo) return realSocial.sendDirectMessage(golferId, text, replyToId);
      const trimmed = text.trim();
      if (!trimmed || !canMessage(golferId) || !canSendMessageNow()) return "failed";
      const convId = dmConversationId(currentUser.id, golferId);
      setData((prev) => ({
        ...prev,
        directMessages: [
          ...prev.directMessages,
          {
            id: generateId("dm"),
            conversationId: convId,
            senderId: prev.currentUserId,
            text: trimmed,
            createdAt: new Date().toISOString(),
            // Same rule the database enforces for real accounts: only a
            // message in this same conversation can be quoted.
            replyToId: replyToId && prev.directMessages.some((m) => m.id === replyToId && m.conversationId === convId) ? replyToId : null,
          },
        ],
      }));
      return "sent";
    },
    [auth.isDemo, realSocial, canMessage, canSendMessageNow, currentUser.id],
  );

  const canReplyToMessages = auth.isDemo || realSocial.repliesSupported;

  const canSendDirectImages = auth.isDemo || realSocial.imagesSupported;
  const sendDirectImage = useCallback(
    async (golferId: string, photo: ProcessedChatImage, text: string, replyToId?: string): Promise<SendMessageResult> => {
      if (!auth.isDemo) return realSocial.sendDirectImage(golferId, photo, text, replyToId);
      if (!canMessage(golferId) || !canSendMessageNow()) return "failed";
      const convId = dmConversationId(currentUser.id, golferId);
      const image = demoPhoto(photo);
      setData((prev) => ({
        ...prev,
        directMessages: [
          ...prev.directMessages,
          {
            id: generateId("dm"),
            conversationId: convId,
            senderId: prev.currentUserId,
            text: text.trim(),
            createdAt: new Date().toISOString(),
            replyToId: replyToId && prev.directMessages.some((m) => m.id === replyToId && m.conversationId === convId) ? replyToId : null,
            image,
          },
        ],
      }));
      return "sent";
    },
    [auth.isDemo, realSocial, canMessage, canSendMessageNow, currentUser.id, demoPhoto],
  );
  const canSendDirectVoice = auth.isDemo || realSocial.voiceSupported;
  const sendDirectVoice = useCallback(
    async (clip: SentVoiceClip, replyToId?: string): Promise<SendMessageResult> => {
      // Send-once and the recipient from the clip's origin, as sendRoundVoice.
      const claim = claimVoiceSend(clip, "dm");
      if (!claim.ok) return claim.reason === "duplicate" ? "sent" : "failed";
      const golferId = claim.to;
      if (!auth.isDemo) return realSocial.sendDirectVoice(golferId, clip, replyToId);
      if (!canMessage(golferId) || !canSendMessageNow()) return "failed";
      const convId = dmConversationId(currentUser.id, golferId);
      const voice = demoVoice(clip);
      setData((prev) => ({
        ...prev,
        directMessages: [
          ...prev.directMessages,
          {
            id: generateId("dm"),
            conversationId: convId,
            senderId: prev.currentUserId,
            text: "",
            createdAt: new Date().toISOString(),
            replyToId: replyToId && prev.directMessages.some((m) => m.id === replyToId && m.conversationId === convId) ? replyToId : null,
            voice,
          },
        ],
      }));
      return "sent";
    },
    [auth.isDemo, realSocial, canMessage, canSendMessageNow, currentUser.id, demoVoice],
  );
  // Videos / albums in DMs (migration 20261107220000): same retry / discard as photos.
  const canSendDirectMedia = auth.isDemo || realSocial.mediaSupported;
  const sendDirectMedia = useCallback(
    async (golferId: string, draft: ChatMediaDraftItem[], text: string, replyToId?: string): Promise<SendMessageResult> => {
      if (!auth.isDemo) return realSocial.sendDirectMedia(golferId, draft, text, replyToId);
      if (!canMessage(golferId) || !canSendMessageNow()) return "failed";
      const convId = dmConversationId(currentUser.id, golferId);
      const media = demoMedia(draft);
      setData((prev) => ({
        ...prev,
        directMessages: [
          ...prev.directMessages,
          {
            id: generateId("dm"),
            conversationId: convId,
            senderId: prev.currentUserId,
            text: text.trim(),
            createdAt: new Date().toISOString(),
            replyToId: replyToId && prev.directMessages.some((m) => m.id === replyToId && m.conversationId === convId) ? replyToId : null,
            media,
          },
        ],
      }));
      return "sent";
    },
    [auth.isDemo, realSocial, canMessage, canSendMessageNow, currentUser.id, demoMedia],
  );
  const retryDirectImage = useCallback(
    async (tempId: string): Promise<SendMessageResult> => (auth.isDemo ? "failed" : realSocial.retryDirectImage(tempId)),
    [auth.isDemo, realSocial],
  );
  const discardDirectImage = useCallback(
    (tempId: string) => {
      if (!auth.isDemo) realSocial.discardDirectImage(tempId);
    },
    [auth.isDemo, realSocial],
  );

  const canUnsendMessages = auth.isDemo || realSocial.unsendSupported;
  // Demo: same rule as the database (own message, within the window), on
  // the localStorage copy; the text is wiped there too.
  const unsendDirectMessage = useCallback(
    async (messageId: string): Promise<UnsendResult> => {
      if (!auth.isDemo) return realSocial.unsendDirectMessage(messageId);
      const target = data.directMessages.find((m) => m.id === messageId);
      if (!target || target.senderId !== currentUser.id) return "failed";
      if (target.unsentAt) return "unsent";
      if (!canUnsendMessage(target, currentUser.id, Date.now())) return "expired";
      const unsentAt = new Date().toISOString();
      setData((prev) => ({
        ...prev,
        directMessages: prev.directMessages.map((m) => (m.id === messageId ? { ...m, text: "", unsentAt, image: null, voice: null, media: null } : m)),
      }));
      setDemoReactions((prev) => prev.filter((r) => r.messageId !== messageId));
      return "unsent";
    },
    [auth.isDemo, realSocial, data.directMessages, currentUser.id],
  );

  const canEditMessages = auth.isDemo || realSocial.editSupported;
  // Demo: the same rules as public.edit_message (lib/messageEdit demoEdit)
  // on the localStorage copy.
  const editDirectMessage = useCallback(
    async (messageId: string, text: string, expectedText?: string): Promise<EditResult> => {
      if (!auth.isDemo) return realSocial.editDirectMessage(messageId, text, expectedText);
      const target = data.directMessages.find((m) => m.id === messageId);
      const outcome = demoEdit(target, currentUser.id, text, expectedText, Date.now());
      if (outcome.result === "edited") {
        setData((prev) => ({
          ...prev,
          directMessages: prev.directMessages.map((m) => (m.id === messageId ? { ...m, text: outcome.text!, editedAt: outcome.editedAt } : m)),
        }));
      }
      return outcome.result;
    },
    [auth.isDemo, realSocial, data.directMessages, currentUser.id],
  );

  // Demo reactions: page-local state, like demoDmCleared (resets on
  // reload); same rules as the database (not on an unsent message, not
  // across a block). No request, so nothing can resolve out of order: each
  // tap is applied synchronously, in tap order, as a functional update (the
  // latest tap always wins). Cleared when the signed-in identity changes
  // (sign-out, demo <-> real, another account), so nothing carries over.
  const [demoReactions, setDemoReactions] = useState<MessageReaction[]>([]);
  const demoReactionsOwner = auth.isDemo ? `demo:${currentUser.id}` : `real:${auth.authUser?.id ?? ""}`;
  useEffect(() => {
    setDemoReactions((prev) => (prev.length === 0 ? prev : []));
  }, [demoReactionsOwner]);
  const canReactToMessages = auth.isDemo || realSocial.reactionsSupported;
  const messageReactions = auth.isDemo ? demoReactions : realSocial.messageReactions;
  const setMessageReaction = useCallback(
    async (messageId: string, emoji: QuickReaction | null): Promise<boolean> => {
      if (!auth.isDemo) return realSocial.setMessageReaction(messageId, emoji);
      const target = data.directMessages.find((m) => m.id === messageId);
      if (!target || target.unsentAt) return false;
      if (emoji && !canMessage(otherParticipant(target.conversationId, currentUser.id))) return false;
      setDemoReactions((prev) => withReaction(prev, messageId, currentUser.id, emoji));
      return true;
    },
    [auth.isDemo, realSocial, data.directMessages, currentUser.id, canMessage],
  );

  // Demo accounts have no real second person who could be typing -- always
  // false/no-op rather than simulating a fake typing partner.
  const isOtherTyping = useCallback((golferId: string) => (auth.isDemo ? false : realSocial.isOtherTyping(golferId)), [auth.isDemo, realSocial]);
  const typingConversationIds = auth.isDemo ? EMPTY_TYPING_SET : realSocial.typingConversationIds;
  const sendTypingSignal = useCallback(
    (golferId: string, active: boolean) => {
      if (!auth.isDemo) realSocial.sendTypingSignal(golferId, active);
    },
    [auth.isDemo, realSocial],
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
      bio: "New to GolfMe — excited to find my next round.",
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
        media: input.media?.map((m) => ({ id: generateId("postmedia"), type: m.type, url: m.url, thumbnailUrl: m.thumbnailUrl })),
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
  const demoTogglePostUpvote = useCallback(
    (postId: string) => {
      const actorId = data.currentUserId;
      const liking = !data.postVotes.some((v) => v.postId === postId && v.voterId === actorId);
      setData((prev) => {
        const existing = prev.postVotes.find((v) => v.postId === postId && v.voterId === prev.currentUserId);
        if (existing) return { ...prev, postVotes: prev.postVotes.filter((v) => v !== existing) };
        const vote: PostVote = { id: generateId("pv"), postId, voterId: prev.currentUserId, createdAt: new Date().toISOString() };
        return { ...prev, postVotes: [...prev.postVotes, vote] };
      });
      // Same rule as the server (20261107200000): once per liker per post,
      // ever, never across a block; unliking keeps it. pushNotification
      // already skips your own post.
      if (!liking) return;
      const post = demoGetPost(postId);
      if (!post || isBlockedEitherWay(post.authorId)) return;
      const link = `/community/${postId}`;
      const already = data.notifications.some((n) => n.type === "post_liked" && n.actorId === actorId && n.linkTo === link);
      if (!already) pushNotification(post.authorId, "post_liked", `${currentUser.name} liked your post.`, link, actorId);
    },
    [data.currentUserId, data.postVotes, data.notifications, demoGetPost, isBlockedEitherWay, currentUser.name, pushNotification],
  );
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
  // Demo saves live in localStorage (fixture rows only, nothing personal),
  // keyed by analysis id; a deleted or re-seeded row simply drops out.
  const [demoSaved, setDemoSaved] = useState<Record<string, string>>(() =>
    loadDemoSaved(typeof window === "undefined" ? undefined : safeLocalStorage()),
  );
  const demoCaddieWithSaved = useMemo(
    () => demoCaddieAnalyses.map((a) => (demoSaved[a.id] && a.status === "complete" ? { ...a, savedAt: demoSaved[a.id] } : a)),
    [demoCaddieAnalyses, demoSaved],
  );
  const caddieAnalyses = auth.isDemo ? demoCaddieWithSaved : realCaddie.analyses;
  const getCaddieAnalysis = useCallback((id: string) => caddieAnalyses.find((a) => a.id === id), [caddieAnalyses]);
  const createCaddieAnalysis = useCallback(
    async (input: CreateAnalysisInput): Promise<CaddieAnalysis> => {
      if (auth.isDemo) {
        const created: CaddieAnalysis = {
          id: generateId("caddie"),
          ownerId: currentUser.id,
          sourceType: input.sourceType,
          sourcePostId: input.sourcePostId,
          sourceMediaUrl: input.sourceMediaUrl ?? "",
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

  const retryCaddieAnalysis = useCallback(
    async (analysis: CaddieAnalysis): Promise<CaddieAnalysis> => {
      // Demo analyses never fail (fixtures only), so there's nothing to re-run.
      if (auth.isDemo) return analysis;
      return realCaddie.retryAnalysis(analysis);
    },
    [auth.isDemo, realCaddie],
  );

  const deleteCaddieAnalysis = useCallback(
    async (id: string): Promise<void> => {
      if (auth.isDemo) {
        setDemoCaddieAnalyses((prev) => prev.filter((a) => a.id !== id));
        return;
      }
      await realCaddie.deleteAnalysis(id);
    },
    [auth.isDemo, realCaddie],
  );
  const markCaddieAnalysisShared = useCallback(
    async (id: string) => {
      if (auth.isDemo) {
        setDemoCaddieAnalyses((prev) => prev.map((a) => (a.id === id ? { ...a, sharedToCommunity: true } : a)));
        return;
      }
      await realCaddie.markShared(id);
    },
    [auth.isDemo, realCaddie],
  );
  const setCaddieAnalysisSaved = useCallback(
    async (id: string, saved: boolean) => {
      if (auth.isDemo) {
        const target = demoCaddieAnalyses.find((a) => a.id === id);
        if (saved && (!target || !canSaveAnalysis(target))) throw new Error("Only a finished analysis can be saved.");
        setDemoSaved((prev) => {
          const next = { ...prev };
          if (saved) next[id] = prev[id] ?? new Date().toISOString();
          else delete next[id];
          storeDemoSaved(safeLocalStorage(), next);
          return next;
        });
        return;
      }
      await realCaddie.setSaved(id, saved);
    },
    [auth.isDemo, demoCaddieAnalyses, realCaddie],
  );
  const caddieSavedSupported = auth.isDemo || realCaddie.savedSupported;
  const translateCaddieAnalysis = useCallback(
    async (id: string, locale: string) => {
      // Demo's history is static fixture data with no real Gemini pipeline
      // behind it (see src/data/caddie.ts) — nothing to actually call.
      if (auth.isDemo) return;
      await realCaddie.translateAnalysis(id, locale);
    },
    [auth.isDemo, realCaddie],
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
        realSocial.markNotificationRead(id).catch((err) => console.error("GolfMe: failed to mark notification read.", err));
        return;
      }
      setData((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) => (n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n)),
      }));
    },
    [auth.isDemo, realSocial],
  );
  const markNotificationsRead = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return;
      if (!auth.isDemo) {
        realSocial.markNotificationsRead(ids).catch((err) => console.error("GolfMe: failed to mark notifications read.", err));
        return;
      }
      const wanted = new Set(ids);
      setData((prev) => {
        if (!prev.notifications.some((n) => wanted.has(n.id) && !n.read)) return prev;
        const readAt = new Date().toISOString();
        return { ...prev, notifications: prev.notifications.map((n) => (wanted.has(n.id) && !n.read ? { ...n, read: true, readAt } : n)) };
      });
    },
    [auth.isDemo, realSocial],
  );
  const markAllNotificationsRead = useCallback(() => {
    if (!auth.isDemo) {
      realSocial.markAllNotificationsRead().catch((err) => console.error("GolfMe: failed to mark all notifications read.", err));
      return;
    }
    setData((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) => (n.userId === prev.currentUserId ? { ...n, read: true, readAt: new Date().toISOString() } : n)),
    }));
  }, [auth.isDemo, realSocial]);

  const resetDemoData = useCallback(() => {
    setData(resetToSeedData());
    setDemoSaved({});
    storeDemoSaved(safeLocalStorage(), {});
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
      watchRoundMessages,
      roundHistoryCut,
      dmHistoryMayBeCut,
      visibleGolfers,
      reviewsAbout,
      session,
      logIn,
      logOut,
      signUpNewGolfer,
      switchCurrentUser,
      updateCurrentUserProfile,
      setEmailVerified,
      syncDemoVerifiedGolfer,
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
      retryRoundMessage,
      discardRoundMessage,
      canReplyToRoundMessages,
      canUnsendRoundMessages,
      unsendRoundMessage,
      canEditRoundMessages,
      editRoundMessage,
      canReactToRoundMessages,
      canSendRoundImages,
      sendRoundImage,
      canSendRoundVoice,
      sendRoundVoice,
      canSendRoundMedia,
      sendRoundMedia,
      roundMessageReactions,
      setRoundMessageReaction,
      hasLeftGolfCall,
      isBlockedEitherWay,
      hasReviewed,
      submitReview,
      reportUser,
      blockUser,
      unblockUser,
      isBlocked,
      blockedIds,
      blockedContacts,
      circleGolfers,
      isInCircle,
      addToCircle,
      hasPlayedWith,
      playedWithIds,
      followingGolfers,
      getFollowerCount,
      getProfileFollowers,
      isFollowing,
      followUser,
      unfollowUser,
      canMessage,
      dmConversations,
      hasUnreadMessages,
      messagesWithGolfer,
      sendDirectMessage,
      canReplyToMessages,
      canUnsendMessages,
      unsendDirectMessage,
      canEditMessages,
      editDirectMessage,
      canSendDirectImages,
      sendDirectImage,
      retryDirectImage,
      discardDirectImage,
      canSendDirectVoice,
      sendDirectVoice,
      canSendDirectMedia,
      sendDirectMedia,
      canReactToMessages,
      messageReactions,
      setMessageReaction,
      markConversationRead,
      clearChatHistory,
      deleteConversation,
      isOtherTyping,
      typingConversationIds,
      sendTypingSignal,
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
      retryCaddieAnalysis,
      deleteCaddieAnalysis,
      markCaddieAnalysisShared,
      setCaddieAnalysisSaved,
      caddieSavedSupported,
      translateCaddieAnalysis,
      draftSwingVideo,
      setDraftSwingVideo,
      notifications,
      unreadNotificationCount,
      markNotificationRead,
      markNotificationsRead,
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
      watchRoundMessages,
      roundHistoryCut,
      dmHistoryMayBeCut,
      visibleGolfers,
      reviewsAbout,
      logIn,
      logOut,
      signUpNewGolfer,
      switchCurrentUser,
      updateCurrentUserProfile,
      setEmailVerified,
      syncDemoVerifiedGolfer,
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
      retryRoundMessage,
      discardRoundMessage,
      canReplyToRoundMessages,
      canUnsendRoundMessages,
      unsendRoundMessage,
      canEditRoundMessages,
      editRoundMessage,
      canReactToRoundMessages,
      canSendRoundImages,
      sendRoundImage,
      canSendRoundVoice,
      sendRoundVoice,
      canSendRoundMedia,
      sendRoundMedia,
      roundMessageReactions,
      setRoundMessageReaction,
      hasLeftGolfCall,
      isBlockedEitherWay,
      hasReviewed,
      submitReview,
      reportUser,
      blockUser,
      unblockUser,
      isBlocked,
      blockedIds,
      blockedContacts,
      circleGolfers,
      isInCircle,
      addToCircle,
      hasPlayedWith,
      playedWithIds,
      followingGolfers,
      getFollowerCount,
      getProfileFollowers,
      isFollowing,
      followUser,
      unfollowUser,
      canMessage,
      dmConversations,
      hasUnreadMessages,
      messagesWithGolfer,
      sendDirectMessage,
      canReplyToMessages,
      canUnsendMessages,
      unsendDirectMessage,
      canEditMessages,
      editDirectMessage,
      canSendDirectImages,
      sendDirectImage,
      retryDirectImage,
      discardDirectImage,
      canSendDirectVoice,
      sendDirectVoice,
      canSendDirectMedia,
      sendDirectMedia,
      canReactToMessages,
      messageReactions,
      setMessageReaction,
      markConversationRead,
      clearChatHistory,
      deleteConversation,
      isOtherTyping,
      typingConversationIds,
      sendTypingSignal,
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
      retryCaddieAnalysis,
      deleteCaddieAnalysis,
      markCaddieAnalysisShared,
      setCaddieAnalysisSaved,
      caddieSavedSupported,
      translateCaddieAnalysis,
      draftSwingVideo,
      setDraftSwingVideo,
      notifications,
      unreadNotificationCount,
      markNotificationRead,
      markNotificationsRead,
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

// Core domain types for Golf Me.
// Kept as plain data shapes so a real backend (auth, DB, maps, messaging,
// course data, identity verification) can be swapped in without touching
// the UI layer — components only ever talk to these types + the DataContext.

import type { GeoPoint } from "../lib/geo";

export type GolfVibe =
  | "Casual & Social"
  | "Competitive"
  | "Beginner-Friendly"
  | "Networking"
  | "Just Here to Golf";

export const GOLF_VIBES: GolfVibe[] = [
  "Casual & Social",
  "Competitive",
  "Beginner-Friendly",
  "Networking",
  "Just Here to Golf",
];

export type WalkOrCart = "Walking" | "Cart" | "Either";

export type AgeRange = "18-24" | "25-34" | "35-44" | "45-54" | "55-64" | "65+";

export const AGE_RANGES: AgeRange[] = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

// Simple day-part availability tags rather than a full calendar — enough
// fidelity for matching without building a scheduling system.
export type AvailabilitySlot =
  | "Weekday Mornings"
  | "Weekday Afternoons"
  | "Weekday Evenings"
  | "Weekend Mornings"
  | "Weekend Afternoons"
  | "Weekend Evenings";

export const AVAILABILITY_SLOTS: AvailabilitySlot[] = [
  "Weekday Mornings",
  "Weekday Afternoons",
  "Weekday Evenings",
  "Weekend Mornings",
  "Weekend Afternoons",
  "Weekend Evenings",
];

export type JoinMode = "instant" | "request";

export type SkillFilter = "Any Skill Level" | "Beginner" | "Intermediate" | "Advanced";

// Gender is self-reported only — never inferred from name or photo. Presets
// cover the common cases; a golfer can type anything else as "Custom."
export const GENDER_OPTIONS = ["Man", "Woman", "Non-binary", "Prefer not to say"] as const;

// Age/handicap match preferences are stored as real numeric ranges (sliders)
// rather than fixed buckets — 75/36 double as the slider's "+"-uncapped max.
export const AGE_PREF_MIN = 18;
export const AGE_PREF_MAX = 75;
export const HANDICAP_PREF_MIN = 0;
export const HANDICAP_PREF_MAX = 36;
export const BUDGET_PREF_MIN = 0;
export const BUDGET_PREF_MAX = 300;
export const TRAVEL_RADIUS_MIN = 5;
export const TRAVEL_RADIUS_MAX = 100;

export type GenderPreference = "No preference" | "Men" | "Women" | "Prefer mixed group";
export const GENDER_PREFERENCES: GenderPreference[] = ["No preference", "Men", "Women", "Prefer mixed group"];

// --- Match Preferences (round 2): Round Length, Group Type, Game Format,
// Networking. "Gender Preference" from the same batch reuses GenderPreference
// above rather than duplicating it. ---

export type RoundLengthPreference = "No Preference" | "9 Holes" | "18 Holes";
export const ROUND_LENGTH_PREFERENCES: RoundLengthPreference[] = ["No Preference", "9 Holes", "18 Holes"];
export type Holes = 9 | 18;

// New Golfers = not previously played with. People I Follow / Golf Circle =
// relationship checks against the round's roster. Mixed/Anyone is a real
// selection (not the same as "No Preference") that always matches — it's an
// explicit "no relationship restriction" choice, so it still counts as a
// selected preference.
export type GroupTypePreference = "No Preference" | "New Golfers" | "People I Follow" | "Golf Circle" | "Mixed / Anyone";
export const GROUP_TYPE_PREFERENCES: GroupTypePreference[] = [
  "No Preference",
  "New Golfers",
  "People I Follow",
  "Golf Circle",
  "Mixed / Anyone",
];

// GameFormat is the concrete value a Golf Call host picks; GameFormatPreference
// adds "No Preference" for a golfer's saved match preference.
export type GameFormat = "Standard Stroke Play" | "Match Play" | "Scramble" | "Best Ball" | "Practice / Casual Round";
export const GAME_FORMATS: GameFormat[] = ["Standard Stroke Play", "Match Play", "Scramble", "Best Ball", "Practice / Casual Round"];
export type GameFormatPreference = "No Preference" | GameFormat;
export const GAME_FORMAT_PREFERENCES: GameFormatPreference[] = ["No Preference", ...GAME_FORMATS];

// Deliberately secondary to golf — matched against a round's existing
// "Networking" Golf Vibe rather than adding a whole parallel round-level
// field, so this never becomes its own LinkedIn-style system.
export type NetworkingPreference = "No Preference" | "Not Looking to Network" | "Open to Networking" | "Business / Professional Networking";
export const NETWORKING_PREFERENCES: NetworkingPreference[] = [
  "No Preference",
  "Not Looking to Network",
  "Open to Networking",
  "Business / Professional Networking",
];

export interface VerificationState {
  phoneVerified: boolean;
  emailVerified: boolean;
  verifiedGolfer: boolean; // prototype "Verified Golfer" identity badge
}

export interface ReputationStats {
  completedRounds: number;
  showUpRatePct: number; // 0-100
  wouldPlayAgainPct: number; // 0-100
  onTimePct: number; // 0-100
  respectfulPct: number; // 0-100
  goodPacePct: number; // 0-100
}

export interface GolferProfile {
  id: string;
  name: string;
  username?: string; // real accounts only — unique, used by Find Friends search. Undefined for demo/mock golfers and for real accounts that haven't set one yet.
  avatarColor: string; // css gradient token for placeholder avatar
  avatarInitials: string;
  photoUrl?: string; // local data-URL from device upload; falls back to initials avatar when absent
  ageRange: AgeRange;
  gender: string; // self-reported only; one of GENDER_OPTIONS or a custom value
  areaLabel: string; // general area only, e.g. "Long Island, NY" — never exact address
  // Optional real coordinates behind areaLabel — city/region granularity
  // only (from a picked region or coarse geolocation), never an exact
  // address, and never rendered directly anywhere (only areaLabel or a
  // computed distance are shown). Absent for free-typed labels with no
  // known match — every consumer must handle that gracefully.
  playingAreaCoords?: GeoPoint;
  distanceMiles: number; // approximate distance from current user, mock-computed
  handicap: number | null; // null = no handicap / brand new
  favoriteCourses: string[];
  budgetMin: number;
  budgetMax: number;
  // Distinct from budgetMin === 0 — an explicit "I don't want budget used in
  // matching at all" rather than "my minimum is free."
  noBudgetPreference: boolean;
  availability: AvailabilitySlot[];
  walkOrCart: WalkOrCart;
  vibes: GolfVibe[]; // primary vibe first
  bio: string;
  verification: VerificationState;
  reputation: ReputationStats;
  memberSince: string; // ISO date
  isCurrentUser?: boolean;
  // Mock "golfers this person has played with and would play with again"
  // count, shown on their profile. Only the current user's own Golf Circle
  // is tracked in AppData.circle; this is flavor for everyone else.
  circleSize: number;

  // --- Match preferences (all optional/secondary signals — background
  // weighting only, never strict filters, never the headline of a match). ---
  preferredCourses: string[]; // empty = "no preference, show me anything nearby"
  travelRadiusMiles: number;
  // Preferred handicap range for playing partners — a full 0-36 span (the
  // slider's default) behaves as "no preference," same convention as
  // travelRadiusMiles/budget rather than a separate boolean.
  handicapPreferenceMin: number;
  handicapPreferenceMax: number;
  agePreferenceMin: number;
  agePreferenceMax: number;
  noAgePreference: boolean;
  genderPreference: GenderPreference;
  roundLengthPreference: RoundLengthPreference;
  groupTypePreference: GroupTypePreference;
  gameFormatPreference: GameFormatPreference;
  networkingPreference: NetworkingPreference;
}

export type GolfCallStatus = "open" | "full" | "completed" | "cancelled";

export interface GolfCall {
  id: string;
  hostId: string;
  course: string;
  courseId?: string; // real accounts only — courses.id, used to trigger on-demand enrichment and future tee-time-provider lookups. Undefined for demo/mock rounds, which have no real courses row.
  areaLabel: string;
  distanceMiles: number; // approximate distance from current user to the course
  dateISO: string; // date of the round
  timeLabel: string; // e.g. "10:00 AM" or "Morning (8-10 AM)"
  estimatedPricePerPerson: number;
  totalSpots: number; // total players including host
  joinedGolferIds: string[]; // includes host at index 0
  pendingRequestIds: string[];
  joinMode: JoinMode;
  skillLevel: SkillFilter;
  vibe: GolfVibe;
  walkOrCart: WalkOrCart;
  holes: Holes;
  gameFormat: GameFormat;
  status: GolfCallStatus;
  notes?: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  golfCallId: string;
  senderId: string; // "system" for system messages
  text: string;
  createdAt: string;
  system?: boolean;
}

export type PaceOfPlay = "Fast" | "Good" | "Slow";

// Community feedback on whether a golfer's listed handicap seemed accurate —
// aggregated (never shown 1:1) into a per-golfer Handicap Confidence level.
// Never lets one player directly edit another's handicap.
export type HandicapAccuracy = "accurate" | "slightly_off" | "very_inaccurate" | "not_sure";

export interface Review {
  id: string;
  golfCallId: string;
  reviewerId: string;
  revieweeId: string;
  showedUp: boolean;
  onTime: boolean;
  respectful: boolean;
  paceOfPlay: PaceOfPlay;
  wouldPlayAgain: boolean;
  handicapAccuracy: HandicapAccuracy;
  privateNote?: string; // visible only to GolfMe's trust system, never a public review
  createdAt: string;
}

// One shared taxonomy for every report surface (profile, chat, and now
// Community posts/comments) — deliberately not a second "community reports"
// system. Superset of the original list: content-moderation categories
// (Hate/Sexual/Impersonation/Dangerous) added for Community, "No-show"
// (real-world behavior, not content) kept for round/profile reports.
export type ReportCategory =
  | "Spam"
  | "Harassment"
  | "Hate / abusive content"
  | "Sexual / inappropriate content"
  | "Scam"
  | "Impersonation"
  | "Dangerous behavior"
  | "No-show"
  | "Other";

export const REPORT_CATEGORIES: ReportCategory[] = [
  "Spam",
  "Harassment",
  "Hate / abusive content",
  "Sexual / inappropriate content",
  "Scam",
  "Impersonation",
  "Dangerous behavior",
  "No-show",
  "Other",
];

export interface Report {
  id: string;
  reporterId: string;
  reportedId: string;
  category: ReportCategory;
  details: string;
  context: "profile" | "chat" | "round" | "post" | "comment";
  golfCallId?: string;
  postId?: string;
  commentId?: string;
  createdAt: string;
}

export interface Block {
  blockerId: string;
  blockedId: string;
  createdAt: string;
}

// A Golf Circle connection: golfers the owner has actually played with and
// would play with again. One-directional for this prototype — no
// accept/reject step, just a trusted-players list per user.
export interface CircleConnection {
  id: string;
  ownerId: string;
  memberId: string;
  createdAt: string;
}

// Following is deliberately separate from Golf Circle: "I'm interested in
// golfing with/keeping tabs on this person" vs. "I've actually played with
// them and would again." Following never auto-adds to Golf Circle.
export interface FollowConnection {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: string;
}

// One-to-one messages, keyed by a canonical conversation id (sorted pair of
// golfer ids) so a conversation doesn't need its own separate record.
export interface DirectMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
}

// Per-user "last read" marker for a conversation, used only to compute
// unread indicators in the Inbox.
export interface DmReadState {
  conversationId: string;
  userId: string;
  lastReadAt: string;
}

// --- Community: a social/discussion layer that stays embedded in the core
// find-a-round loop rather than becoming a standalone generic feed. Reuses
// golfers/follows/blocks/golfCalls/courses wholesale — never duplicates
// them. ---

export type PostType = "text" | "photo" | "course" | "round";
export const POST_TYPES: PostType[] = ["text", "photo", "course", "round"];

// Deliberately short — a meme is just a "photo" post categorized "Memes",
// not a separate system.
export type PostCategory = "General" | "Memes" | "Course Talk" | "Equipment" | "Tips & Advice" | "Round Stories" | "Looking to Play";
export const POST_CATEGORIES: PostCategory[] = [
  "General",
  "Memes",
  "Course Talk",
  "Equipment",
  "Tips & Advice",
  "Round Stories",
  "Looking to Play",
];

export interface CommunityPost {
  id: string;
  authorId: string;
  type: PostType;
  text: string;
  imageUrl?: string; // local data-URL, same handling as GolferProfile.photoUrl
  courseTag?: string; // a name from lib/courses.ts — never a duplicate course record
  golfCallId?: string; // attached Golf Call, by reference only (upcoming or completed)
  category: PostCategory;
  createdAt: string;
}

// Upvote-only — no downvotes (see DataContext for the reasoning). Existence
// of a row = upvoted; tapping again just removes the row. Community votes
// never feed into GolferProfile.reputation or credibility.
export interface PostVote {
  id: string;
  postId: string;
  voterId: string;
  createdAt: string;
}

// parentCommentId present only on a reply — caps nesting at 2 visible
// levels (comment → reply) by construction, not by a depth counter.
export interface PostComment {
  id: string;
  postId: string;
  authorId: string;
  text: string;
  parentCommentId?: string;
  createdAt: string;
}

export interface CommentVote {
  id: string;
  commentId: string;
  voterId: string;
  createdAt: string;
}

export interface SavedPost {
  id: string;
  ownerId: string;
  postId: string;
  createdAt: string;
}

// Per-viewer "don't show me this post again" — distinct from deleting (only
// the author can delete) and from blocking (blocks the person, not just
// one post).
export interface HiddenPost {
  ownerId: string;
  postId: string;
  createdAt: string;
}

export type NotificationType =
  | "post_reply"
  | "comment_reply"
  | "new_follower"
  | "round_created_from_post"
  | "post_became_round"
  // Real-account-only types (Phase 5) — database-trigger-generated, never
  // client-inserted. See supabase/migrations/..._create_messaging_blocks_reports_notifications.sql.
  | "round_joined"
  | "round_left"
  | "round_cancelled"
  | "new_message";

export interface AppNotification {
  id: string;
  userId: string; // recipient
  type: NotificationType;
  actorId?: string; // who triggered it, if anyone
  text: string;
  linkTo: string; // in-app path to open on tap
  read: boolean;
  createdAt: string;
}

// Mock session state — structured so a real backend (Supabase auth, etc.)
// can replace it without touching the UI layer. isLoggedIn gates
// Welcome/Login; hasOnboarded lets a logged-out-then-back-in user skip
// straight past onboarding + profile setup.
export interface SessionState {
  isLoggedIn: boolean;
  hasOnboarded: boolean;
}

export interface AppData {
  golfers: GolferProfile[];
  golfCalls: GolfCall[];
  messages: ChatMessage[];
  reviews: Review[];
  reports: Report[];
  blocks: Block[];
  circle: CircleConnection[];
  follows: FollowConnection[];
  directMessages: DirectMessage[];
  dmReads: DmReadState[];
  posts: CommunityPost[];
  postVotes: PostVote[];
  comments: PostComment[];
  commentVotes: CommentVote[];
  savedPosts: SavedPost[];
  hiddenPosts: HiddenPost[];
  notifications: AppNotification[];
  currentUserId: string;
  session: SessionState;
}

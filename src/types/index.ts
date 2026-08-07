// Core domain types for Golf Me.
// Kept as plain data shapes so a real backend (auth, DB, maps, messaging,
// course data, identity verification) can be swapped in without touching
// the UI layer — components only ever talk to these types + the DataContext.

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
  avatarColor: string; // css gradient token for placeholder avatar
  avatarInitials: string;
  ageRange: AgeRange;
  areaLabel: string; // general area only, e.g. "Long Island, NY" — never exact address
  distanceMiles: number; // approximate distance from current user, mock-computed
  handicap: number | null; // null = no handicap / brand new
  favoriteCourses: string[];
  budgetMin: number;
  budgetMax: number;
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
}

export type GolfCallStatus = "open" | "full" | "completed" | "cancelled";

export interface GolfCall {
  id: string;
  hostId: string;
  course: string;
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

export type ReportCategory =
  | "Harassment"
  | "Spam or scam"
  | "Inappropriate behavior"
  | "Fake identity"
  | "No-show"
  | "Other";

export const REPORT_CATEGORIES: ReportCategory[] = [
  "Harassment",
  "Spam or scam",
  "Inappropriate behavior",
  "Fake identity",
  "No-show",
  "Other",
];

export interface Report {
  id: string;
  reporterId: string;
  reportedId: string;
  category: ReportCategory;
  details: string;
  context: "profile" | "chat" | "round";
  golfCallId?: string;
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
  currentUserId: string;
  session: SessionState;
}

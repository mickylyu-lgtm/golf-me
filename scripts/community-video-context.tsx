// Synthetic local UI fixtures only. No backend or real accounts.
const golfer = { id: "qa-author", name: "Synthetic Golfer", avatarColor: "#285c45", avatarInitials: "SG", verification: { verifiedGolfer: false } };
export function useData() {
  return {
    currentUser: { ...golfer, id: "qa-viewer" }, getGolfer: () => golfer,
    getGolfCall: () => null, isInCircle: () => false, isPostUpvoted: () => false,
    postUpvoteCount: () => 0, isPostSaved: () => false, commentsForPost: () => [],
    isBlocked: () => false, caddieAnalyses: [],
  };
}
export function useAuth() { return { isDemo: true }; }
export function useModeration() { return { available: false, isAdmin: false }; }
export function useRealCommunity() { return {}; }

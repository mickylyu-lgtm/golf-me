// Synthetic records only. Used by the local browser regression, never shipped.
const golfer = { id: "qa-author", name: "Synthetic Golfer", areaLabel: "Test town", avatarColor: "#285c45", avatarInitials: "SG", verification: { verifiedGolfer: false } };
const posts = Array.from({ length: 32 }, (_, i) => ({
  id: "post-" + i, authorId: golfer.id, type: "text", category: "general",
  text: "Synthetic feed post " + i + ". Golf practice and weekend plans. ".repeat(7),
  createdAt: new Date(Date.now() - i * 3600000).toISOString(),
}));
const comments = Array.from({ length: 9 }, (_, i) => ({
  id: "comment-" + i, postId: "post-12", authorId: golfer.id,
  text: "Synthetic comment " + i + ". Practice makes progress.",
  createdAt: new Date().toISOString(),
}));
export function useData() {
  return {
    currentUser: { ...golfer, id: "qa-viewer" }, getGolfer: () => golfer,
    getPost: (id: string) => posts.find(p => p.id === id), visiblePosts: () => posts,
    followingGolfers: [], getGolfCall: () => null, isInCircle: () => false,
    isPostUpvoted: () => false, postUpvoteCount: () => 0, isPostSaved: () => false,
    commentsForPost: () => comments, isBlocked: () => false, caddieAnalyses: [],
    isCommentUpvoted: () => false, commentUpvoteCount: () => 0,
    createComment: async () => {},
  };
}
export function useAuth() { return { isDemo: true }; }
export function useModeration() { return { available: false, isAdmin: false }; }
export function useRealCommunity() { return { hasLoaded: true, isLoading: false }; }

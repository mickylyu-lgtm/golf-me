import type { CommunityPost, GolferProfile } from "../types";

// Simple mock ranking — not a recommendation engine. Kept as pure functions
// so a real backend/ranking service can replace the internals later without
// touching the feed page.
export interface FeedContext {
  followingIds: Set<string>;
  circleIds: Set<string>;
  preferredCourses: string[];
  areaLabel: string;
  upvoteCount: (postId: string) => number;
}

// Coarse "same general area" check via the trailing state/region token
// (e.g. "NY") — never compares exact locations, matching the rest of the
// app's "general area only" location handling.
function isNearby(post: CommunityPost, ctx: FeedContext, getGolfer: (id: string) => GolferProfile | undefined): boolean {
  const region = ctx.areaLabel.split(",").pop()?.trim();
  if (!region) return false;
  const author = getGolfer(post.authorId);
  return author?.areaLabel.includes(region) ?? false;
}

function byRecency(a: CommunityPost, b: CommunityPost): number {
  return b.createdAt.localeCompare(a.createdAt);
}

export function rankForYou(posts: CommunityPost[], ctx: FeedContext, getGolfer: (id: string) => GolferProfile | undefined): CommunityPost[] {
  const scoreFor = (p: CommunityPost): number => {
    let score = 0;
    if (ctx.followingIds.has(p.authorId)) score += 3;
    if (ctx.circleIds.has(p.authorId)) score += 2;
    if (p.courseTag && ctx.preferredCourses.includes(p.courseTag)) score += 2;
    if (isNearby(p, ctx, getGolfer)) score += 1;
    score += ctx.upvoteCount(p.id) * 0.1;
    return score;
  };
  return [...posts].sort((a, b) => scoreFor(b) - scoreFor(a) || byRecency(a, b));
}

export function rankFollowing(posts: CommunityPost[], ctx: FeedContext): CommunityPost[] {
  return posts.filter((p) => ctx.followingIds.has(p.authorId)).sort(byRecency);
}

export function rankNearby(posts: CommunityPost[], ctx: FeedContext, getGolfer: (id: string) => GolferProfile | undefined): CommunityPost[] {
  return posts.filter((p) => isNearby(p, ctx, getGolfer)).sort(byRecency);
}

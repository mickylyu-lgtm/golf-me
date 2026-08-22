import type { CommunityPost, GolferProfile } from "../types";

// Simple mock ranking — not a recommendation engine. Kept as pure functions
// so a real backend/ranking service can replace the internals later without
// touching the feed page.
export interface FeedContext {
  followingIds: Set<string>;
  areaLabel: string;
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

// Was a follow/circle/course-match/upvote-weighted score, recency only as a
// tiebreaker — meant an older post from someone followed could rank above
// a genuinely newer one, which read as "the feed isn't showing latest
// first." Explicit product decision: For You is plain reverse-chronological
// now, same as Following/Nearby below.
export function rankForYou(posts: CommunityPost[]): CommunityPost[] {
  return [...posts].sort(byRecency);
}

export function rankFollowing(posts: CommunityPost[], ctx: FeedContext): CommunityPost[] {
  return posts.filter((p) => ctx.followingIds.has(p.authorId)).sort(byRecency);
}

export function rankNearby(posts: CommunityPost[], ctx: FeedContext, getGolfer: (id: string) => GolferProfile | undefined): CommunityPost[] {
  return posts.filter((p) => isNearby(p, ctx, getGolfer)).sort(byRecency);
}

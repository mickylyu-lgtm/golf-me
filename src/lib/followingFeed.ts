// Home's supplemental Following feed: the pure parts (paging, outcome classification,
// merging with what Community and Play already loaded). The network side is
// lib/useFollowingFeed.ts.
//
// Real accounts page through get_following_feed (migration
// 20261116120000). Until that migration is applied the RPC is missing, and
// Home still shows every visible post Community already loaded. Following
// filtering here applies only to supplemental paged posts and round activity.
import { isMissingFunctionError } from "./publicDirectory.ts";

export const FOLLOWING_FEED_RPC = "get_following_feed";
export const FOLLOWING_FEED_PAGE_SIZE = 20;

/** The last row of the previous page: (created_at, id), the RPC's keyset. */
export interface FeedCursor {
  before: string;
  beforeId: string;
}

interface KeyedRow {
  id: string;
  created_at: string;
}

export function followingFeedArgs(cursor: FeedCursor | null, limit: number = FOLLOWING_FEED_PAGE_SIZE) {
  return cursor ? { p_before: cursor.before, p_before_id: cursor.beforeId, p_limit: limit } : { p_limit: limit };
}

/** Newest first, ties by id descending: the RPC's own order. */
export function compareRowsDesc(a: KeyedRow, b: KeyedRow): number {
  const byTime = Date.parse(b.created_at) - Date.parse(a.created_at);
  if (byTime !== 0 && Number.isFinite(byTime)) return byTime;
  if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** The cursor for the page after these rows (the oldest one), or null for none. */
export function cursorAfter(rows: readonly KeyedRow[]): FeedCursor | null {
  if (rows.length === 0) return null;
  const oldest = [...rows].sort(compareRowsDesc)[rows.length - 1];
  return { before: oldest.created_at, beforeId: oldest.id };
}

/** Adds a page to the rows loaded so far: one row per id (the newer copy wins), sorted. */
export function appendPage<T extends KeyedRow>(existing: readonly T[], page: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of existing) byId.set(row.id, row);
  for (const row of page) byId.set(row.id, row);
  return [...byId.values()].sort(compareRowsDesc);
}

export type FeedPageOutcome<T> =
  | { kind: "rows"; rows: T[]; hasMore: boolean }
  | { kind: "missing" }
  | { kind: "error"; error: unknown };

/**
 * One RPC answer. "missing" = the migration isn't applied (function not
 * found), so the caller falls back to client filtering. A full page means
 * there may be more; a short page is the end.
 */
export function classifyFeedPage<T>(
  data: unknown,
  error: { code?: string; message?: string } | null | undefined,
  limit: number = FOLLOWING_FEED_PAGE_SIZE,
): FeedPageOutcome<T> {
  if (error) return isMissingFunctionError(error, FOLLOWING_FEED_RPC) ? { kind: "missing" } : { kind: "error", error };
  const rows = Array.isArray(data) ? (data as T[]) : [];
  return { kind: "rows", rows, hasMore: rows.length >= limit };
}

interface FeedPost {
  id: string;
  authorId: string;
  createdAt: string;
}

export interface MergeFollowingPostsInput<P extends FeedPost> {
  /** Posts from get_following_feed pages, mapped. */
  serverPosts: readonly P[];
  /** What Community has loaded (already block/hidden filtered or not; this filters again). */
  contextPosts: readonly P[];
  /** Community's last load succeeded, so its list is current within its time range. */
  contextLoaded: boolean;
  followingIds: ReadonlySet<string>;
  /** False for a post that must not show (blocked author either way, hidden by me). */
  isVisible: (post: P) => boolean;
}

/**
 * Posts for the Following feed, newest first, one per id.
 *
 * Community's copy of a post wins (it is refreshed by Realtime and the
 * moderation signal; a server page is not). A server post Community should
 * have but doesn't (inside Community's loaded time range, and Community's
 * load succeeded) was deleted, removed or hidden since the page was fetched,
 * so it is dropped. A server post older than Community's oldest post is the
 * reason the RPC exists: kept. Unfollowed authors, blocks and hidden posts
 * are re-applied to everything, so those take effect without a refetch.
 */
export function mergeFollowingPosts<P extends FeedPost>(input: MergeFollowingPostsInput<P>): P[] {
  const { serverPosts, contextPosts, contextLoaded, followingIds, isVisible } = input;
  const contextById = new Map<string, P>();
  let oldestContext: string | undefined;
  let newestContext: string | undefined;
  for (const post of contextPosts) {
    if (post.id.startsWith("pending-")) continue;
    contextById.set(post.id, post);
    if (oldestContext === undefined || post.createdAt < oldestContext) oldestContext = post.createdAt;
    if (newestContext === undefined || post.createdAt > newestContext) newestContext = post.createdAt;
  }
  const out = new Map<string, P>();
  for (const post of serverPosts) {
    if (contextById.has(post.id)) continue;
    if (contextLoaded) {
      // Community loaded fine and covers this post's time: its absence there means gone.
      const insideContextRange =
        oldestContext === undefined || (post.createdAt >= oldestContext && (newestContext === undefined || post.createdAt <= newestContext));
      if (insideContextRange) continue;
    }
    out.set(post.id, post);
  }
  for (const post of contextById.values()) out.set(post.id, post);
  return [...out.values()]
    .filter((post) => followingIds.has(post.authorId) && isVisible(post))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/**
 * While more server pages exist, nothing older than the oldest loaded server
 * post may show yet: an older round (or Community post) would otherwise sit
 * above posts not yet fetched and jump down when they arrive. Returns that
 * time, or null when everything can show (no more pages, or not paging).
 */
export function feedCutoff(serverPosts: readonly { createdAt: string }[], hasMore: boolean): string | null {
  if (!hasMore || serverPosts.length === 0) return null;
  let oldest = serverPosts[0].createdAt;
  for (const post of serverPosts) if (post.createdAt < oldest) oldest = post.createdAt;
  return oldest;
}

/** Items at or after the cutoff (all of them when there is none). */
export function withinCutoff<T extends { at: string }>(items: readonly T[], cutoff: string | null): T[] {
  return cutoff === null ? [...items] : items.filter((item) => item.at >= cutoff);
}

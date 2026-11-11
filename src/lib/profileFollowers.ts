import type { GolferProfile } from "../types";
import { publicProfileRowToGolferProfile } from "./publicDirectory.ts";
import type { PublicProfileRow } from "./publicDirectory.ts";

export interface ProfileFollowers {
  total: number;
  golfers: GolferProfile[];
  /** Follower ids the signed-in viewer also follows. */
  mutualIds: string[];
}

export const FOLLOWERS_PAGE_SIZE = 100;
export const MAX_VISIBLE_FOLLOWERS = 100000;

export interface FollowerPage {
  total: number;
  mutualTotal: number;
  golfers: GolferProfile[];
  mutualIds: string[];
}

export function parseFollowerPage(value: unknown): FollowerPage {
  if (!value || typeof value !== "object") throw new Error("Followers unavailable");
  const raw = value as Record<string, unknown>;
  const validCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (raw.version !== 1 || !validCount(raw.total) || !validCount(raw.mutual_total)
      || raw.mutual_total > raw.total || !Array.isArray(raw.followers) || raw.followers.length > FOLLOWERS_PAGE_SIZE) {
    throw new Error("Invalid follower response");
  }
  const ids = new Set<string>();
  const mutualIds: string[] = [];
  const golfers = raw.followers.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Invalid follower row");
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || ids.has(row.id) || typeof row.name !== "string" || !row.name.trim() || typeof row.is_mutual !== "boolean") {
      throw new Error("Invalid follower row");
    }
    ids.add(row.id);
    if (row.is_mutual) mutualIds.push(row.id);
    return publicProfileRowToGolferProfile(row as unknown as PublicProfileRow);
  });
  if (golfers.length > raw.total || mutualIds.length > raw.mutual_total) throw new Error("Invalid follower totals");
  return { total: raw.total, mutualTotal: raw.mutual_total, golfers, mutualIds };
}

/** Reject detectable concurrent changes; offset pages are separately
 * authorized snapshots, not one transaction across all HTTP requests. */
export async function collectVisibleFollowers(readPage: (offset: number, size: number) => Promise<FollowerPage>): Promise<ProfileFollowers> {
  const golfers: GolferProfile[] = [];
  const mutualIds: string[] = [];
  const seen = new Set<string>();
  let expected: { total: number; mutualTotal: number } | undefined;
  for (let offset = 0; ; offset += FOLLOWERS_PAGE_SIZE) {
    const page = await readPage(offset, FOLLOWERS_PAGE_SIZE);
    if (page.total > MAX_VISIBLE_FOLLOWERS) throw new Error("Follower list is too large");
    if (!expected) expected = page;
    if (page.total !== expected.total || page.mutualTotal !== expected.mutualTotal) throw new Error("Followers changed. Please retry.");
    for (const golfer of page.golfers) {
      if (seen.has(golfer.id)) throw new Error("Followers changed. Please retry.");
      seen.add(golfer.id);
      golfers.push(golfer);
    }
    mutualIds.push(...page.mutualIds);
    if (golfers.length >= page.total || page.golfers.length < FOLLOWERS_PAGE_SIZE) {
      if (golfers.length !== expected.total || mutualIds.length !== expected.mutualTotal) throw new Error("Followers changed. Please retry.");
      return { total: golfers.length, golfers, mutualIds };
    }
  }
}

/** Mutuals means the viewer follows this follower too, never Golf Circle membership. */
export function filterProfileFollowers(
  golfers: readonly GolferProfile[],
  query: string,
  mutualsOnly: boolean,
  isFollowing: (id: string) => boolean,
  isBlocked: (id: string) => boolean,
): GolferProfile[] {
  const search = query.trim().replace(/^@/, "").toLocaleLowerCase();
  return golfers.filter((g) => !isBlocked(g.id)
    && (!mutualsOnly || isFollowing(g.id))
    && (!search || `${g.name} ${g.username ?? ""}`.toLocaleLowerCase().includes(search)));
}

/** A late read must not repopulate data after its viewer/privacy scope changed. */
export async function requireCurrentFollowerRead<T>(request: Promise<T>, isCurrent: () => boolean): Promise<T> {
  const result = await request;
  if (!isCurrent()) throw new Error("Follower visibility changed");
  return result;
}

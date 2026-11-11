import type { GolferProfile } from "../types";

export interface ProfileFollowers {
  total: number;
  golfers: GolferProfile[];
  /** Follower ids the signed-in viewer also follows. */
  mutualIds: string[];
}

export const FOLLOWERS_PAGE_SIZE = 200;

/** Page every relationship: PostgREST's row cap must not silently cut the list. */
export async function collectFollowerIds(readPage: (offset: number, size: number) => Promise<string[]>): Promise<string[]> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += FOLLOWERS_PAGE_SIZE) {
    const page = await readPage(offset, FOLLOWERS_PAGE_SIZE);
    for (const id of page) ids.add(id);
    if (page.length < FOLLOWERS_PAGE_SIZE) return [...ids];
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

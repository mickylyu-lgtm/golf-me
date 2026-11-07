// notify-fanout: drop pushes for Community posts an admin removed after the
// fan-out was claimed (migration 20261107270000_admin_moderation). The
// admin RPC also closes the job and takes back the bell rows; this covers a
// push already in flight (claimed, not yet sent) at the moment of removal.
// Pure helpers, shared with the Node tests; no Deno or network APIs.

const POST_LINK = /^\/community\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The post id a fan-out push links to, or null (round pushes, other links). */
export function postIdFromLink(linkTo: string | null | undefined): string | null {
  const m = POST_LINK.exec(linkTo ?? "");
  return m ? m[1].toLowerCase() : null;
}

/** Distinct post ids the owed pushes link to. */
export function linkedPostIds(pushes: readonly { link_to: string }[]): string[] {
  return [...new Set(pushes.map((p) => postIdFromLink(p.link_to)).filter((id): id is string => id !== null))];
}

export type PostLookup =
  /** Rows for the linked posts (service role: removed rows are returned too). */
  | { ok: true; rows: readonly { id: string; removed_at: string | null }[] }
  /** The lookup failed. A missing removed_at column (migration not applied
   *  yet) or any other error keeps every push: the claim already checked the
   *  post existed, and a lost "new post" push is worse than today's behaviour. */
  | { ok: false };

/**
 * Keeps round pushes and pushes for posts that still exist and aren't
 * removed. A post that is gone (deleted) or removed drops its pushes.
 */
export function withoutRemovedPosts<T extends { link_to: string }>(pushes: readonly T[], lookup: PostLookup): { keep: T[]; dropped: number } {
  if (!lookup.ok) return { keep: [...pushes], dropped: 0 };
  const live = new Set(lookup.rows.filter((r) => r.removed_at === null).map((r) => r.id.toLowerCase()));
  const keep = pushes.filter((p) => {
    const id = postIdFromLink(p.link_to);
    return id === null || live.has(id);
  });
  return { keep, dropped: pushes.length - keep.length };
}

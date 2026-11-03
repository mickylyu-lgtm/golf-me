// CreatePost writes the public community-media objects a swing post needs
// (copyCaddieMediaToCommunity's `swing-<uuid>` copies of a private Caddie
// video, or a fresh upload) BEFORE createPost inserts the post. If that
// insert then fails, those public objects were left behind with nothing
// pointing at them. This removes exactly the objects one publish attempt
// created, and only when no post row references them.
//
// Safety rules:
//   * only URLs the caller says THIS attempt created are considered;
//   * only community-media paths in the caller's own folder whose file name
//     has the `swing-<uuid>` / `swing-thumb-<uuid>` shape those writers use
//     (never caddie-media: the private originals are never touched here);
//   * if a community_posts / community_post_media row references the URL
//     (e.g. the insert actually landed and only the response was lost), or
//     that check itself fails, the object is kept.
// Storage RLS already limits delete to the owner's own folder
// (community_media_delete_own + community_media_select_own, migrations
// 20260816143600 and 20260923120000).
//
// Takes the client as a parameter (no runtime imports) so
// tests/communityMediaCleanup.test.ts can run it with a mocked client under
// node --test; caddieMedia.ts passes the real supabase client.

const COMMUNITY_MEDIA_BUCKET = "community-media";
const PUBLIC_MARKER = `/storage/v1/object/public/${COMMUNITY_MEDIA_BUCKET}/`;
const CREATED_FILE = /^swing-(thumb-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{1,8}$/;

type QueryResult = { data: unknown; error: unknown };
interface FilterBuilder {
  in(column: string, values: string[]): PromiseLike<QueryResult>;
}
export interface CleanupClient {
  from(table: string): { select(columns: string): FilterBuilder };
  storage: { from(bucket: string): { remove(paths: string[]): PromiseLike<QueryResult> } };
}

/** The bucket path of a public community-media URL this cleanup may delete, else null. */
export function createdCommunityMediaPath(url: string | null | undefined, ownerId: string): string | null {
  if (!url || !ownerId) return null;
  const i = url.indexOf(PUBLIC_MARKER);
  if (i < 0) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.slice(i + PUBLIC_MARKER.length).split("?")[0]);
  } catch {
    return null;
  }
  const parts = path.split("/");
  if (parts.length !== 2 || parts[0] !== ownerId || !CREATED_FILE.test(parts[1])) return null;
  return path;
}

const REFERENCE_CHECKS: Array<{ table: string; columns: string[] }> = [
  { table: "community_posts", columns: ["video_url", "video_thumbnail_url", "image_url"] },
  { table: "community_post_media", columns: ["media_url", "thumbnail_url"] },
];

export interface CleanupResult {
  removed: string[];
  kept: string[];
}

export async function removeOrphanedCommunityMedia(
  client: CleanupClient,
  ownerId: string,
  createdUrls: string[],
  log: (message: string, err: unknown) => void = (message, err) => console.error(message, err),
): Promise<CleanupResult> {
  const byPath = new Map<string, string>();
  for (const url of createdUrls) {
    const path = createdCommunityMediaPath(url, ownerId);
    if (path) byPath.set(path, url);
  }
  if (byPath.size === 0) return { removed: [], kept: [] };
  const urls = [...byPath.values()];

  const referenced = new Set<string>();
  try {
    const results = await Promise.all(
      REFERENCE_CHECKS.flatMap(({ table, columns }) => columns.map((column) => client.from(table).select(column).in(column, urls).then((r) => ({ column, ...r })))),
    );
    for (const { column, data, error } of results) {
      if (error) throw error;
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const value = row[column];
        if (typeof value === "string") referenced.add(value);
      }
    }
  } catch (err) {
    log("GolfMe: couldn't check whether new swing media is in use; keeping it.", err);
    return { removed: [], kept: [...byPath.keys()] };
  }

  const toRemove = [...byPath].filter(([, url]) => !referenced.has(url)).map(([path]) => path);
  const kept = [...byPath].filter(([, url]) => referenced.has(url)).map(([path]) => path);
  if (toRemove.length === 0) return { removed: [], kept };
  const { error } = await client.storage.from(COMMUNITY_MEDIA_BUCKET).remove(toRemove);
  if (error) {
    log("GolfMe: couldn't remove unused swing media after a failed post.", error);
    return { removed: [], kept: [...kept, ...toRemove] };
  }
  return { removed: toRemove, kept };
}

import { supabase } from "./supabase";

// Private home for direct-upload Caddie swing videos, their thumbnails and
// analyze-swing's trimmed copies (migration 20260925090000). Objects live at
// `<owner uid>/<file>` with owner-only storage RLS, so a file is only ever
// reachable through a short-lived signed URL made for its owner. Rows store
// the object PATH (caddie_analyses.source_media_path / thumbnail_path),
// never a URL — nothing durable holds an expiring link or a credential.
export const CADDIE_MEDIA_BUCKET = "caddie-media";
// Public bucket Community posts use. A Caddie video shared to Community is
// COPIED here at publish time, so the public post never depends on the
// private original (and deleting that post removes only the public copy).
export const COMMUNITY_MEDIA_BUCKET = "community-media";

// Playback/thumbnail signed URLs live 1 hour (product decision). The link
// is never stored; RealCaddieContext re-signs a path when its link is within
// SIGNED_URL_REFRESH_MARGIN_MS of expiring (checked on every list change,
// on app resume via refetch, and every SIGNED_URL_CHECK_INTERVAL_MS), and
// immediately on a playback error (refreshMediaUrls).
export const SIGNED_URL_TTL_SECONDS = 60 * 60;
export const SIGNED_URL_REFRESH_MARGIN_MS = 10 * 60 * 1000;
export const SIGNED_URL_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const SIGN_BATCH_SIZE = 100;

export interface SignedUrlEntry {
  url: string;
  expiresAt: number;
}

/** Batch-signs caddie-media paths the caller owns. Paths that fail to sign are simply absent from the result. */
export async function signCaddieMediaPaths(paths: string[]): Promise<Map<string, SignedUrlEntry>> {
  const result = new Map<string, SignedUrlEntry>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return result;
  const expiresAt = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;
  for (let i = 0; i < unique.length; i += SIGN_BATCH_SIZE) {
    const batch = unique.slice(i, i + SIGN_BATCH_SIZE);
    const { data, error } = await supabase.storage.from(CADDIE_MEDIA_BUCKET).createSignedUrls(batch, SIGNED_URL_TTL_SECONDS);
    if (error) {
      console.error("GolfMe: failed to sign Caddie media URLs.", error);
      continue;
    }
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl && !entry.error) result.set(entry.path, { url: entry.signedUrl, expiresAt });
    }
  }
  return result;
}

/** A single short-lived signed URL (e.g. CreatePost's preview of a video being shared). */
export async function signCaddieMediaPath(path: string): Promise<string | undefined> {
  return (await signCaddieMediaPaths([path])).get(path)?.url;
}

function extensionOf(path: string, fallback: string): string {
  const file = path.split("/").pop() ?? "";
  const dot = file.lastIndexOf(".");
  const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : fallback;
}

// Storage's server-side cross-bucket copy first (no bytes through the phone;
// storage RLS needs select on the source + insert on the target, both
// own-folder), falling back to download + upload if the copy is refused.
async function copyObject(fromBucket: string, fromPath: string, toBucket: string, toPath: string, fallbackType: string): Promise<void> {
  const { error: copyError } = await supabase.storage.from(fromBucket).copy(fromPath, toPath, { destinationBucket: toBucket });
  if (!copyError) return;
  console.warn("GolfMe: cross-bucket copy failed, falling back to download + upload.", copyError);
  const { data: blob, error: downloadError } = await supabase.storage.from(fromBucket).download(fromPath);
  if (downloadError || !blob) throw downloadError ?? new Error("Couldn't read your swing video.");
  const { error: uploadError } = await supabase.storage.from(toBucket).upload(toPath, blob, { contentType: blob.type || fallbackType });
  if (uploadError) throw uploadError;
}

/**
 * Copies one of the caller's private caddie-media objects into the public
 * community-media bucket under a fresh `swing-*` name and returns its public
 * URL. Used only when the golfer actually publishes a Share-to-Community
 * post — never earlier, so abandoning the share leaves nothing public.
 */
export async function copyCaddieMediaToCommunity(ownerId: string, sourcePath: string, kind: "video" | "thumb"): Promise<string> {
  if (!sourcePath.startsWith(`${ownerId}/`)) throw new Error("Can only share your own swing.");
  const ext = extensionOf(sourcePath, kind === "video" ? "mp4" : "jpg");
  const targetPath = `${ownerId}/${kind === "video" ? "swing" : "swing-thumb"}-${crypto.randomUUID()}.${ext}`;
  await copyObject(CADDIE_MEDIA_BUCKET, sourcePath, COMMUNITY_MEDIA_BUCKET, targetPath, kind === "video" ? "video/mp4" : "image/jpeg");
  return supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(targetPath).data.publicUrl;
}

const PUBLIC_MARKER = `/storage/v1/object/public/${COMMUNITY_MEDIA_BUCKET}/`;
function ownCommunityMediaPath(url: string | null | undefined, ownerId: string): string | null {
  if (!url) return null;
  const i = url.indexOf(PUBLIC_MARKER);
  if (i < 0) return null;
  const path = decodeURIComponent(url.slice(i + PUBLIC_MARKER.length).split("?")[0]);
  return path.startsWith(`${ownerId}/`) && !path.includes("..") ? path : null;
}

/**
 * Before a Swing Post is deleted: every Ask-Caddie analysis of it that still
 * reads the post's PUBLIC media gets its own private copy in caddie-media and
 * is repointed at it (product decision: a deleted post leaves nothing public
 * behind, and the kept analysis must never point at a removed file).
 *
 * The ordering is what makes this safe: copy -> repoint the row -> only then
 * does delete_community_post run. Its reference check no longer sees these
 * analyses using the public files, so it returns them for removal. If a copy
 * or repoint fails, that row keeps its public URL and delete_community_post
 * keeps the file (P2-10's reference check) — nothing is ever left pointing at
 * a deleted object; scripts/migrate-caddie-media-private.ts privatizes such
 * leftovers later. Returns how many analyses could not be privatized.
 */
export async function privatizeAnalysesOfPost(ownerId: string, postId: string): Promise<number> {
  const { data, error } = await supabase
    .from("caddie_analyses")
    .select("id, source_media_url, thumbnail_url")
    .eq("source_post_id", postId)
    .is("source_media_path", null);
  if (error) {
    console.error("GolfMe: couldn't look up Caddie analyses for this post.", error);
    return 0;
  }
  const rows = (data ?? []) as Array<{ id: string; source_media_url: string | null; thumbnail_url: string | null }>;
  if (rows.length === 0) return 0;

  // One private copy per distinct public file (re-asks of the same post
  // share one video).
  const copied = new Map<string, string | null>();
  async function privateCopyOf(publicPath: string, kind: "video" | "thumb"): Promise<string | null> {
    if (copied.has(publicPath)) return copied.get(publicPath) ?? null;
    const target = `${ownerId}/${kind === "video" ? "caddie" : "caddie-thumb"}-${crypto.randomUUID()}.${extensionOf(publicPath, kind === "video" ? "mp4" : "jpg")}`;
    try {
      await copyObject(COMMUNITY_MEDIA_BUCKET, publicPath, CADDIE_MEDIA_BUCKET, target, kind === "video" ? "video/mp4" : "image/jpeg");
      copied.set(publicPath, target);
      return target;
    } catch (err) {
      console.error("GolfMe: couldn't copy post media for a kept Caddie analysis.", err);
      copied.set(publicPath, null);
      return null;
    }
  }

  let failed = 0;
  for (const row of rows) {
    const videoPublic = ownCommunityMediaPath(row.source_media_url, ownerId);
    const videoPrivate = videoPublic ? await privateCopyOf(videoPublic, "video") : null;
    if (!videoPrivate) {
      failed += 1;
      continue;
    }
    const thumbPublic = ownCommunityMediaPath(row.thumbnail_url, ownerId);
    const thumbPrivate = thumbPublic ? await privateCopyOf(thumbPublic, "thumb") : null;
    const update: Record<string, string | null> = { source_media_path: videoPrivate, source_media_url: null };
    if (thumbPrivate) {
      update.thumbnail_path = thumbPrivate;
      update.thumbnail_url = null;
    }
    const { error: updateError } = await supabase.from("caddie_analyses").update(update).eq("id", row.id).is("source_media_path", null);
    if (updateError) {
      console.error("GolfMe: couldn't repoint a kept Caddie analysis.", updateError);
      failed += 1;
    }
  }
  return failed;
}

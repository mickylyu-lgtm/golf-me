// Remaining 0g — staged backfill + orphan sweep for the private Caddie bucket.
//
// Moves existing direct-upload Caddie videos/thumbnails out of the PUBLIC
// community-media bucket into the PRIVATE caddie-media bucket (migration
// 20260925090000), repoints caddie_analyses at the new object PATHS, then
// removes the public copies that nothing references any more. Separately,
// lists (and optionally removes) orphaned objects no row points at.
//
// Every stage is a separate, explicit run; with no --apply flag the script
// only PRINTS the plan (dry run) and changes nothing. Each stage is
// idempotent and re-derives its plan from live data, so re-running after a
// partial failure is safe.
//
// Prerequisites, in order: migration 20260925090000 applied; analyze-swing
// redeployed; the web app redeployed (so no client is still uploading
// Caddie videos to community-media). The --apply stages refuse to run if
// the caddie-media bucket doesn't exist.
//
// Run locally only. SUPABASE_SERVICE_ROLE_KEY is never read from a file —
// pass it inline for the run (same rule as setup-apple-review-account.ts):
//   SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/migrate-caddie-media-private.ts            # dry run: full plan
//   SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/migrate-caddie-media-private.ts --apply=copy
//   SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/migrate-caddie-media-private.ts --verify      # read-only
//   SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/migrate-caddie-media-private.ts --apply=repoint
//   SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/migrate-caddie-media-private.ts --verify      # read-only
//   (grace period: leave the public originals in place for a few days of real use)
//   SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/migrate-caddie-media-private.ts --apply=delete-public
//   SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/migrate-caddie-media-private.ts --apply=orphans [--include-non-caddie]
// Add --verbose to print every path in the dry-run plan.
//
// Safety order is copy -> verify -> repoint -> verify -> (grace) -> cleanup.
// Nothing is ever moved: "copy" leaves the public original untouched,
// "repoint" only switches a row whose private copy exists with the SAME byte
// size, and "delete-public" only removes a public original whose verified
// private copy is what a row now points at and that no post/row still
// references by URL. Rows are never re-analyzed; only the four media
// columns change (created_at is frozen by trigger; results/scores untouched).
//
// Rollback: until delete-public runs, --apply=rollback-repoint points
// repointed rows back at their (still present) public URL. Copies left in
// caddie-media are harmless (private, owner-only).
//
// What is NOT moved, on purpose:
//   * Ask-Caddie-on-a-Community-post rows (source_type = 'community_post'):
//     their media is the post's public media, published by the user.
//   * Any community-media object a Community post (or post media item)
//     still references — e.g. a Caddie video shared to Community before
//     this change. The analysis gets its own private copy; the post keeps
//     the public original.
//   * A row still processing (< 15 min old): the old pipeline could still
//     write its URL back at completion.
//
// Orphan rules: a community-media object is an orphan when no
// caddie_analyses URL, community_posts URL or community_post_media URL
// references it. Only `caddie-*` files are removed by default (older than
// 24 h, so an upload whose row is still being created is never touched).
// Other orphans (deleted-post photos/videos) are opt-in with
// --include-non-caddie and must be older than 7 days, because CreatePost
// uploads photo items the moment they're picked and a saved draft can sit
// unpublished for days. Private caddie-media orphans (no row path points
// at them, older than 24 h) are listed and removed with the same flag set.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const PUBLIC_BUCKET = "community-media";
const PRIVATE_BUCKET = "caddie-media";
const PUBLIC_MARKER = `/storage/v1/object/public/${PUBLIC_BUCKET}/`;
const PROCESSING_GRACE_MS = 15 * 60 * 1000;
const CADDIE_ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const OTHER_ORPHAN_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LIST_PAGE_SIZE = 1000;
const REMOVE_BATCH_SIZE = 100;

function readEnvLocal(key: string): string | undefined {
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const line = text.split("\n").find((l) => l.trim().startsWith(`${key}=`));
    return line?.split("=").slice(1).join("=").trim();
  } catch {
    return undefined;
  }
}

const args = process.argv.slice(2);
const applyArg = args.find((a) => a.startsWith("--apply="))?.slice("--apply=".length);
const includeNonCaddie = args.includes("--include-non-caddie");
const verbose = args.includes("--verbose");
const verifyOnly = args.includes("--verify");
const STAGES = ["copy", "repoint", "delete-public", "orphans", "rollback-repoint"] as const;
type Stage = (typeof STAGES)[number];
if (applyArg && !STAGES.includes(applyArg as Stage)) {
  console.error(`Unknown --apply stage "${applyArg}". One of: ${STAGES.join(", ")}`);
  process.exit(1);
}
const stage = applyArg as Stage | undefined;

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? readEnvLocal("VITE_SUPABASE_URL");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Needs VITE_SUPABASE_URL (env or .env.local) and SUPABASE_SERVICE_ROLE_KEY (env only, never a file).");
  process.exit(1);
}
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

interface AnalysisRow {
  id: string;
  owner_id: string;
  source_type: string;
  status: string;
  created_at: string;
  source_media_url: string | null;
  thumbnail_url: string | null;
  source_media_path: string | null;
  thumbnail_path: string | null;
}
interface StoredObject {
  path: string;
  size: number;
  createdAt: number;
}

function publicPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf(PUBLIC_MARKER);
  if (i < 0) return null;
  const path = decodeURIComponent(url.slice(i + PUBLIC_MARKER.length).split("?")[0]);
  return path && !path.includes("..") ? path : null;
}

async function listAll(bucket: string, prefix = "", depth = 0): Promise<StoredObject[]> {
  if (depth > 5) return [];
  const out: StoredObject[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: LIST_PAGE_SIZE, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    const entries = data ?? [];
    for (const e of entries) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) out.push(...(await listAll(bucket, path, depth + 1)));
      else
        out.push({
          path,
          size: Number((e.metadata as { size?: number } | null)?.size ?? 0),
          createdAt: e.created_at ? Date.parse(e.created_at) : 0,
        });
    }
    if (entries.length < LIST_PAGE_SIZE) break;
  }
  return out;
}

async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`select ${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function removeAll(bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
    const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
    const { error } = await admin.storage.from(bucket).remove(batch);
    if (error) console.error(`  remove ${bucket} (${batch.length}) failed: ${error.message}`);
    else console.log(`  removed ${batch.length} from ${bucket}`);
  }
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function loadState() {
  const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
  if (bucketError) throw new Error(`listBuckets: ${bucketError.message}`);
  const privateBucket = (buckets ?? []).find((b) => b.id === PRIVATE_BUCKET);

  const rows = await selectAll<AnalysisRow>(
    "caddie_analyses",
    "id, owner_id, source_type, status, created_at, source_media_url, thumbnail_url, source_media_path, thumbnail_path",
  );
  const posts = await selectAll<{ video_url: string | null; video_thumbnail_url: string | null; image_url: string | null }>(
    "community_posts",
    "video_url, video_thumbnail_url, image_url",
  );
  const postMedia = await selectAll<{ media_url: string | null; thumbnail_url: string | null }>("community_post_media", "media_url, thumbnail_url");

  const postRefs = new Set<string>();
  for (const p of posts) for (const u of [p.video_url, p.video_thumbnail_url, p.image_url]) { const x = publicPath(u); if (x) postRefs.add(x); }
  for (const m of postMedia) for (const u of [m.media_url, m.thumbnail_url]) { const x = publicPath(u); if (x) postRefs.add(x); }
  const rowPublicRefs = new Set<string>();
  const rowPrivateRefs = new Set<string>();
  for (const r of rows) {
    for (const u of [r.source_media_url, r.thumbnail_url]) { const x = publicPath(u); if (x) rowPublicRefs.add(x); }
    for (const p of [r.source_media_path, r.thumbnail_path]) if (p) rowPrivateRefs.add(p);
  }

  const publicObjects = await listAll(PUBLIC_BUCKET);
  const privateObjects = privateBucket ? await listAll(PRIVATE_BUCKET) : [];
  return { privateBucketExists: !!privateBucket, privateBucketPublic: privateBucket?.public, rows, postRefs, rowPublicRefs, rowPrivateRefs, publicObjects, privateObjects };
}

type State = Awaited<ReturnType<typeof loadState>>;

interface MovePlan {
  row: AnalysisRow;
  video: string;
  thumb: string | null;
}

function planMoves(s: State): { moves: MovePlan[]; skipped: { id: string; reason: string }[] } {
  const now = Date.now();
  const moves: MovePlan[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const r of s.rows) {
    if (r.source_type !== "direct_upload" || r.source_media_path) continue;
    const video = publicPath(r.source_media_url);
    if (!video) { skipped.push({ id: r.id, reason: "source_media_url is not a community-media URL" }); continue; }
    if (!video.startsWith(`${r.owner_id}/`)) { skipped.push({ id: r.id, reason: `video not in owner folder (${video})` }); continue; }
    if (r.status === "processing" && now - Date.parse(r.created_at) < PROCESSING_GRACE_MS) { skipped.push({ id: r.id, reason: "still processing" }); continue; }
    const thumbCandidate = publicPath(r.thumbnail_url);
    const thumb = thumbCandidate && thumbCandidate.startsWith(`${r.owner_id}/`) ? thumbCandidate : null;
    moves.push({ row: r, video, thumb });
  }
  return { moves, skipped };
}

function planOrphans(s: State) {
  const now = Date.now();
  const caddie: StoredObject[] = [];
  const other: StoredObject[] = [];
  for (const o of s.publicObjects) {
    if (s.postRefs.has(o.path) || s.rowPublicRefs.has(o.path)) continue;
    const file = o.path.split("/").pop() ?? "";
    if (file === ".emptyFolderPlaceholder") continue;
    if (file.startsWith("caddie-")) {
      if (now - o.createdAt >= CADDIE_ORPHAN_MIN_AGE_MS) caddie.push(o);
    } else if (now - o.createdAt >= OTHER_ORPHAN_MIN_AGE_MS) other.push(o);
  }
  const privateOrphans = s.privateObjects.filter(
    (o) => !s.rowPrivateRefs.has(o.path) && now - o.createdAt >= CADDIE_ORPHAN_MIN_AGE_MS && !(o.path.split("/").pop() ?? "").startsWith("."),
  );
  return { caddie, other, privateOrphans };
}

function printList(title: string, items: string[]) {
  console.log(`${title}: ${items.length}`);
  if (verbose) for (const i of items) console.log(`    ${i}`);
}

async function main() {
  const s = await loadState();
  const privateSet = new Set(s.privateObjects.map((o) => o.path));
  const publicSizes = new Map(s.publicObjects.map((o) => [o.path, o.size]));
  const { moves, skipped } = planMoves(s);

  const objectsToCopy = [...new Set(moves.flatMap((m) => (m.thumb ? [m.video, m.thumb] : [m.video])))];
  const missingPublic = objectsToCopy.filter((p) => !publicSizes.has(p));
  const pendingCopy = objectsToCopy.filter((p) => publicSizes.has(p) && !privateSet.has(p));
  const orphans = planOrphans(s);

  console.log(`\n=== Caddie private-bucket migration — ${stage ? `APPLY ${stage}` : "DRY RUN (no changes)"} ===`);
  console.log(`caddie-media bucket: ${s.privateBucketExists ? `exists (public=${s.privateBucketPublic})` : "MISSING — apply migration 20260925090000 first"}`);
  console.log(`caddie_analyses rows: ${s.rows.length}; already private: ${s.rows.filter((r) => r.source_media_path).length}`);
  console.log(`\n[1] direct-upload rows to move: ${moves.length} (skipped: ${skipped.length})`);
  for (const k of skipped) console.log(`    skip ${k.id}: ${k.reason}`);
  printList(`[2] objects to copy into caddie-media (pending)`, pendingCopy.map((p) => `${p} (${mb(publicSizes.get(p) ?? 0)})`));
  console.log(`    already copied: ${objectsToCopy.length - pendingCopy.length - missingPublic.length}; source missing: ${missingPublic.length}`);
  for (const p of missingPublic) console.log(`    MISSING public source: ${p} (row keeps its URL; investigate)`);
  const keptForPosts = objectsToCopy.filter((p) => s.postRefs.has(p));
  printList(`[3] public copies that stay (a Community post uses them)`, keptForPosts);
  printList(
    `[4] caddie-* orphans in community-media (>24h, unreferenced) — ${mb(orphans.caddie.reduce((a, o) => a + o.size, 0))}`,
    orphans.caddie.map((o) => `${o.path} (${mb(o.size)}, ${new Date(o.createdAt).toISOString()})`),
  );
  printList(
    `[5] other orphans in community-media (>7d, opt-in --include-non-caddie) — ${mb(orphans.other.reduce((a, o) => a + o.size, 0))}`,
    orphans.other.map((o) => `${o.path} (${mb(o.size)}, ${new Date(o.createdAt).toISOString()})`),
  );
  printList(`[6] private caddie-media orphans (>24h, no row path)`, orphans.privateOrphans.map((o) => o.path));

  const privateSizes = new Map(s.privateObjects.map((o) => [o.path, o.size]));
  const copyVerified = (p: string) => privateSizes.has(p) && publicSizes.has(p) && privateSizes.get(p) === publicSizes.get(p);
  const sizeMismatch = objectsToCopy.filter((p) => privateSizes.has(p) && publicSizes.has(p) && privateSizes.get(p) !== publicSizes.get(p));
  for (const p of sizeMismatch) console.log(`    SIZE MISMATCH private vs public: ${p} (repoint skips it; remove the bad private copy and re-copy)`);

  if (verifyOnly) {
    // Read-only. Every row must resolve to an object that exists.
    const brokenPrivate = s.rows.filter(
      (r) => (r.source_media_path && !privateSizes.has(r.source_media_path)) || (r.thumbnail_path && !privateSizes.has(r.thumbnail_path)),
    );
    const brokenPublic = s.rows.filter((r) => {
      const v = publicPath(r.source_media_url);
      return !!v && !publicSizes.has(v);
    });
    console.log(`\n[verify] rows pointing at a missing PRIVATE object: ${brokenPrivate.length}`);
    for (const r of brokenPrivate) console.log(`    ${r.id} video=${r.source_media_path} thumb=${r.thumbnail_path}`);
    console.log(`[verify] rows pointing at a missing PUBLIC object: ${brokenPublic.length}`);
    for (const r of brokenPublic) console.log(`    ${r.id} ${publicPath(r.source_media_url)}`);
    console.log(`[verify] copies verified (same size): ${objectsToCopy.filter(copyVerified).length}/${objectsToCopy.length}; size mismatches: ${sizeMismatch.length}`);
    if (brokenPrivate.length > 0) process.exitCode = 2;
    return;
  }

  if (!stage) {
    console.log("\nDry run only. Order: --apply=copy, --verify, --apply=repoint, --verify, (grace period), --apply=delete-public, --apply=orphans");
    return;
  }
  if (!s.privateBucketExists) throw new Error("caddie-media bucket missing — apply migration 20260925090000 first.");
  if (s.privateBucketPublic) throw new Error("caddie-media bucket is PUBLIC — refusing to move private media into it.");

  if (stage === "copy") {
    for (const p of pendingCopy) {
      const { error } = await admin.storage.from(PUBLIC_BUCKET).copy(p, p, { destinationBucket: PRIVATE_BUCKET });
      console.log(error ? `  copy FAILED ${p}: ${error.message}` : `  copied ${p}`);
    }
    return;
  }

  if (stage === "repoint") {
    for (const m of moves) {
      if (!copyVerified(m.video)) { console.log(`  skip ${m.row.id}: private video copy missing or size differs`); continue; }
      const thumbReady = m.thumb && copyVerified(m.thumb);
      const update: Record<string, string | null> = { source_media_path: m.video, source_media_url: null };
      if (thumbReady) { update.thumbnail_path = m.thumb; update.thumbnail_url = null; }
      // Optimistic: only if the row still points at the URL we planned from.
      const { data, error } = await admin
        .from("caddie_analyses")
        .update(update)
        .eq("id", m.row.id)
        .eq("source_media_url", m.row.source_media_url!)
        .is("source_media_path", null)
        .select("id");
      if (error) console.log(`  repoint FAILED ${m.row.id}: ${error.message}`);
      else console.log(data && data.length > 0 ? `  repointed ${m.row.id}${thumbReady ? "" : " (thumbnail left as-is)"}` : `  skip ${m.row.id}: row changed since planning`);
    }
    return;
  }

  if (stage === "delete-public") {
    // Only public objects that (a) have a private copy and (b) nothing
    // references any more — re-derived from live data just loaded above.
    const candidates = s.publicObjects
      .map((o) => o.path)
      .filter((p) => copyVerified(p) && s.rowPrivateRefs.has(p) && !s.rowPublicRefs.has(p) && !s.postRefs.has(p));
    printList("  public copies to remove", candidates);
    await removeAll(PUBLIC_BUCKET, candidates);
    return;
  }

  if (stage === "rollback-repoint") {
    // Points rows back at the public original while it still exists (i.e.
    // before delete-public). Only touches rows whose private path has an
    // identically-named public object.
    const base = `${supabaseUrl}${PUBLIC_MARKER}`;
    for (const r of s.rows) {
      if (!r.source_media_path || !publicSizes.has(r.source_media_path)) continue;
      const update: Record<string, string | null> = { source_media_url: base + r.source_media_path, source_media_path: null };
      if (r.thumbnail_path && publicSizes.has(r.thumbnail_path)) {
        update.thumbnail_url = base + r.thumbnail_path;
        update.thumbnail_path = null;
      }
      const { error } = await admin.from("caddie_analyses").update(update).eq("id", r.id).eq("source_media_path", r.source_media_path);
      console.log(error ? `  rollback FAILED ${r.id}: ${error.message}` : `  rolled back ${r.id}`);
    }
    return;
  }

  if (stage === "orphans") {
    await removeAll(PUBLIC_BUCKET, orphans.caddie.map((o) => o.path));
    if (includeNonCaddie) {
      await removeAll(PUBLIC_BUCKET, orphans.other.map((o) => o.path));
      await removeAll(PRIVATE_BUCKET, orphans.privateOrphans.map((o) => o.path));
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

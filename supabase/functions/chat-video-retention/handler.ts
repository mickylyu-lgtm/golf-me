// chat-video-retention: the 180-day chat video retention and the orphan
// sweep (migration 20261107220000_chat_video_albums). Logic only; wiring in
// index.ts. Node- and Deno-testable (handler.test.ts), no imports.
//
// Order, per run:
//   1. public.chat_video_expire_due(limit): due video items (older than 180
//      days, not under an open report) become {"kind":"video","expired":true}
//      in their row, IN THE DATABASE FIRST, and their objects come back.
//      From that moment no row points at the files, so nobody but their
//      owner can read them, even if the delete below fails.
//   2. Those objects are removed through the Storage API (SQL can't:
//      storage.protect_delete).
//   3. public.chat_video_orphans(limit): chat-video objects no row points
//      at and staged originals, older than a day (a failed delete in step 2,
//      an unsent album whose client delete failed, an abandoned send), are
//      removed the same way. So a failure in 2 is retried here next run.
// Authenticated by the existing internal secret (x-internal-secret ==
// PUSH_INTERNAL_SECRET; the pg_cron job reads push_internal_secret from
// Vault), like send-push. No new secret.

export interface StorageObjectRef {
  bucket: string;
  name: string;
}

export interface RetentionDeps {
  expectedSecret: string | undefined;
  expireDue: (limit: number) => Promise<StorageObjectRef[]>;
  orphans: (limit: number) => Promise<StorageObjectRef[]>;
  remove: (bucket: string, names: string[]) => Promise<{ error?: string }>;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

export const EXPIRE_BATCH = 200;
export const MAX_EXPIRE_ROUNDS = 5;
export const ORPHAN_LIMIT = 500;
export const REMOVE_BATCH = 100;
const ALLOWED_BUCKETS = new Set(["chat-video", "chat-video-incoming"]);

export interface RetentionResult {
  expiredObjects: number;
  orphanObjects: number;
  removed: number;
  errors: string[];
}

/** Groups by bucket (only the two chat video buckets) and removes in batches. */
export async function removeAll(deps: Pick<RetentionDeps, "remove">, refs: StorageObjectRef[]): Promise<{ removed: number; errors: string[] }> {
  const byBucket = new Map<string, string[]>();
  for (const r of refs) {
    if (!ALLOWED_BUCKETS.has(r.bucket) || !r.name) continue;
    const list = byBucket.get(r.bucket) ?? [];
    if (!list.includes(r.name)) list.push(r.name);
    byBucket.set(r.bucket, list);
  }
  let removed = 0;
  const errors: string[] = [];
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += REMOVE_BATCH) {
      const batch = names.slice(i, i + REMOVE_BATCH);
      const { error } = await deps.remove(bucket, batch);
      if (error) errors.push(`remove ${bucket} (${batch.length}): ${error}`);
      else removed += batch.length;
    }
  }
  return { removed, errors };
}

export async function runRetention(deps: RetentionDeps): Promise<RetentionResult> {
  const result: RetentionResult = { expiredObjects: 0, orphanObjects: 0, removed: 0, errors: [] };
  for (let round = 0; round < MAX_EXPIRE_ROUNDS; round++) {
    let due: StorageObjectRef[];
    try {
      due = await deps.expireDue(EXPIRE_BATCH);
    } catch (err) {
      result.errors.push(`expire: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
    if (due.length === 0) break;
    result.expiredObjects += due.length;
    const r = await removeAll(deps, due);
    result.removed += r.removed;
    result.errors.push(...r.errors);
    // Fewer objects than a full batch of messages could produce: done.
    if (due.length < EXPIRE_BATCH) break;
  }
  try {
    const orphans = await deps.orphans(ORPHAN_LIMIT);
    result.orphanObjects = orphans.length;
    const r = await removeAll(deps, orphans);
    result.removed += r.removed;
    result.errors.push(...r.errors);
  } catch (err) {
    result.errors.push(`orphans: ${err instanceof Error ? err.message : String(err)}`);
  }
  return result;
}

export async function handleRetentionRequest(req: Request, deps: RetentionDeps): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!deps.expectedSecret || req.headers.get("x-internal-secret") !== deps.expectedSecret) return json({ error: "unauthorized" }, 401);
  const result = await runRetention(deps);
  deps.log?.("chat-video-retention", { ...result, errors: result.errors.length });
  return json(result, result.errors.length > 0 ? 207 : 200);
}

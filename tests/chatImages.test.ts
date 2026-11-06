// Run: npm run test:chat  (node --test, built-in type stripping)
// Photos in chat (lib/chatImages.ts, lib/chatImageUrlCache.ts, migration
// 20261107170000_chat_images): storage paths, sizes and the encode ladder,
// the EXIF check, feature detection, the composer attachment state machine
// and its send guard, upload / insert outcomes, previews, the signed-URL
// cache, the round chat merge of a photo send, and a static guard on the
// migration (the live checks are the PGlite suite in the scratchpad and
// chat-images-check.sql).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHAT_IMAGE_MAX_EDGE,
  ENCODE_LADDER,
  attachmentReducer,
  canSendDraft,
  chatImageDisplaySize,
  classifyImageInsertError,
  classifyUpload,
  dmImagePath,
  draftSendKey,
  fitWithin,
  imageFromRow,
  imageRowColumns,
  imagesAvailable,
  isMissingImageSupportError,
  isValidThumb,
  jpegMetadataSegments,
  messagePreviewText,
  parseChatImagePath,
  progressStep,
  roundImagePath,
  rowsHaveImageColumn,
  type AttachmentState,
  type ProcessedChatImage,
} from "../src/lib/chatImages.ts";
import { MAX_ATTEMPTS, createChatImageUrlCache, type SignMany } from "../src/lib/chatImageUrlCache.ts";
import { createSendGuard } from "../src/lib/sendGuard.ts";
import { messageActions } from "../src/lib/messageLongPress.ts";
import { createPendingRoundMessage, markRoundMessageSent, mergeRoundMessages, patchRoundPhoto, reconcilePendingRoundMessages } from "../src/lib/roundChat.ts";

const CONV = "0f8fad5b-d9cb-469f-a165-70867728950e";
const MSG = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ROUND = "16fd2706-8baf-433b-82eb-8c7fada847da";

// ---------------------------------------------------------------- paths

test("paths: dm/<conversation>/<message>.jpg and round/<round>/<message>.jpg, lowercase", () => {
  assert.equal(dmImagePath(CONV, MSG), `dm/${CONV}/${MSG}.jpg`);
  assert.equal(roundImagePath(ROUND.toUpperCase(), MSG), `round/${ROUND}/${MSG}.jpg`);
  assert.deepEqual(parseChatImagePath(`dm/${CONV}/${MSG}.jpg`), { scope: "dm", scopeId: CONV, messageId: MSG });
  assert.deepEqual(parseChatImagePath(roundImagePath(ROUND, MSG)), { scope: "round", scopeId: ROUND, messageId: MSG });
});

test("paths: anything that isn't two uuids is refused (no traversal, no other folders)", () => {
  assert.throws(() => dmImagePath("../etc", MSG));
  assert.throws(() => dmImagePath(CONV, `${MSG}/../x`));
  assert.throws(() => roundImagePath(ROUND, "x"));
  for (const bad of [`dm/${CONV}/${MSG}.png`, `dm/${CONV}/../${MSG}.jpg`, `${CONV}/${MSG}.jpg`, `dm/${CONV}/${MSG}.jpg/x`, `chat/${CONV}/${MSG}.jpg`]) {
    assert.equal(parseChatImagePath(bad), null, bad);
  }
});

test("paths: the same rule as the database's insert policy regex", () => {
  const migration = readFileSync(join(import.meta.dirname, "..", "supabase", "migrations", "20261107170000_chat_images.sql"), "utf8");
  assert.ok(migration.includes("'^(dm|round)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.jpg$'"));
  assert.ok(migration.includes("image_path = 'dm/' || conversation_id::text || '/' || id::text || '.jpg'"));
  assert.ok(migration.includes("image_path = 'round/' || round_id::text || '/' || id::text || '.jpg'"));
});

// ---------------------------------------------------------------- sizes

test("size: the long edge is capped at 2048 px, never upscaled, aspect kept", () => {
  assert.deepEqual(fitWithin(4032, 3024, CHAT_IMAGE_MAX_EDGE), { width: 2048, height: 1536 });
  assert.deepEqual(fitWithin(3024, 4032, CHAT_IMAGE_MAX_EDGE), { width: 1536, height: 2048 });
  assert.deepEqual(fitWithin(800, 600, CHAT_IMAGE_MAX_EDGE), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(20000, 10, CHAT_IMAGE_MAX_EDGE), { width: 2048, height: 1 });
  assert.deepEqual(fitWithin(0, 0, CHAT_IMAGE_MAX_EDGE), { width: 1, height: 1 });
});

test("size: the encode ladder never goes above 2048 px and only gets smaller / lower quality", () => {
  assert.equal(ENCODE_LADDER[0].maxEdge, 2048);
  for (let i = 1; i < ENCODE_LADDER.length; i++) {
    const [a, b] = [ENCODE_LADDER[i - 1], ENCODE_LADDER[i]];
    assert.ok(b.maxEdge <= a.maxEdge && b.quality <= a.quality && (b.maxEdge < a.maxEdge || b.quality < a.quality));
  }
});

test("bubble size: reserved from width/height alone, aspect kept inside 240x320, thin strips get a usable edge", () => {
  const land = chatImageDisplaySize(4032, 3024);
  assert.deepEqual(land, { width: 240, height: 180 });
  const port = chatImageDisplaySize(3024, 4032);
  assert.deepEqual(port, { width: 240, height: 320 });
  const tall = chatImageDisplaySize(1000, 4000);
  assert.deepEqual(tall, { width: 96, height: 320 });
  const pano = chatImageDisplaySize(4000, 500);
  assert.deepEqual(pano, { width: 240, height: 96 });
  // Same input, same box: nothing depends on the pixels having loaded.
  assert.deepEqual(chatImageDisplaySize(4032, 3024), land);
});

// ---------------------------------------------------------------- EXIF

function segment(marker: number, payload: Uint8Array): number[] {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
}
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

test("EXIF: a JPEG with an Exif APP1 block (where GPS lives) is detected", () => {
  const exif = new Uint8Array([...ascii("Exif"), 0, 0, ...ascii("MM"), 0, 42, 0, 0, 0, 8]);
  const bytes = new Uint8Array([0xff, 0xd8, ...segment(0xe1, exif), ...segment(0xdb, new Uint8Array(4)), 0xff, 0xda, 0, 2, 0xff, 0xd9]);
  assert.deepEqual(jpegMetadataSegments(bytes), { exif: true, xmp: false, isJpeg: true });
});

test("EXIF: a canvas-style JPEG (JFIF APP0 only) has no EXIF or XMP", () => {
  const jfif = new Uint8Array([...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const bytes = new Uint8Array([0xff, 0xd8, ...segment(0xe0, jfif), ...segment(0xdb, new Uint8Array(4)), 0xff, 0xda, 0, 2, 0xff, 0xd9]);
  assert.deepEqual(jpegMetadataSegments(bytes), { exif: false, xmp: false, isJpeg: true });
});

test("EXIF: XMP is detected too; non-JPEG bytes are not a JPEG", () => {
  const xmp = new Uint8Array([...ascii("http://ns.adobe.com/xap/1.0/"), 0]);
  const bytes = new Uint8Array([0xff, 0xd8, ...segment(0xe1, xmp), 0xff, 0xda, 0, 2]);
  assert.equal(jpegMetadataSegments(bytes).xmp, true);
  assert.equal(jpegMetadataSegments(new Uint8Array([0x89, 0x50, 0x4e, 0x47])).isJpeg, false);
});

// ---------------------------------------------------------------- rows + feature detection

test("rows: image columns <-> ChatImageRef; partial rows are no photo", () => {
  assert.equal(imageFromRow({}), null);
  assert.equal(imageFromRow({ image_path: "dm/x", image_width: null, image_height: 10 }), null);
  assert.deepEqual(imageFromRow({ image_path: "p", image_width: 10, image_height: 20, image_thumb: null }), { path: "p", width: 10, height: 20, thumb: null });
  assert.deepEqual(imageRowColumns({ path: "p", width: 10.4, height: 19.6, thumb: "not-a-data-url" }), { image_path: "p", image_width: 10, image_height: 20, image_thumb: null });
});

test("thumb: only a short JPEG data URL (same rule as the database)", () => {
  assert.equal(isValidThumb("data:image/jpeg;base64,/9j/4AAQ"), true);
  assert.equal(isValidThumb("data:image/png;base64,iVBOR"), false);
  assert.equal(isValidThumb("javascript:alert(1)"), false);
  assert.equal(isValidThumb(`data:image/jpeg;base64,${"A".repeat(3000)}`), false);
});

test("feature detection: rows carrying image_path, the probe, demo, and a latched miss", () => {
  assert.equal(rowsHaveImageColumn([{ id: "1" }]), false);
  assert.equal(rowsHaveImageColumn([{ id: "1" }, { id: "2", image_path: null }]), true);
  assert.equal(imagesAvailable({ isDemo: true, rowsHaveColumn: false, probe: "no", latchedMissing: true }), true);
  assert.equal(imagesAvailable({ isDemo: false, rowsHaveColumn: false, probe: "unknown", latchedMissing: false }), false);
  assert.equal(imagesAvailable({ isDemo: false, rowsHaveColumn: false, probe: "no", latchedMissing: false }), false);
  assert.equal(imagesAvailable({ isDemo: false, rowsHaveColumn: false, probe: "yes", latchedMissing: false }), true);
  assert.equal(imagesAvailable({ isDemo: false, rowsHaveColumn: true, probe: "unknown", latchedMissing: false }), true);
  assert.equal(imagesAvailable({ isDemo: false, rowsHaveColumn: true, probe: "yes", latchedMissing: true }), false);
});

test("feature detection: which errors mean 'not migrated yet'", () => {
  assert.equal(isMissingImageSupportError({ code: "42703", message: 'column messages.image_path does not exist' }), true);
  assert.equal(isMissingImageSupportError({ code: "PGRST204", message: "Could not find the 'image_width' column of 'messages' in the schema cache" }), true);
  assert.equal(isMissingImageSupportError({ statusCode: "404", message: "Bucket not found" }), true);
  assert.equal(isMissingImageSupportError({ code: "42501", message: "new row violates row-level security policy" }), false);
  assert.equal(isMissingImageSupportError({ code: "PGRST204", message: "Could not find the 'reply_to_message_id' column" }), false);
  assert.equal(isMissingImageSupportError(null), false);
});

// ---------------------------------------------------------------- composer attachment

const fakeImage = (n: number): ProcessedChatImage => ({ blob: { size: n } as Blob, width: 800, height: 600, thumb: null, previewUrl: `blob:${n}` });

test("attachment: pick -> processing -> ready; remove / sent clear it", () => {
  let s: AttachmentState = { kind: "none" };
  s = attachmentReducer(s, { type: "pick", key: "a" });
  assert.deepEqual(s, { kind: "processing", key: "a" });
  assert.equal(canSendDraft("", s), false, "can't send while the photo is still processing");
  assert.equal(canSendDraft("hi", s), false, "not even with text: the photo would be dropped");
  s = attachmentReducer(s, { type: "processed", key: "a", image: fakeImage(1) });
  assert.equal(s.kind, "ready");
  assert.equal(canSendDraft("", s), true, "a photo alone can be sent");
  assert.deepEqual(attachmentReducer(s, { type: "remove" }), { kind: "none" });
  assert.deepEqual(attachmentReducer(s, { type: "sent" }), { kind: "none" });
});

test("attachment: a newer pick wins; a stale result or failure is ignored; no-ops keep identity", () => {
  let s: AttachmentState = attachmentReducer({ kind: "none" }, { type: "pick", key: "a" });
  s = attachmentReducer(s, { type: "pick", key: "b" });
  const stale = attachmentReducer(s, { type: "processed", key: "a", image: fakeImage(1) });
  assert.equal(stale, s);
  assert.equal(attachmentReducer(s, { type: "failed", key: "a" }), s);
  assert.deepEqual(attachmentReducer(s, { type: "failed", key: "b" }), { kind: "none" });
  const none: AttachmentState = { kind: "none" };
  assert.equal(attachmentReducer(none, { type: "remove" }), none);
  assert.equal(canSendDraft("", none), false);
  assert.equal(canSendDraft("  ", none), false);
});

test("send guard: a photo-only draft sends once; the same photo can't go twice; text-only unchanged", () => {
  const guard = createSendGuard();
  assert.equal(draftSendKey("hello", null), "hello", "text-only drafts are exactly what they were");
  assert.equal(guard.claim(draftSendKey("", "p1")), true, "photo with no text is a draft");
  assert.equal(guard.claim(draftSendKey("", "p1")), false, "Enter + tap on the same photo: one send");
  assert.equal(guard.claim(draftSendKey("", "p2")), true, "another photo is a new draft");
  guard.release();
  assert.equal(guard.claim(draftSendKey("", "p2")), true);
  assert.notEqual(draftSendKey("x", "p1"), draftSendKey("x", "p2"));
  assert.notEqual(draftSendKey("x", "p1"), draftSendKey("x", null));
});

// ---------------------------------------------------------------- upload / insert outcomes

test("upload outcome: ok, our own earlier upload (409 / Duplicate), refused, network", () => {
  assert.equal(classifyUpload({ ok: true, status: 200 }), "uploaded");
  assert.equal(classifyUpload({ ok: false, status: 409, message: "Duplicate The resource already exists" }), "uploaded");
  assert.equal(classifyUpload({ ok: false, status: 400, message: "Duplicate" }), "uploaded");
  assert.equal(classifyUpload({ ok: false, status: 403, message: "new row violates row-level security policy" }), "rejected");
  assert.equal(classifyUpload({ ok: false, status: 400, message: "Unauthorized new row violates row-level security policy" }), "rejected");
  assert.equal(classifyUpload({ ok: false, status: 0 }), "network");
  assert.equal(classifyUpload({ ok: false, status: 503 }), "network");
  assert.equal(classifyUpload({ ok: false, status: 413, message: "Payload too large" }), "network");
});

test("insert outcome: 23505 = an earlier attempt landed (sent, never a second message)", () => {
  assert.equal(classifyImageInsertError({ code: "23505", message: "duplicate key value violates unique constraint \"messages_pkey\"" }), "sent");
  assert.equal(classifyImageInsertError({ code: "P0001", hint: "objectionable_content" }), "objectionable");
  assert.equal(classifyImageInsertError({ code: "42501", message: "new row violates row-level security policy" }), "rejected");
  assert.equal(classifyImageInsertError({ code: "42501", hint: "image_not_uploaded" }), "rejected");
  assert.equal(classifyImageInsertError({ message: "Failed to fetch" }), "network");
  assert.equal(classifyImageInsertError(undefined), "network");
});

test("progress: only 10% steps re-render", () => {
  assert.deepEqual([0, 0.04, 0.1, 0.19, 0.55, 0.999, 1, 2].map(progressStep), [0, 0, 0.1, 0.1, 0.5, 0.9, 1, 1]);
});

// ---------------------------------------------------------------- previews + menu

test("preview: '[Photo]' for a photo, '[Photo] caption' with text, text otherwise", () => {
  const image = { path: "p", width: 1, height: 1 };
  assert.equal(messagePreviewText({ text: "", image }, "[Photo]"), "[Photo]");
  assert.equal(messagePreviewText({ text: " nice drive ", image }, "[Photo]"), "[Photo] nice drive");
  assert.equal(messagePreviewText({ text: "plain", image: null }, "[Photo]"), "plain");
  assert.equal(messagePreviewText({ text: "plain" }, "[Photo]"), "plain");
});

test("menu: Copy hidden only when told (photo, no text, no image clipboard)", () => {
  assert.deepEqual(messageActions({ canReply: true, canUnsend: true }), ["reply", "copy", "unsend"]);
  assert.deepEqual(messageActions({ canReply: true, canUnsend: false, canCopy: false }), ["reply"]);
  assert.deepEqual(messageActions({ canReply: false, canUnsend: false, canCopy: true }), ["copy"]);
});

// ---------------------------------------------------------------- signed URL cache

function harness(results?: (paths: string[]) => (string | null)[]) {
  let now = 1_000_000;
  const calls: string[][] = [];
  const queue: (() => void)[] = [];
  const sign: SignMany = async (paths, ttl) => {
    calls.push([...paths]);
    const urls = results ? results(paths) : paths.map((p) => `https://x/sign/${p}?t=${now}&ttl=${ttl}`);
    return paths.map((path, i) => ({ path, url: urls[i] }));
  };
  const cache = createChatImageUrlCache({ sign, ttlSeconds: 600, now: () => now, schedule: (fn) => queue.push(fn) });
  const flush = async () => {
    while (queue.length) queue.shift()!();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { cache, calls, flush, advance: (ms: number) => (now += ms) };
}

test("urls: requests in one tick are signed in one call, then reused", async () => {
  const h = harness();
  const a = h.cache.get("dm/a");
  const b = h.cache.get("dm/b");
  const a2 = h.cache.get("dm/a");
  await h.flush();
  assert.deepEqual(h.calls, [["dm/a", "dm/b"]]);
  assert.equal(await a, await a2);
  assert.ok((await b)?.includes("dm/b"));
  assert.equal(h.cache.peek("dm/a"), await a);
  assert.equal(await h.cache.get("dm/a"), await a, "no second call");
  assert.equal(h.calls.length, 1);
});

test("urls: re-signed shortly before expiry (never served stale)", async () => {
  const h = harness();
  const first = h.cache.get("dm/a");
  await h.flush();
  const url1 = await first;
  h.advance(600_000 - 61_000);
  assert.equal(h.cache.peek("dm/a"), url1, "still well inside its life");
  h.advance(2_000);
  assert.equal(h.cache.peek("dm/a"), null, "inside the refresh margin: not handed out");
  const second = h.cache.get("dm/a");
  await h.flush();
  assert.notEqual(await second, url1);
  assert.equal(h.calls.length, 2);
});

test("urls: a failed load (expired / 403) re-signs, but gives up after MAX_ATTEMPTS; a load resets it", async () => {
  const h = harness();
  void h.cache.get("dm/a");
  await h.flush();
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    assert.equal(h.cache.invalidate("dm/a"), true);
    const again = h.cache.get("dm/a");
    await h.flush();
    assert.ok(await again);
  }
  assert.equal(h.cache.invalidate("dm/a"), false, "stop: no retry loop");
  assert.equal(await h.cache.get("dm/a"), null);
  h.cache.loaded("dm/a");
  const fresh = h.cache.get("dm/a");
  await h.flush();
  assert.ok(await fresh);
});

test("urls: not visible = null (the bucket's select policy refused to sign)", async () => {
  const h = harness((paths) => paths.map(() => null));
  const r = h.cache.get("dm/secret");
  await h.flush();
  assert.equal(await r, null);
  assert.equal(h.cache.peek("dm/secret"), null);
});

test("urls: a local copy wins and is never signed; reset drops everything and returns local URLs", async () => {
  const h = harness();
  h.cache.setLocal("dm/mine", "blob:local");
  assert.equal(await h.cache.get("dm/mine"), "blob:local");
  assert.equal(h.cache.invalidate("dm/mine"), false);
  assert.equal(h.calls.length, 0);
  const pending = h.cache.get("dm/other");
  assert.deepEqual(h.cache.reset(), ["blob:local"]);
  assert.equal(await pending, null, "a request from before the reset resolves empty");
  await h.flush();
  assert.equal(h.cache.peek("dm/mine"), null);
});

test("urls: subscribers hear about a path's new URL", async () => {
  const h = harness();
  const heard: string[] = [];
  const off = h.cache.subscribe((p) => heard.push(p));
  void h.cache.get("dm/a");
  await h.flush();
  h.cache.setLocal("dm/b", "blob:b");
  off();
  h.cache.setLocal("dm/c", "blob:c");
  assert.deepEqual(heard, ["dm/a", "dm/b"]);
});

// ---------------------------------------------------------------- round chat merge

const photo = { messageId: MSG, localUrl: "blob:p", width: 800, height: 600, thumb: null, progress: 0.3 };

test("round merge: a sending photo shows its local copy and progress; failed shows why", () => {
  const pending = [createPendingRoundMessage({ clientId: `temp-${MSG}`, roundId: ROUND, senderId: "me", text: "", photo })];
  const [m] = mergeRoundMessages([], pending, ROUND);
  assert.equal(m.delivery, "sending");
  assert.deepEqual(m.image, { path: `pending/${MSG}`, width: 800, height: 600, thumb: null });
  assert.deepEqual(m.outgoingPhoto, { localUrl: "blob:p", progress: 0.3, failure: undefined });
  const failed = patchRoundPhoto([{ ...pending[0], state: "failed" as const }], `temp-${MSG}`, { failure: "rejected" });
  const [f] = mergeRoundMessages([], failed, ROUND);
  assert.equal(f.delivery, "failed");
  assert.equal(f.outgoingPhoto?.failure, "rejected");
  assert.equal(f.outgoingPhoto?.progress, undefined);
});

test("round merge: once a row with the photo's id arrives, the pending one goes (even before 'sent' was heard)", () => {
  const path = roundImagePath(ROUND, MSG);
  const pending = [createPendingRoundMessage({ clientId: `temp-${MSG}`, roundId: ROUND, senderId: "me", text: "", photo: { ...photo, path } })];
  const row = { id: MSG, round_id: ROUND, sender_id: "me", text: "", created_at: new Date().toISOString(), image_path: path, image_width: 800, image_height: 600, image_thumb: null };
  assert.deepEqual(reconcilePendingRoundMessages(pending, [row]), []);
  const merged = mergeRoundMessages([row], pending, ROUND);
  assert.equal(merged.length, 1, "no second bubble");
  assert.deepEqual(merged[0].image, { path, width: 800, height: 600, thumb: null });
  // Sent (row not here yet): a normal message with its real path.
  const sent = markRoundMessageSent(pending, `temp-${MSG}`, { id: MSG, created_at: row.created_at });
  const [s] = mergeRoundMessages([], sent, ROUND);
  assert.equal(s.delivery, undefined);
  assert.equal(s.id, MSG);
  assert.equal(s.image?.path, path);
});

test("round merge: text-only rows get no image key (unchanged shape)", () => {
  const row = { id: MSG, round_id: ROUND, sender_id: "x", text: "hi", created_at: "2026-11-06T10:00:00Z" };
  const [m] = mergeRoundMessages([row], [], ROUND);
  assert.equal("image" in m, false);
});

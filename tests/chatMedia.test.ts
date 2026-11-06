// lib/chatMedia.ts: videos and albums in chat (paths, the row's media
// array mirrored against the database rule, the composer list, previews,
// the deck's gesture math, per-item send state).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_MAX_ITEMS,
  VIDEO_MAX_MS,
  albumProgress,
  classifyVideoProcess,
  deckAxis,
  deckCardStyle,
  deckDisplaySize,
  deckIndexAfterSwipe,
  formatVideoDuration,
  isMissingMediaSupportError,
  isValidMediaValue,
  localWindowUrl,
  mediaAttachmentReducer,
  mediaFromRow,
  mediaKindOfFile,
  mediaLabel,
  mediaObjectNames,
  mediaPrefix,
  mediaReady,
  mediaRowValue,
  mediaSendKey,
  needsTrim,
  readyDraftItems,
  sendShape,
  sentMediaItems,
  stagedVideoPath,
  toMediaSendItems,
  videoDisplaySize,
  type MediaAttachmentItem,
  type PreparedChatVideo,
} from "../src/lib/chatMedia.ts";

const C = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const U = "33333333-3333-4333-8333-333333333333";
const P = `dm/${C}/${M}`;

test("paths: prefix, items, staged original; uuids only", () => {
  assert.equal(mediaPrefix("dm", C.toUpperCase(), M), P);
  assert.equal(stagedVideoPath(U, M, 3), `${U}/${M}-3.orig`);
  assert.throws(() => mediaPrefix("round", "x", M));
});

test("row value: built paths always pass the database rule (mirror)", () => {
  const items = [
    { kind: "image" as const, width: 1600.4, height: 1200, thumb: "data:image/jpeg;base64,AAAA" },
    { kind: "video" as const, width: 1280, height: 720, durationMs: 59_999.6 },
    { kind: "image" as const, width: 9000, height: 0, thumb: "javascript:x" },
  ];
  const value = mediaRowValue(P, items);
  assert.equal(isValidMediaValue(value, P), true, JSON.stringify(value));
  assert.deepEqual(value[1], { kind: "video", path: `${P}/1.mp4`, poster: `${P}/1.poster.jpg`, w: 1280, h: 720, ms: 60_000 });
  assert.equal("thumb" in value[2], false);
  assert.deepEqual([value[2].w, value[2].h], [4096, 1]);
});

test("database rule mirror: refuses what the CHECK refuses", () => {
  const ok = mediaRowValue(P, [{ kind: "image", width: 10, height: 10 }]);
  assert.equal(isValidMediaValue(ok, P), true);
  const bad: unknown[] = [
    [],
    Array.from({ length: 11 }, (_, i) => ({ kind: "image", path: `${P}/${i}.jpg`, w: 1, h: 1 })),
    [{ kind: "image", path: `${P}/1.jpg`, w: 1, h: 1 }], // wrong position
    [{ kind: "image", path: `dm/${C}/${U}/0.jpg`, w: 1, h: 1 }], // other message
    [{ kind: "image", path: `${P}/0.jpg`, w: 1, h: 1, url: "x" }], // unknown key
    [{ kind: "video", path: `${P}/0.mp4`, w: 1, h: 1, ms: 5 }], // no poster
    [{ kind: "video", path: `${P}/0.mp4`, poster: `${P}/0.poster.jpg`, w: 1, h: 1, ms: 70_000 }],
    [{ kind: "video", expired: true, path: `${P}/0.mp4`, w: 1, h: 1, ms: 5 }],
    [{ kind: "audio", path: `${P}/0.jpg`, w: 1, h: 1 }],
    [{ kind: "image", path: `${P}/0.jpg`, w: 1.5, h: 1 }],
  ];
  for (const b of bad) assert.equal(isValidMediaValue(b, P), false, JSON.stringify(b));
  assert.equal(isValidMediaValue([{ kind: "video", expired: true, w: 1, h: 1, ms: 5 }], P), true);
});

test("rows: media parsed safely; expired kept with its size; objects listed for deletion", () => {
  const items = mediaFromRow([
    { kind: "image", path: `${P}/0.jpg`, w: 10, h: 20, thumb: "data:image/jpeg;base64,AA==" },
    { kind: "video", expired: true, w: 1280, h: 720, ms: 9000 },
    { kind: "video", path: `${P}/2.mp4`, poster: `${P}/2.poster.jpg`, w: 720, h: 1280, ms: 3000 },
    { kind: "bogus" },
    null,
  ]);
  assert.equal(items?.length, 3);
  assert.equal(items?.[1].expired, true);
  assert.deepEqual(mediaObjectNames(items), [`${P}/0.jpg`, `${P}/2.mp4`, `${P}/2.poster.jpg`]);
  assert.equal(mediaFromRow(null), null);
  assert.equal(mediaFromRow("[]"), null);
});

test("feature detection: missing media column", () => {
  assert.equal(isMissingMediaSupportError({ code: "PGRST204", message: "Could not find the 'media' column of 'messages'" }), true);
  assert.equal(isMissingMediaSupportError({ code: "42703", message: 'column messages.media does not exist' }), true);
  assert.equal(isMissingMediaSupportError({ code: "42501", message: "row-level security" }), false);
  assert.equal(isMissingMediaSupportError({ code: "PGRST204", message: "Could not find the 'audio_path' column" }), false);
});

test("previews: [Video], [3 photos], [2 photos, 1 video]", () => {
  const t = {
    video: "[Video]",
    photos: (n: number) => (n === 1 ? "1 photo" : `${n} photos`),
    videos: (n: number) => (n === 1 ? "1 video" : `${n} videos`),
    mixed: (p: string, v: string) => `${p}, ${v}`,
    list: (s: string) => `[${s}]`,
  };
  assert.equal(mediaLabel([{ kind: "video" }], t), "[Video]");
  assert.equal(mediaLabel([{ kind: "image" }, { kind: "image" }, { kind: "image" }], t), "[3 photos]");
  assert.equal(mediaLabel([{ kind: "video" }, { kind: "video" }], t), "[2 videos]");
  assert.equal(mediaLabel([{ kind: "image" }, { kind: "video" }, { kind: "image" }], t), "[2 photos, 1 video]");
});

const video = (sourceDurationMs: number): PreparedChatVideo => ({ file: new File(["x"], "a.mov", { type: "video/quicktime" }), localUrl: "blob:v", posterUrl: "blob:p", width: 1920, height: 1080, sourceDurationMs, trim: null });
const image = { blob: new Blob(["x"]), width: 100, height: 50, thumb: null, previewUrl: "blob:i" };

test("composer: up to the limit, in order; long video waits for a trim; stale results ignored", () => {
  let s: readonly MediaAttachmentItem[] = [];
  s = mediaAttachmentReducer(s, { type: "add", items: Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, kind: i === 1 ? "video" : "image" })), limit: MEDIA_MAX_ITEMS });
  assert.equal(s.length, MEDIA_MAX_ITEMS);
  assert.equal(mediaReady(s), false);
  assert.equal(mediaAttachmentReducer(s, { type: "add", items: [{ key: "z", kind: "image" }], limit: MEDIA_MAX_ITEMS }), s);
  s = mediaAttachmentReducer(s, { type: "videoRead", key: "k1", video: video(95_000) });
  assert.equal(s[1].state, "trimming");
  s = mediaAttachmentReducer(s, { type: "trimmed", key: "k1", trim: { startMs: 30_000, endMs: 90_000 } });
  assert.equal(s[1].state, "ready");
  for (let i = 0; i < 10; i++) if (i !== 1) s = mediaAttachmentReducer(s, { type: "imageReady", key: `k${i}`, image });
  assert.equal(mediaReady(s), true);
  assert.equal(sendShape(s), "media");
  assert.equal(mediaAttachmentReducer(s, { type: "imageReady", key: "gone", image }), s);
  const drafts = readyDraftItems(s);
  assert.equal(drafts.length, 10);
  const items = toMediaSendItems(drafts);
  assert.equal(items[1].durationMs, 60_000);
  assert.deepEqual(items[1].trim, { startMs: 30_000, endMs: 90_000 });
  assert.match(mediaSendKey(s) ?? "", /^media:k0,k1/);
  s = mediaAttachmentReducer(s, { type: "remove", key: "k1" });
  assert.equal(s.length, 9);
  assert.equal(mediaAttachmentReducer([], { type: "clear" }).length, 0);
});

test("shape: one photo keeps the single-photo path; one video or several items are media", () => {
  const photo: MediaAttachmentItem = { key: "a", kind: "image", state: "ready", image };
  const vid: MediaAttachmentItem = { key: "b", kind: "video", state: "ready", video: video(5000) };
  assert.equal(sendShape([]), "none");
  assert.equal(sendShape([photo]), "photo");
  assert.equal(sendShape([vid]), "media");
  assert.equal(sendShape([photo, photo]), "media");
  assert.equal(needsTrim({ sourceDurationMs: VIDEO_MAX_MS + 100, trim: null }), false);
  assert.equal(needsTrim({ sourceDurationMs: 61_000, trim: null }), true);
  assert.equal(needsTrim({ sourceDurationMs: 0, trim: null }), false);
});

test("files: kind from type, then name", () => {
  assert.equal(mediaKindOfFile({ type: "video/quicktime", name: "x" }), "video");
  assert.equal(mediaKindOfFile({ type: "image/heic", name: "x" }), "image");
  assert.equal(mediaKindOfFile({ type: "", name: "IMG_0001.MOV" }), "video");
  assert.equal(mediaKindOfFile({ type: "application/pdf", name: "a.pdf" }), null);
  assert.equal(localWindowUrl("blob:a", { startMs: 1500, endMs: 9000 }), "blob:a#t=1.50,9.00");
  assert.equal(localWindowUrl("blob:a", null), "blob:a");
});

test("sending: progress, transcoder answers, final sizes from the transcoder", () => {
  assert.equal(albumProgress([{ progress: 0.5, done: false }, { progress: 0, done: true }]), 0.75);
  assert.equal(classifyVideoProcess(200, undefined), "ok");
  assert.equal(classifyVideoProcess(403, "not_allowed"), "rejected");
  assert.equal(classifyVideoProcess(422, "decode_failed"), "rejected");
  assert.equal(classifyVideoProcess(413, "too_large"), "rejected");
  assert.equal(classifyVideoProcess(502, "source_fetch_failed"), "network");
  assert.equal(classifyVideoProcess(0, undefined), "network");
  const items = toMediaSendItems([{ kind: "video", video: { ...video(10_000), width: 0, height: 0 } }]);
  assert.deepEqual([items[0].width, items[0].height], [1280, 720]);
  items[0].result = { width: 720, height: 1280, durationMs: 9_990 };
  assert.deepEqual(sentMediaItems(items)[0], { kind: "video", width: 720, height: 1280, durationMs: 9_990 });
});

test("deck: box reserved from the first item; flip rules; gesture axis; reduced motion = flat", () => {
  const box = deckDisplaySize([{ width: 1600, height: 1200 }, { width: 100, height: 900 }]);
  assert.deepEqual(box, deckDisplaySize([{ width: 1600, height: 1200 }]), "only the first item shapes the box");
  assert.ok(box.width <= 210 + 28 && box.height <= 260 + 14);
  assert.equal(deckIndexAfterSwipe(0, 5, -60), 1);
  assert.equal(deckIndexAfterSwipe(1, 5, 60), 0);
  assert.equal(deckIndexAfterSwipe(0, 5, 60), 0);
  assert.equal(deckIndexAfterSwipe(4, 5, -80), 4);
  assert.equal(deckIndexAfterSwipe(2, 5, -20), 2);
  assert.equal(deckIndexAfterSwipe(2, 5, -20, -0.9), 3);
  assert.equal(deckAxis(3, 2), "pending");
  assert.equal(deckAxis(20, 5), "deck");
  assert.equal(deckAxis(5, 20), "scroll");
  const top = deckCardStyle(2, 2, 5, 0, false);
  const behind = deckCardStyle(3, 2, 5, 0, false);
  const past = deckCardStyle(1, 2, 5, 0, false);
  assert.ok(top.z > behind.z && behind.opacity === 1 && past.opacity === 0 && behind.rotate !== 0);
  const flat = deckCardStyle(3, 2, 5, 0, true);
  assert.equal(flat.opacity, 0);
  assert.equal(deckCardStyle(2, 2, 5, 30, true).rotate, 0);
  assert.equal(formatVideoDuration(59_400), "0:59");
  assert.equal(formatVideoDuration(60_000), "1:00");
  assert.deepEqual(videoDisplaySize(1280, 720), { width: 240, height: 135 });
  assert.deepEqual(videoDisplaySize(0, 0), { width: 240, height: 135 });
});

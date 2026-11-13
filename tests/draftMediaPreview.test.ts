import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { draftMediaPreview } from "../src/lib/draftMediaPreview.ts";
import type { MediaAttachmentItem } from "../src/lib/chatMedia.ts";

const photo = { key: "photo", generation: 1, kind: "image", state: "ready",
  image: { previewUrl: "blob:photo" } } as MediaAttachmentItem;
const video = { key: "video", generation: 1, kind: "video", state: "ready",
  video: { localUrl: "blob:video", posterUrl: "blob:poster", trim: { startMs: 10000, endMs: 20000 } } } as MediaAttachmentItem;

test("photo opens repeatedly without removing or replacing the draft", () => {
  const items = Object.freeze([photo, video]);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(draftMediaPreview(items, photo), { id: "photo", type: "image", url: "blob:photo" });
    assert.equal(draftMediaPreview(items, null), null);
    assert.equal(items[0], photo);
    assert.equal(items[1], video);
  }
});
test("video previews the selected trim with playback controls", () => {
  assert.deepEqual(draftMediaPreview([video], video), { id: "video", type: "video",
    url: "blob:video#t=10.00,20.00", thumbnailUrl: "blob:poster", nativeControls: true });
});
test("whole video and missing poster remain previewable", () => {
  const whole = { ...video, video: { localUrl: "blob:whole", posterUrl: null, trim: null } } as MediaAttachmentItem;
  assert.equal(draftMediaPreview([whole], whole)?.url, "blob:whole");
  assert.equal(draftMediaPreview([whole], whole)?.thumbnailUrl, undefined);
});
test("processing, trimming, removal, sending, and another conversation never show stale media", () => {
  const processing: MediaAttachmentItem = { key: "processing", kind: "image", state: "processing" };
  const trimming = { ...video, state: "trimming" } as MediaAttachmentItem;
  assert.equal(draftMediaPreview([processing], processing), null);
  assert.equal(draftMediaPreview([trimming], trimming), null);
  assert.equal(draftMediaPreview([], photo), null);
  assert.equal(draftMediaPreview([video], photo), null);
  assert.equal(draftMediaPreview([{ ...photo, generation: 2 }], photo), null);
});
test("shared strip uses separate accessible preview and remove controls; close only clears selection", () => {
  const strip = readFileSync(new URL("../src/components/chat/MediaAttachmentStrip.tsx", import.meta.url), "utf8");
  assert.match(strip, /aria-haspopup="dialog"/);
  assert.match(strip, /disabled=\{it.state !== "ready"\}/);
  assert.match(strip, /onClick=\{\(\) => setSelected\(it\)\}/);
  assert.match(strip, /onClose=\{\(\) => setSelected\(null\)\}/);
  assert.match(strip, /<\/button>\s*\{!single/);
  assert.doesNotMatch(strip, /revokeObjectURL|\.send\(/);
  for (const path of ["../src/pages/DirectMessageThread.tsx", "../src/components/chat/GroupChat.tsx"]) {
    assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), /<MediaAttachmentStrip/);
  }
});

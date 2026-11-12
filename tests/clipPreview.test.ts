// Run: node --test tests/clipPreview.test.ts  (built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clipPlayFrom, clipPlaybackStep, clipPreviewRange, clipSeconds, ensureInlinePlayback } from "../src/lib/clipPreview.ts";

test("a trimmed section is the range, whatever the source length", () => {
  assert.deepEqual(clipPreviewRange(4.959, 14.959, 18.73), { start: 4.959, end: 14.959, trimmed: true });
  assert.deepEqual(clipPreviewRange(4.959, 14.959, undefined), { start: 4.959, end: 14.959, trimmed: true });
});

test("an untrimmed clip is the whole clip once its length is known", () => {
  assert.equal(clipPreviewRange(undefined, undefined, undefined), null);
  assert.equal(clipPreviewRange(undefined, undefined, Number.NaN), null);
  assert.deepEqual(clipPreviewRange(undefined, undefined, 6.2), { start: 0, end: 6.2, trimmed: false });
});

test("a broken trim window falls back to the whole clip", () => {
  assert.deepEqual(clipPreviewRange(8, 8, 9), { start: 0, end: 9, trimmed: false });
});

test("summary seconds round to whole seconds, never zero", () => {
  assert.equal(clipSeconds({ start: 4.959, end: 14.959, trimmed: true }), 10);
  assert.equal(clipSeconds({ start: 0, end: 0.2, trimmed: false }), 1);
});

test("playback stops at the section's end and rewinds to its start", () => {
  const range = { start: 5, end: 15, trimmed: true };
  assert.deepEqual(clipPlaybackStep(10, range), { action: "continue" });
  assert.deepEqual(clipPlaybackStep(14.97, range), { action: "stop", to: 5 });
  assert.deepEqual(clipPlaybackStep(16, range), { action: "stop", to: 5 });
  assert.deepEqual(clipPlaybackStep(0, range), { action: "seek", to: 5 });
});

test("play starts from the section's start when at its end or before it", () => {
  const range = { start: 5, end: 15, trimmed: true };
  assert.equal(clipPlayFrom(15, range), 5);
  assert.equal(clipPlayFrom(0, range), 5);
  assert.equal(clipPlayFrom(7.5, range), 7.5);
});

test("ensureInlinePlayback sets playsinline before any play()", () => {
  const attrs = new Map<string, string>();
  const video = {
    playsInline: false,
    hasAttribute: (n: string) => attrs.has(n),
    setAttribute: (n: string, v: string) => attrs.set(n, v),
  } as unknown as HTMLVideoElement;
  ensureInlinePlayback(video);
  assert.equal(video.playsInline, true);
  assert.equal(attrs.has("playsinline"), true);
});

// Regression guard for the fullscreen-on-confirm bug: on iOS a <video>
// without playsinline that is play()ed goes to the system fullscreen player.
// Every <video> on the Analyze a Swing path must be inline and must not use
// the native controls (whose scrubber shows the whole original video).
test("every Analyze a Swing <video> plays inline, with no native controls", () => {
  for (const path of ["src/pages/AnalyzeSwing.tsx", "src/components/caddie/SelectedClipPreview.tsx", "src/components/caddie/VideoTrimSelector.tsx"]) {
    const src = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const tags = src.match(/<video\s[^>]*>/g) ?? [];
    for (const tag of tags) {
      assert.match(tag, /\bplaysInline\b/, `${path}: ${tag}`);
      assert.doesNotMatch(tag, /\bcontrols\b/, `${path}: ${tag}`);
    }
  }
  const page = readFileSync(new URL("../src/pages/AnalyzeSwing.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /\.play\(\)/, "AnalyzeSwing must not call play() itself; SelectedClipPreview owns playback");
});

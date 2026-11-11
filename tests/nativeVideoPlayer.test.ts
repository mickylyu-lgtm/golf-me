import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { activeNativeVideo, openVideoNatively, NATIVE_GRACE_MS } from "../src/lib/nativeVideoPlayer.ts";
import { openChatVideoNatively } from "../src/lib/chatNativeVideo.ts";

class Video extends EventTarget {
  controls = false; muted = true; loop = true; paused = true;
  currentTime = 4; readyState = 1; parentElement = null;
  webkitDisplayingFullscreen = false; webkitPresentationMode = "inline";
  attrs = new Set<string>(); calls: { controls: boolean; muted: boolean; loop: boolean }[] = [];
  behavior = "native"; failPlay = false;
  setAttribute(key: string) { this.attrs.add(key); }
  removeAttribute(key: string) { this.attrs.delete(key); }
  play() {
    this.calls.push({ controls: this.controls, muted: this.muted, loop: this.loop });
    if (this.failPlay) { this.failPlay = false; return Promise.reject(Error("autoplay refused")); }
    this.paused = false; return Promise.resolve();
  }
  pause() { this.paused = true; }
  webkitEnterFullscreen() {
    if (this.behavior === "throw") throw Error("refused");
    if (this.behavior === "silent") return;
    this.webkitDisplayingFullscreen = true;
    this.dispatchEvent(new Event("webkitbeginfullscreen"));
  }
  webkitExitFullscreen() {
    this.webkitDisplayingFullscreen = false;
    this.dispatchEvent(new Event("webkitendfullscreen"));
  }
}
let cancel: (() => void) | undefined;
afterEach(() => { cancel?.(); cancel = undefined; });
function setup() {
  const timers = new Map<number, () => void>(); let id = 0;
  const doc = Object.assign(new EventTarget(), { body: {}, fullscreenElement: null as Video | null, querySelectorAll: () => [] as Video[] });
  Object.assign(globalThis, {
    window: { setTimeout: (fn: () => void, delay: number) => { assert.equal(delay, NATIVE_GRACE_MS); timers.set(++id, fn); return id; }, clearTimeout: (key: number) => timers.delete(key) },
    document: doc, HTMLMediaElement: { HAVE_METADATA: 1 }, HTMLAudioElement: class {},
  });
  const video = new Video(); let refused = 0; let ended = 0;
  const open = () => {
    const session = openVideoNatively(video as unknown as HTMLVideoElement, { onRefused: () => refused++, onEnd: () => ended++ });
    cancel = session?.cancel; return session;
  };
  return { video, doc, open, timers, counts: () => ({ refused, ended }), flush: () => { for (const fn of [...timers.values()]) fn(); timers.clear(); } };
}
test("chat preserves the same shared native session API", () => assert.equal(openChatVideoNatively, openVideoNatively));
test("opening uses real controls, sound and play once, from the beginning", () => {
  const h = setup(); h.open();
  assert.deepEqual(h.video.calls, [{ controls: true, muted: false, loop: false }]);
  assert.equal(h.video.currentTime, 0);
  assert.equal(activeNativeVideo(), h.video);
  h.flush(); assert.deepEqual(h.counts(), { refused: 0, ended: 0 });
});
test("native dismissal restores muted looping feed without browser controls", () => {
  const h = setup(); h.open(); h.video.webkitExitFullscreen(); h.flush();
  assert.deepEqual(h.counts(), { refused: 0, ended: 1 });
  assert.equal(h.video.controls, false); assert.equal(h.video.loop, true); assert.equal(h.video.muted, true);
  assert.equal(h.video.attrs.size, 0); assert.equal(activeNativeVideo(), null);
});
test("quick open then dismiss never opens a second fallback", () => {
  const h = setup(); h.open(); h.video.webkitExitFullscreen(); h.flush();
  assert.deepEqual(h.counts(), { refused: 0, ended: 1 });
});
test("repeated tap on the same video returns one session", () => {
  const h = setup(); const a = h.open(); const b = h.open();
  assert.equal(a, b); assert.equal(h.video.calls.length, 1);
});
test("missing metadata refuses safely and restores inline attributes", () => {
  const h = setup(); h.video.readyState = 0;
  assert.equal(h.open(), null); h.flush();
  assert.deepEqual(h.counts(), { refused: 1, ended: 0 });
  assert.equal(h.video.controls, false); assert.equal(h.video.paused, true);
});
test("WebKit throwing opens fallback once", () => {
  const h = setup(); h.video.behavior = "throw";
  assert.equal(h.open(), null); h.flush(); assert.equal(h.counts().refused, 1);
});
test("WebKit silently refusing opens fallback once after grace", () => {
  const h = setup(); h.video.behavior = "silent"; h.open(); h.flush();
  assert.deepEqual(h.counts(), { refused: 1, ended: 0 });
  assert.equal(h.video.paused, true); assert.equal(h.video.controls, false);
});
test("cancel ignores synchronous WebKit close events and never resumes inline", () => {
  const h = setup(); const s = h.open(); s?.cancel(); h.flush();
  assert.deepEqual(h.counts(), { refused: 0, ended: 0 });
  assert.equal(h.video.paused, true); assert.equal(h.video.webkitDisplayingFullscreen, false);
});
test("opening another video ends the prior session quietly", () => {
  const h = setup(); h.open();
  const other = new Video();
  const s = openVideoNatively(other as unknown as HTMLVideoElement, { onRefused: () => assert.fail(), onEnd: () => assert.fail() });
  cancel = s?.cancel;
  assert.equal(h.video.paused, true); assert.equal(h.video.muted, true);
  assert.deepEqual(h.counts(), { refused: 0, ended: 0 });
  assert.equal(activeNativeVideo(), other);
});
test("PiP keeps its session and sound until returning inline", () => {
  const h = setup(); h.open(); h.video.webkitPresentationMode = "picture-in-picture"; h.video.webkitExitFullscreen();
  assert.equal(h.counts().ended, 0); assert.equal(h.video.muted, false);
  h.video.webkitPresentationMode = "inline"; h.video.dispatchEvent(new Event("webkitpresentationmodechanged"));
  assert.equal(h.counts().ended, 1); assert.equal(h.video.muted, true);
});
test("a refused audio play retries muted while retaining controls", async () => {
  const h = setup(); h.video.failPlay = true; h.open(); await Promise.resolve();
  assert.equal(h.video.calls.length, 2); assert.equal(h.video.muted, true); assert.equal(h.video.controls, true);
});
test("a play rejection after cancel cannot restart an old video", async () => {
  const h = setup(); h.video.failPlay = true; const s = h.open(); s?.cancel(); await Promise.resolve();
  assert.equal(h.video.calls.length, 1); assert.equal(h.video.paused, true);
});
test("pre-existing controls and nonlooping state are preserved", () => {
  const h = setup(); h.video.controls = true; h.video.loop = false; h.open(); h.video.webkitExitFullscreen();
  assert.equal(h.video.controls, true); assert.equal(h.video.loop, false);
});
test("standard browser fullscreen also closes the session once", () => {
  const h = setup();
  Object.assign(h.video, { webkitEnterFullscreen: undefined, requestFullscreen: () => { h.doc.fullscreenElement = h.video; h.doc.dispatchEvent(new Event("fullscreenchange")); return Promise.resolve(); } });
  h.open(); h.doc.fullscreenElement = null; h.doc.dispatchEvent(new Event("fullscreenchange")); h.flush();
  assert.deepEqual(h.counts(), { refused: 0, ended: 1 });
});

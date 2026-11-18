import { test } from "node:test";
import assert from "node:assert/strict";
import { createFeedVideoAutoplay } from "../src/lib/feedVideoAutoplay.ts";

class Video {
  paused = true; isConnected = true; native = false; plays = 0; reject = false;
  pending: (() => void) | null = null; slow = false;
  hasAttribute() { return this.native; }
  pause() { this.paused = true; }
  play() {
    this.plays++;
    if (this.reject) return Promise.reject(Error("blocked"));
    this.paused = false;
    return this.slow ? new Promise<void>(resolve => { this.pending = resolve; }) : Promise.resolve();
  }
}
function setup() {
  let observe: (entries: unknown[]) => void = () => {};
  let mutation: () => void = () => {};
  const doc = new EventTarget() as EventTarget & { hidden: boolean; body: object; querySelector: () => object | null };
  let native = false;
  doc.hidden = false; doc.body = {}; doc.querySelector = () => native ? {} : null;
  Object.assign(globalThis, {
    document: doc,
    IntersectionObserver: class { constructor(cb: typeof observe) { observe = cb; } observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { constructor(cb: typeof mutation) { mutation = cb; } observe() {} disconnect() {} },
  });
  const controller = createFeedVideoAutoplay();
  const register = (v: Video) => controller.register(v as unknown as HTMLVideoElement);
  const visible = (v: Video, ratio: number) => observe([{ target: v, intersectionRatio: ratio, isIntersecting: ratio > 0 }]);
  return { controller, register, visible, doc, native: (yes: boolean) => { native = yes; mutation(); } };
}
test("only sufficiently visible previews play; partial/offscreen videos pause", () => {
  const s = setup(), a = new Video(); const stop = s.register(a);
  s.visible(a, .25); assert.equal(a.plays, 0);
  s.visible(a, .8); assert.equal(a.paused, false);
  s.visible(a, .5); assert.equal(a.paused, true); stop();
});
test("most visible candidate wins, then hands off when scrolled away", () => {
  const s = setup(), a = new Video(), b = new Video(); const x=s.register(a), y=s.register(b);
  s.visible(a,.7); s.visible(b,.9); assert.equal(a.paused,true); assert.equal(b.paused,false);
  s.visible(b,0); assert.equal(a.paused,false); assert.equal(b.paused,true); x(); y();
});
test("hidden document pauses and restores one preview", () => {
  const s=setup(), a=new Video(); const stop=s.register(a); s.visible(a,1);
  s.doc.hidden=true; s.doc.dispatchEvent(new Event("visibilitychange")); assert.equal(a.paused,true);
  s.doc.hidden=false; s.doc.dispatchEvent(new Event("visibilitychange")); assert.equal(a.paused,false); stop();
});
test("fullscreen/lightbox blockers suppress playback until every viewer closes", () => {
  const s=setup(), a=new Video(), one={}, two={}; const stop=s.register(a); s.visible(a,1);
  s.controller.block(one,true); s.controller.block(two,true); assert.equal(a.paused,true);
  s.controller.block(one,false); assert.equal(a.paused,true);
  s.controller.block(two,false); assert.equal(a.paused,false); stop();
});
test("native player ownership is not paused, other previews stop", () => {
  const s=setup(), a=new Video(), b=new Video(); const x=s.register(a), y=s.register(b);
  s.visible(a,.8); s.visible(b,1); a.native=true; a.paused=false; s.native(true);
  assert.equal(a.paused,false); assert.equal(b.paused,true);
  s.visible(a,0); assert.equal(a.paused,false);
  a.native=false; a.paused=true; s.native(false); assert.equal(b.paused,false); x();y();
});
test("unmount pauses preview and late play promises cannot restart it", async () => {
  const s=setup(), a=new Video(); a.slow=true; const stop=s.register(a); s.visible(a,1); stop();
  a.paused=false; a.pending?.(); await Promise.resolve(); assert.equal(a.paused,true);
});
test("rejected autoplay is handled and a visibility re-entry can retry", async () => {
  const s=setup(), a=new Video(); a.reject=true; const stop=s.register(a); s.visible(a,1);
  await Promise.resolve(); await Promise.resolve(); assert.equal(a.paused,true);
  s.visible(a,0); a.reject=false; s.visible(a,1); assert.equal(a.paused,false); stop();
});
test("ordinary carousel and swing cards both register the shared controller", async () => {
  const { readFileSync }=await import("node:fs");
  const carousel=readFileSync(new URL("../src/components/community/MediaCarousel.tsx", import.meta.url),"utf8");
  const post=readFileSync(new URL("../src/components/community/PostCard.tsx", import.meta.url),"utf8");
  assert.match(carousel,/active=\{i === activeIndex\}/); assert.match(carousel,/useFeedVideoAutoplay\(videoRef, src, active\)/);
  assert.match(carousel,/muted=\{muted\}/); assert.match(post,/useBlockFeedAutoplay\(mediaLightboxIndex !== null\)/);
});

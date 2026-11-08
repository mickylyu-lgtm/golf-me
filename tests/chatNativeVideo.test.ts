// Run: npm run test:chat  (node --test, built-in type stripping)
// Chat videos in the native player (lib/chatNativeVideo.ts): when a signed
// link is long-lived enough to hand over, when an inline video re-signs its
// link, and the signed-URL cache's expiry / renewal additions
// (lib/chatImageUrlCache.ts). The element flow (fullscreen events, mute,
// one session at a time, PiP) is covered headlessly.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_VIDEO_RENEW_BEFORE_MS,
  CHAT_VIDEO_RENEW_MIN_GAP_MS,
  NATIVE_MIN_URL_LIFE_MS,
  linkLongEnough,
  renewDelayMs,
} from "../src/lib/chatNativeVideo.ts";
import { MAX_ATTEMPTS, createChatImageUrlCache, type SignMany } from "../src/lib/chatImageUrlCache.ts";

const NOW = 10_000_000;

test("native: a local URL (Infinity) always plays; no known link never does", () => {
  assert.equal(linkLongEnough(Number.POSITIVE_INFINITY, NOW), true);
  assert.equal(linkLongEnough(null, NOW), false);
});

test("native: a link needs NATIVE_MIN_URL_LIFE_MS left", () => {
  assert.equal(linkLongEnough(NOW + NATIVE_MIN_URL_LIFE_MS, NOW), true);
  assert.equal(linkLongEnough(NOW + NATIVE_MIN_URL_LIFE_MS - 1, NOW), false);
  assert.equal(linkLongEnough(NOW - 1, NOW), false, "already expired");
});

test("renew: due CHAT_VIDEO_RENEW_BEFORE_MS before expiry, never for local / unknown", () => {
  assert.equal(renewDelayMs(null, NOW), null);
  assert.equal(renewDelayMs(Number.POSITIVE_INFINITY, NOW), null);
  assert.equal(renewDelayMs(NOW + 30 * 60_000, NOW), 30 * 60_000 - CHAT_VIDEO_RENEW_BEFORE_MS);
  assert.equal(renewDelayMs(NOW + 60_000, NOW), 0, "overdue: now");
});

test("renew: spaced at least CHAT_VIDEO_RENEW_MIN_GAP_MS apart (a wrong clock can't loop)", () => {
  // A fresh link that still looks overdue (device clock far ahead).
  assert.equal(renewDelayMs(NOW + 60_000, NOW, NOW - 1000), CHAT_VIDEO_RENEW_MIN_GAP_MS - 1000);
  assert.equal(renewDelayMs(NOW + 60_000, NOW, NOW - CHAT_VIDEO_RENEW_MIN_GAP_MS), 0);
  // A due time later than the gap wins.
  assert.equal(renewDelayMs(NOW + 30 * 60_000, NOW, NOW), 30 * 60_000 - CHAT_VIDEO_RENEW_BEFORE_MS);
});

function harness() {
  let now = 1_000_000;
  const calls: string[][] = [];
  const queue: (() => void)[] = [];
  const sign: SignMany = async (paths, ttl) => {
    calls.push([...paths]);
    return paths.map((path) => ({ path, url: `https://x/sign/${path}?t=${now}&ttl=${ttl}` }));
  };
  const cache = createChatImageUrlCache({ sign, ttlSeconds: 1800, now: () => now, schedule: (fn) => queue.push(fn) });
  const flush = async () => {
    while (queue.length) queue.shift()!();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { cache, calls, flush, advance: (ms: number) => (now += ms), now: () => now };
}

test("cache.expiresAt: signing time + ttl on this clock; null once inside the refresh margin; Infinity for local", async () => {
  const h = harness();
  assert.equal(h.cache.expiresAt("dm/v.mp4"), null, "never signed");
  const signedAt = h.now();
  void h.cache.get("dm/v.mp4");
  await h.flush();
  assert.equal(h.cache.expiresAt("dm/v.mp4"), signedAt + 1_800_000);
  h.advance(1_800_000 - 30_000);
  assert.equal(h.cache.expiresAt("dm/v.mp4"), null, "about to expire: not handed out");
  h.cache.setLocal("dm/local.mp4", "blob:x");
  assert.equal(h.cache.expiresAt("dm/local.mp4"), Number.POSITIVE_INFINITY);
});

test("cache.renew: next get() signs a new link and notifies, without counting a failure", async () => {
  const h = harness();
  const changed: string[] = [];
  h.cache.subscribe((p) => changed.push(p));
  const first = h.cache.get("dm/v.mp4");
  await h.flush();
  const url1 = await first;
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
    h.advance(1000);
    h.cache.renew("dm/v.mp4");
    assert.equal(h.cache.peek("dm/v.mp4"), null);
    const next = h.cache.get("dm/v.mp4");
    await h.flush();
    assert.ok(await next, "renewals never give up like failures do");
  }
  assert.notEqual(h.cache.peek("dm/v.mp4"), url1);
  assert.equal(h.calls.length, MAX_ATTEMPTS + 3);
  assert.equal(changed.length, MAX_ATTEMPTS + 3);
});

test("cache.renew: a local URL is kept", () => {
  const h = harness();
  h.cache.setLocal("dm/local.mp4", "blob:x");
  h.cache.renew("dm/local.mp4");
  assert.equal(h.cache.peek("dm/local.mp4"), "blob:x");
});

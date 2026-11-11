// Local synthetic media only. No accounts, customer clips or backend calls.
import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
import { chromium } from "playwright-core";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "dummy";
if (!process.env.CHROMIUM_EXECUTABLE) throw Error("Set CHROMIUM_EXECUTABLE");
await mkdir("artifacts.local", { recursive: true });
execFileSync(resolve("node_modules/ffmpeg-static/ffmpeg"), ["-y", "-f", "lavfi", "-i", "testsrc2=size=240x400:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "artifacts.local/community-video.mp4"], { stdio: "ignore" });
const origin = "http://127.0.0.1:5197";
const mock = resolve("scripts/community-video-context.tsx");
const server = await createServer({
  resolve: { alias: [{ find: /.*context\/(AuthContext|DataContext|ModerationContext|RealCommunityContext)$/, replacement: mock }] },
  server: { host: "127.0.0.1", port: 5197, strictPort: true, fs: { allow: [process.cwd(), await realpath("node_modules"), await realpath("node_modules/@fontsource/inter")] } },
  plugins: [{ name: "community-video-fixture", configureServer(s) { s.middlewares.use("/video-fixture", async (_req, res) => { res.setHeader("Content-Type", "text/html"); res.end(await s.transformIndexHtml("/video-fixture", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/community-video-fixture.tsx"></script></body></html>')); }); } }],
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox"], env: { ...process.env, ...(process.env.CHROMIUM_LIB_DIR ? { LD_LIBRARY_PATH: process.env.CHROMIUM_LIB_DIR } : {}) } });
try {
  for (const [width, height] of [[320, 844], [390, 844], [1440, 844], [844, 390]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = []; page.on("pageerror", e => { errors.push(e.message); console.error(e.message); });
    await page.route("**/*", route => route.request().url().startsWith(origin + "/") || route.request().url().startsWith("data:") ? route.continue() : route.abort());
    await page.goto(origin + "/video-fixture");
    const feed = page.getByTestId("swing").locator("video");
    await feed.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="swing"] video').readyState >= 2);
    const opener = page.getByTestId("swing").getByRole("button", { name: "Full screen", exact: true });
    // Real Chromium fullscreen with the real PostCard and generated media.
    await feed.evaluate(v => { v.pause(); v.currentTime = 2; });
    await opener.click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    assert.ok(await feed.evaluate(v => v.currentTime >= 2), "native handoff preserves the feed position");
    assert.deepEqual(await feed.evaluate(v => ({ controls: v.controls, muted: v.muted, loop: v.loop, fit: getComputedStyle(v).objectFit })), { controls: true, muted: false, loop: false, fit: "contain" });
    await page.screenshot({ path: "artifacts.local/community-video-native-" + width + ".png" });
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.querySelector('[data-testid="swing"] video').controls);
    assert.equal(await feed.evaluate(v => v.muted && v.loop), true);
    await page.waitForTimeout(1100);
    assert.equal(await page.getByRole("dialog").count(), 0, "dismiss before grace never reopens fallback");

    // Refuse fullscreen: same tap must lead to accessible platform controls.
    await feed.evaluate(v => { v.requestFullscreen = () => Promise.reject(Error("synthetic refusal")); });
    await opener.click();
    const dialog = page.getByRole("dialog"); await dialog.waitFor();
    const viewerVideo = dialog.locator("video").first();
    assert.equal(await viewerVideo.evaluate(v => v.controls && !v.loop), true);
    assert.equal(await feed.evaluate(v => v.paused), true);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Close");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "VIDEO", "Tab from Close reaches media, not background");
    for (let tab = 0; tab < 12; tab++) {
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true, "keyboard focus remains in viewer");
    }
    const bounds = await viewerVideo.boundingBox(); assert.ok(bounds.height > 200 && bounds.y >= 50 && bounds.y + bounds.height <= height - 40);
    await viewerVideo.evaluate(v => { v.currentTime = 3; v.pause(); });
    assert.ok(Math.abs(await viewerVideo.evaluate(v => v.currentTime) - 3) < 0.1);
    await page.screenshot({ path: "artifacts.local/community-video-fallback-" + width + ".png" });
    await viewerVideo.evaluate(v => v.requestFullscreen());
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.evaluate(() => document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true })));
    assert.equal(await dialog.count(), 1, "native player Escape cannot close the underlying gallery");
    await page.evaluate(() => document.exitFullscreen());
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
    assert.equal(await opener.evaluate(b => document.activeElement === b), true);

    // Repeated open/close and mixed photo/video navigation stay inside one viewer.
    await page.getByRole("button", { name: "Open gallery", exact: true }).click();
    const gallery = page.getByRole("dialog"); await gallery.waitFor();
    const galleryTrack = gallery.locator(".snap-mandatory");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await galleryTrack.evaluate(el => el.scrollLeft), 0, "back-tab cannot focus an offscreen video");
    await page.getByRole("button", { name: "Close", exact: true }).focus();
    const first = gallery.locator("video").first();
    await first.evaluate(v => v.play());
    const track = gallery.locator(".snap-mandatory");
    await track.evaluate(el => { el.scrollLeft = el.clientWidth; el.dispatchEvent(new Event("scroll")); });
    await page.waitForFunction(() => document.querySelector('[role="dialog"] video').paused);
    await track.evaluate(el => { el.scrollLeft = el.clientWidth * 2; el.dispatchEvent(new Event("scroll")); });
    const second = gallery.locator("video").nth(1);
    await second.evaluate(v => v.play());
    assert.equal(await first.evaluate(v => v.paused), true);
    await second.evaluate(v => { window.__closedVideo = v; });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.evaluate(() => window.__closedVideo.paused), true, "later gallery video is paused immediately on Close");

    // Keyboard opening on an album video has the same fallback, not a dead tap.
    const albumVideo = page.getByTestId("album").locator("video").first();
    await albumVideo.evaluate(v => { v.requestFullscreen = () => Promise.reject(Error("synthetic refusal")); });
    const albumOpen = page.getByTestId("album").getByRole("button", { name: "Full screen", exact: true }).first();
    await albumOpen.focus(); await page.keyboard.press("Enter"); await dialog.waitFor();
    assert.equal(await dialog.locator("video").first().evaluate(v => v.controls), true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    // Native timeline touches must never dismiss; a deliberate body drag can.
    await page.getByRole("button", { name: "Open gallery", exact: true }).click();
    await page.waitForTimeout(350);
    const touchVideo = page.getByRole("dialog").locator("video").first();
    const box = await touchVideo.boundingBox();
    const touch = y => ({ identifier: 1, clientX: width / 2, clientY: y, pageX: width / 2, pageY: y });
    await touchVideo.dispatchEvent("touchstart", { touches: [touch(box.y + box.height - 30)] });
    await touchVideo.dispatchEvent("touchmove", { touches: [touch(box.y + box.height + 130)] });
    await touchVideo.dispatchEvent("touchend", { touches: [] });
    assert.equal(await page.getByRole("dialog").count(), 1, "timeline owns long vertical scrub");
    await touchVideo.dispatchEvent("touchstart", { touches: [touch(box.y + 120)] });
    await touchVideo.dispatchEvent("touchmove", { touches: [touch(box.y + 300)] });
    await touchVideo.dispatchEvent("touchend", { touches: [] });
    assert.equal(await page.getByRole("dialog").count(), 0, "body swipe dismisses");
    await page.getByRole("button", { name: "Open photo sheet", exact: true }).click();
    await page.getByRole("button", { name: "View photo", exact: true }).click();
    assert.equal(await page.getByRole("dialog", { includeHidden: true }).count(), 2);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog", { includeHidden: true }).count(), 1, "photo Escape preserves the parent sheet");
    assert.equal(await page.getByRole("button", { name: "View photo", exact: true }).evaluate(b => document.activeElement === b), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog", { includeHidden: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS " + width + "x" + height + ": actual PostCard native controls/audio/exit, rejected-fullscreen fallback, timeline seeking, focus return, album keyboard opening, mixed gallery pause");
    await page.close();
  }
} finally { await browser.close(); await server.close(); }

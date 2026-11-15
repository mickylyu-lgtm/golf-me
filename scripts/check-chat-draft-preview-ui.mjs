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
const origin = "http://127.0.0.1:5198";
const mock = resolve("scripts/community-video-context.tsx");
const server = await createServer({
  resolve: { alias: [{ find: /.*context\/(AuthContext|DataContext|ModerationContext|RealCommunityContext)$/, replacement: mock }] },
  server: { host: "127.0.0.1", port: 5198, strictPort: true, fs: { allow: [process.cwd(), await realpath("node_modules"), await realpath("node_modules/@fontsource/inter")] } },
  plugins: [{ name: "community-video-fixture", configureServer(s) { s.middlewares.use("/draft-fixture", async (_req, res) => { res.setHeader("Content-Type", "text/html"); res.end(await s.transformIndexHtml("/draft-fixture", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/chat-draft-preview-fixture.tsx"></script></body></html>')); }); } }],
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox"], env: { ...process.env, ...(process.env.CHROMIUM_LIB_DIR ? { LD_LIBRARY_PATH: process.env.CHROMIUM_LIB_DIR } : {}) } });
try {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width === 390 });
    const errors = [];
    async function checkClose(keyboard = false) {
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      const style = await close.evaluate(b => {
        const css = getComputedStyle(b);
        return { width: b.getBoundingClientRect().width, height: b.getBoundingClientRect().height,
          keyboard: b.dataset.keyboardFocus, background: css.backgroundColor, radius: css.borderRadius, shadow: css.boxShadow,
          outline: css.outlineStyle, color: css.outlineColor, focus: document.activeElement === b,
          children: [...b.children].map(c => getComputedStyle(c).backgroundColor) };
      });
      assert.ok(style.width >= 44 && style.height >= 44);
      assert.equal(style.background, "rgba(0, 0, 0, 0)");
      assert.equal(style.radius, "0px");
      assert.equal(style.shadow, "none");
      assert.ok(style.children.every(bg => bg === "rgba(0, 0, 0, 0)"));
      assert.equal(style.outline, keyboard ? "solid" : "none", JSON.stringify(style));
      if (keyboard) assert.equal(style.color, "rgb(255, 255, 255)");
      assert.equal(style.focus, true);
    }
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", route => route.request().url().startsWith(origin + "/") || route.request().url().startsWith("data:") ? route.continue() : route.abort());
    await page.goto(origin + "/draft-fixture");
    const photo = page.getByRole("button", { name: "Open photo", exact: true });
    const dialog = page.getByRole("dialog");
    const open = target => width === 390 ? target.tap() : target.click();
    for (const name of ["Sent photo", "Sent video"]) {
      const trigger = page.getByRole("button", { name, exact: true });
      for (let i = 0; i < 3; i++) {
        await open(trigger);
        await dialog.waitFor();
        await checkClose();
        if (name === "Sent video") await page.waitForFunction(() => document.querySelector("dialog video")?.readyState >= 2);
        await page.screenshot({ path: "artifacts.local/" + name.replace(" ", "-") + "-" + width + ".png" });
        if (i === 1) await page.keyboard.press("Escape");
        else await dialog.getByRole("button", { name: "Close", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        assert.equal(await trigger.evaluate(b => document.activeElement === b), true);
      }
    }
    for (let i = 0; i < 3; i++) {
      await open(photo);
      await dialog.waitFor();
      await checkClose();
      // Switching from pointer entry to Tab must reveal a keyboard cue.
      await page.keyboard.press("Tab");
      await checkClose(true);
      await dialog.getByRole("button", { name: "Close", exact: true }).dispatchEvent("pointerdown");
      await checkClose();
      assert.equal(await page.getByTestId("attachment-count").textContent(), "2");
      assert.equal(await page.getByRole("textbox", { name: "Draft" }).inputValue(), "Keep my draft");
      await page.screenshot({ path: "artifacts.local/chat-draft-photo-" + width + ".png" });
      if (i === 1) await page.keyboard.press("Escape");
      else await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(await photo.evaluate(b => document.activeElement === b), true);
    }
    await photo.focus();
    await page.keyboard.press("Enter");
    await dialog.waitFor();
    await checkClose(true);
    await page.screenshot({ path: "artifacts.local/chat-close-keyboard-" + width + ".png" });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    const video = page.getByRole("button", { name: "Open full screen", exact: true });
    await open(video);
    await dialog.waitFor();
      await checkClose();
    const player = dialog.locator("video");
    await page.waitForFunction(() => document.querySelector("dialog video")?.readyState >= 2);
    assert.equal(await player.evaluate(v => v.controls), true);
    assert.ok((await player.getAttribute("src")).includes("#t=1.00,4.00"));
    await player.evaluate(v => v.pause());
    await page.screenshot({ path: "artifacts.local/chat-draft-video-" + width + ".png" });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.getByTestId("attachment-count").textContent(), "2");
    await page.getByRole("button", { name: "Remove photo", exact: true }).click();
    assert.equal(await page.getByTestId("attachment-count").textContent(), "1");
    await open(video);
    await dialog.waitFor();
      await checkClose();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.getByTestId("attachment-count").textContent(), "1");
    assert.equal(await page.getByRole("textbox", { name: "Draft" }).inputValue(), "Keep my draft");
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Media close passed: sent/draft photo/video repeat preview, touch/mouse plain 44px X, keyboard outline, close/Escape, focus return, draft intact, explicit removal only.");
} finally { await browser.close(); await server.close(); }

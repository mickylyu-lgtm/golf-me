// Local-only regression: real routes and components, synthetic data/keyboard.
// CHROMIUM_EXECUTABLE=... CHROMIUM_LIB_DIR=... node scripts/check-community-scroll-ui.mjs
// BROWSER=webkit LD_LIBRARY_PATH=... node scripts/check-community-scroll-ui.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium, webkit } from "playwright-core";
import { syntheticKeyboardPlugin } from "./synthetic-keyboard-plugin.mjs";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "dummy";
const baseline = process.env.QA_BASELINE === "1" ? execFileSync("git", ["show", "7d74d08:src/pages/PostDetail.tsx"], { encoding: "utf8" }) : null;
const engine = process.env.BROWSER === "webkit" ? "webkit" : "chromium";
const origin = "http://127.0.0.1:5198";
const mock = resolve("scripts/community-scroll-context.tsx");
const server = await createServer({
  cacheDir: ".vite-scroll.local",
  resolve: { alias: [{ find: /.*context\/(AuthContext|DataContext|ModerationContext|RealCommunityContext)$/, replacement: mock }] },
  server: { host: "127.0.0.1", port: 5198, strictPort: true, fs: { allow: [process.cwd(), await realpath("node_modules"), await realpath("node_modules/@fontsource/inter")] } },
  plugins: [syntheticKeyboardPlugin(), { name: "old-scroll-baseline", enforce: "pre", transform(source, id) { if (baseline && id.split("?")[0].endsWith("/src/pages/PostDetail.tsx")) return baseline; } }, { name: "community-scroll-fixture", configureServer(s) {
    s.middlewares.use(async (req, res, next) => {
      if (!req.url?.match(/^\/(community(?:\/[^.?]*)?|other)$/)) return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await s.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/community-scroll-fixture.tsx"></script></body></html>'));
    });
  } }],
});
await server.listen();
const browser = await (engine === "webkit" ? webkit : chromium).launch({
  headless: true,
  ...(engine === "chromium" ? { executablePath: process.env.CHROMIUM_EXECUTABLE, args: ["--no-sandbox"] } : { executablePath: process.env.WEBKIT_EXECUTABLE }),
  env: { ...process.env, ...(process.env.CHROMIUM_LIB_DIR && engine === "chromium" ? { LD_LIBRARY_PATH: process.env.CHROMIUM_LIB_DIR } : {}) },
});
await mkdir("artifacts.local", { recursive: true });
let assertions = 0;
function equal(actual, expected, label) { assertions++; assert.equal(actual, expected, label); }
function near(actual, expected, label) { assertions++; assert.ok(Math.abs(actual - expected) <= 2, label + ": " + actual + " vs " + expected); }
try {
  for (const [width, height] of [[320, 844], [390, 844], [844, 390], [1440, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 1000, ...(engine === "webkit" && width < 1000 ? { isMobile: true } : {}) });
    await page.addInitScript(() => {
      const scrollTo = window.scrollTo.bind(window);
      window.__scrollWrites = [];
      window.scrollTo = (...args) => { window.__scrollWrites.push(args); return scrollTo(...args); };
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.request().url().startsWith(origin + "/") || route.request().url().startsWith("data:") ? route.continue() : route.abort());
    await page.goto(origin + "/community");
    await page.getByRole("heading", { name: "Community", exact: true }).waitFor();
    async function settle() { await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); }
    async function keyboard(height) { await page.evaluate(height => window.dispatchEvent(new CustomEvent("golfme:synthetic-keyboard", { detail: { height } })), height); await settle(); }
    async function open() {
      await keyboard(0);
      await page.evaluate(() => window.scrollTo(0, 1800));
      await settle();
      const before = await page.evaluate(() => scrollY);
      await page.evaluate(() => window.__navigate("/community/post-12"));
      await page.locator("#comment-composer-input").waitFor();
      await settle();
      return before;
    }
    async function dock() {
      // A real tap starts with the input onscreen; focus() alone makes
      // WebKit scroll it into view after the pre-focus capture.
      await page.locator("#comment-composer-input").scrollIntoViewIfNeeded();
      await settle();
      const before = await page.evaluate(() => scrollY);
      await page.locator("#comment-composer-input").focus();
      await keyboard(300);
      equal(await page.evaluate(() => document.body.style.overflow), "hidden", "docked lock");
      return before;
    }
    async function back(expected) {
      await page.getByRole("button", { name: "Back", exact: true }).evaluate(button => button.click());
      await page.getByRole("heading", { name: "Community", exact: true }).waitFor();
      await settle();
      near(await page.evaluate(() => scrollY), expected, "feed return position");
      await page.waitForTimeout(350);
      near(await page.evaluate(() => scrollY), expected, "feed stays still");
      equal(await page.evaluate(() => document.body.style.overflow), "", "released lock");
    }
    // Read-only comments round-trip never needs a keyboard.
    let before = await open();
    await back(before);
    // The reported native race: leave while the composer is still docked.
    for (let repeat = 0; repeat < 3; repeat++) {
      before = await open();
      await dock();
      await back(before);
    }
    await page.screenshot({ path: "artifacts.local/community-scroll-" + engine + "-" + width + ".png" });
    // Ordinary dismissal remains on the post and restores the saved offset.
    before = await open();
    const postBefore = await dock();
    await keyboard(0);
    near(await page.evaluate(() => scrollY), postBefore, "ordinary undock");
    equal(await page.evaluate(() => document.body.style.overflow), "", "undock releases");
    await back(before);
    // Queue keyboard hide, then leave immediately before its RAF.
    before = await open();
    await dock();
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("golfme:synthetic-keyboard", { detail: { height: 0 } }));
      window.__navigate(-1);
    });
    await page.getByRole("heading", { name: "Community", exact: true }).waitFor();
    await settle();
    near(await page.evaluate(() => scrollY), before, "hide and Back race");
    // Unsent drafts, repeated reopen and forward navigation are unaffected.
    before = await open();
    await page.locator("#comment-composer-input").fill("Synthetic unsent draft");
    await keyboard(300);
    await back(before);
    await keyboard(0);
    await page.evaluate(() => window.__navigate(1));
    await page.locator("#comment-composer-input").waitFor();
    equal(await page.locator("#comment-composer-input").inputValue(), "Synthetic unsent draft", "draft preserved");
    await dock();
    await page.evaluate(() => window.__navigate("/community/post-13"));
    await page.waitForURL("**/community/post-13");
    await settle();
    near(await page.evaluate(() => scrollY), 0, "new post owns its scroll");
    await page.evaluate(() => { window.__scrollWrites = []; });
    await keyboard(0);
    // WebKit may reveal the still-focused reused input itself. The old
    // post must not issue its own stale scroll after this new route owns it.
    equal((await page.evaluate(() => window.__scrollWrites)).length, 0, "new post does not restore old coordinates");
    await dock();
    await page.evaluate(() => window.__navigate("/other"));
    await page.getByText("Other destination", { exact: true }).waitFor();
    await settle();
    near(await page.evaluate(() => scrollY), 0, "new destination owns its scroll");
    equal(await page.evaluate(() => document.body.style.overflow), "", "other route unlocked");
    await keyboard(0);
    equal(errors.length, 0, errors.join("\n"));
    console.log("PASS", engine, width + "x" + height, "read-only/back/docked/repeated/undock/race/draft/forward/new destination");
    await page.close();
  }
  console.log("PASS", engine, assertions, "assertions");
} finally { await browser.close(); await server.close(); }

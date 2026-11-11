// Actual composer, capability hook and PostCard, with local synthetic contexts.
// No real accounts, storage, backend calls or posts.
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright-core";
const origin = "http://127.0.0.1:5205";
const out = "artifacts.local/official-posts";
await mkdir(out, { recursive: true });
const mock = resolve("scripts/official-post-context.tsx");
const server = await createServer({
  resolve: { alias: [
    { find: /.*context\/(AuthContext|DataContext|ModerationContext|RealCommunityContext)$/, replacement: mock },
    { find: /.*lib\/supabase$/, replacement: mock },
    { find: /^\.\/supabase$/, replacement: mock },
  ] },
  server: { host: "127.0.0.1", port: 5205, strictPort: true, fs: { allow: [process.cwd(), await realpath("node_modules"), await realpath("node_modules/@fontsource/inter")] } },
  plugins: [{ name: "official-post-fixture", configureServer(s) { s.middlewares.use("/official-fixture", async (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(await s.transformIndexHtml("/official-fixture", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/official-post-fixture.tsx"></script></body></html>'));
  }); } }],
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE ?? "/home/shmick/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell", headless: true, args: ["--no-sandbox"], env: { ...process.env, ...(process.env.CHROMIUM_LIB_DIR ? { LD_LIBRARY_PATH: process.env.CHROMIUM_LIB_DIR } : {}) } });
let assertions = 0;
const ok = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; const blocked = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().url().startsWith(origin + "/") || route.request().url().startsWith("data:") ? route.continue() : (blocked.push(route.request().url()), route.abort()));
  await page.goto(origin + "/official-fixture");
  const option = page.getByTestId("official-post-option");
  const check = option.getByRole("checkbox");
  await check.waitFor();
  ok(await check.isChecked(), false, "normal posting is the default");
  await page.getByRole("textbox").fill("Synthetic official announcement");
  await check.check();
  await page.getByRole("button", { name: "Publish announcement", exact: true }).dblclick();
  await page.getByTestId("published").getByTestId("official-post-badge").waitFor();
  ok(await page.evaluate(() => window.officialQa.submissions.length), 1, "repeated clicks publish once");
  ok(await page.evaluate(() => window.officialQa.submissions[0].isOfficial), true);
  ok(await page.getByTestId("ordinary").getByTestId("official-post-badge").count(), 0);
  ok(await page.getByTestId("official-feed").getByTestId("official-post-badge").count(), 1);
  ok(await page.getByTestId("official-detail").getByTestId("official-post-badge").count(), 1);
  ok(await page.evaluate(() => localStorage.getItem("golfme:communityPostDraft")), null);

  await page.getByRole("button", { name: "New post", exact: true }).click();
  await check.waitFor();
  ok(await check.isChecked(), false, "new composer never inherits announcement mode");
  await page.getByRole("textbox").fill("Keep this draft");
  await check.check();
  await page.evaluate(() => { window.officialQa.outcome = "denied"; });
  await page.getByRole("button", { name: "Publish announcement", exact: true }).click();
  await page.getByText("Admin posting is unavailable. Retry, or turn off Post as GolfMe to publish a personal post.", { exact: true }).waitFor();
  ok(await page.getByRole("textbox").inputValue(), "Keep this draft");
  ok(await check.isChecked(), true, "denied announcement never silently downgrades");
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem("golfme:communityPostDraft")).text), "Keep this draft");
  ok(await page.evaluate(() => "isOfficial" in JSON.parse(localStorage.getItem("golfme:communityPostDraft"))), false);

  // Revoke while the page is open, refresh on foreground, then restore.
  await page.evaluate(() => { window.officialQa.capability = "deny"; });
  await page.waitForTimeout(5100);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await option.getByRole("button", { name: "Try again", exact: true }).waitFor();
  ok(await page.getByRole("button", { name: "Publish announcement", exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.officialQa.capability = "allow"; window.officialQa.outcome = "success"; });
  await option.getByRole("button", { name: "Try again", exact: true }).click();
  await page.waitForFunction(() => !Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Publish announcement")?.disabled);

  // Account switches drop the old account's selected posting mode.
  await page.evaluate(() => window.officialQa.setAccount("qa-member"));
  await option.waitFor({ state: "detached" });
  ok(await page.getByRole("button", { name: "Post", exact: true }).isEnabled(), true);
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await page.getByTestId("published").waitFor();
  ok(await page.evaluate(() => window.officialQa.submissions.at(-1).isOfficial), false);

  await page.evaluate(() => { window.officialQa.setAccount("qa-demo", true); window.officialQa.navigate("/community/new"); });
  await page.getByRole("textbox").waitFor();
  ok(await option.count(), 0, "demo has no official option");
  const requestCount = await page.evaluate(() => window.officialQa.requests.length);
  await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.officialQa.requests.length), requestCount, "demo makes no capability RPC");
  await page.evaluate(() => { window.officialQa.capability = "slow"; window.officialQa.setAccount("qa-admin-old"); });
  await page.waitForFunction(() => window.officialQa.pending.length > 0);
  ok(await option.count(), 0, "loading does not reveal privileged choice");
  await page.evaluate(() => { window.officialQa.capability = "deny"; window.officialQa.setAccount("qa-member-new"); });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.officialQa.pending.splice(0).forEach(resolve => resolve()));
  await page.waitForTimeout(100);
  ok(await option.count(), 0, "late old-account permission is ignored");
  await page.evaluate(() => { window.officialQa.capability = "error"; window.officialQa.setAccount("qa-admin-error"); });
  await page.waitForTimeout(100);
  ok(await option.count(), 0, "missing backend capability hides official UI");
  ok(await page.getByRole("textbox").count(), 1, "ordinary composer remains available");

  // Back/reopen keeps content but not the official mode.
  await page.evaluate(() => { window.officialQa.capability = "allow"; window.officialQa.setAccount("qa-admin-a"); });
  await check.waitFor();
  await check.check();
  await page.getByRole("textbox").fill("Retained after Back");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "New post", exact: true }).click();
  await check.waitFor();
  ok(await check.isChecked(), false);
  ok(await page.getByRole("textbox").inputValue(), "Retained after Back");

  // A possibly published post is reviewed instead of retried.
  await check.check();
  await page.evaluate(() => { window.officialQa.outcome = "uncertain"; });
  await page.getByRole("button", { name: "Publish announcement", exact: true }).click();
  await page.getByTestId("check-post").waitFor();
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem("golfme:communityPostDraft")).text), "Retained after Back");

  // Real components across supported languages, phone/desktop, light/dark.
  await page.evaluate(() => { window.officialQa.outcome = "success"; window.officialQa.navigate("/community/new"); });
  await page.waitForTimeout(5500); // Let earlier test toasts dismiss before review screenshots.
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const locale of ["en", "zh-CN", "zh-TW", "es", "ja", "ko"]) {
      await page.evaluate(locale => window.officialQa.setLocale(locale), locale);
      await page.waitForTimeout(100);
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
        await option.waitFor();
        await page.waitForTimeout(350); // Theme color transitions must settle.
        ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "composer has no overflow");
        if (locale === "en") await page.screenshot({ path: out + "/composer-" + width + (dark ? "-dark" : "-light") + ".png", fullPage: true });
        await page.evaluate(() => window.officialQa.navigate("/community"));
        await page.getByTestId("official-feed").waitFor();
        ok(await page.getByTestId("official-feed").getByTestId("official-post-badge").count(), 1);
        ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "badge has no overflow");
        if (locale === "en") await page.screenshot({ path: out + "/feed-" + width + (dark ? "-dark" : "-light") + ".png", fullPage: true });
        await page.evaluate(() => window.officialQa.navigate("/community/new"));
      }
    }
  }
  ok(errors, [], "no runtime errors");
  ok(blocked, [], "no non-local request attempted");
  await writeFile(out + "/results.json", JSON.stringify({ assertions, synthetic: true, widths: [320,390,1440], locales: ["en","zh-CN","zh-TW","es","ja","ko"], themes: ["light","dark"], browser: "Chromium", runtimeErrors: errors, blockedRequests: blocked }, null, 2));
  console.log("PASS " + assertions + " official-post UI assertions");
  await page.close();
} finally { await browser.close(); await server.close(); }

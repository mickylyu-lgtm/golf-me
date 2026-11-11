// Run: node scripts/test-admin-users.mjs
// Uses only synthetic accounts. All non-local browser requests are blocked.
import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.ADMIN_USERS_QA_OUTPUT ?? path.join(tmpdir(), "golfme-admin-users-qa");
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  logLevel: "error",
  server: {
    host: "127.0.0.1", port: 0, strictPort: false,
    // Existing dependency folders may be symlinked from another worktree.
    // Serve only this fixture workspace plus the exact bundled font package.
    fs: { allow: [root, await realpath(path.join(root, "node_modules/@fontsource/inter"))] },
  },
});
await server.listen();
const address = server.httpServer.address();
assert.ok(address && typeof address !== "string");
const base = "http://127.0.0.1:" + address.port;
let browser;
let checks = 0;
const errors = [];
const external = [];

function check(value, message) {
  assert.ok(value, message);
  checks++;
}

async function until(read, expected, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read();
    if (value === expected) { checks++; return; }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.equal(await read(), expected, message);
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base || url.protocol === "data:") return route.continue();
    external.push(url.origin);
    await route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(response.status() + " " + response.url());
  });

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + "/scripts/fixtures/admin-users-harness.html");
    const toggle = page.getByRole("button", { name: "Registered Users", exact: true });
    const search = page.getByRole("searchbox");
    const body = page.locator('[id$="-users"]');
    const status = page.getByRole("status");
    await toggle.waitFor();
    await page.evaluate(() => document.fonts.ready);
    check(await page.evaluate(() => document.fonts.check("14px Inter")), "bundled font loaded");
    await until(() => toggle.getAttribute("aria-expanded"), "false", "folded on first visit");
    check(await body.isHidden(), "list is initially hidden");
    check(await search.isVisible(), "search remains visible while folded");
    check((await page.getByRole("heading", { name: "Caddie Usage (all accounts)" }).boundingBox()).y < 250, "next dashboard section is close when folded");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal page overflow");
    await page.screenshot({ path: path.join(output, "collapsed-" + width + ".png"), fullPage: false });

    await toggle.focus();
    await page.keyboard.press("Enter");
    await until(() => toggle.getAttribute("aria-expanded"), "true", "Enter expands the roster");
    check(await body.isVisible(), "expanded body is visible");
    check(await body.locator("p.select-text").count() === 100, "first page shows 100 accounts");
    await page.getByRole("button", { name: "Show 100 more", exact: true }).click();
    await until(() => body.locator("p.select-text").count(), 200, "show more appends next page");
    await page.getByRole("button", { name: "Show 30 more", exact: true }).click();
    await until(() => body.locator("p.select-text").count(), 230, "last page remains accessible");
    await toggle.click();
    await until(() => toggle.getAttribute("aria-expanded"), "false", "click collapses");
    await search.fill(" AVERY.LASTGOLFER+ ");
    await until(() => toggle.getAttribute("aria-expanded"), "true", "typing opens folded results");
    await until(() => body.locator("p.select-text").count(), 1, "search finds an account beyond old 100-row limit");
    check((await status.innerText()).startsWith("1 matching account of 230"), "match count is accurate");
    const email = body.getByText("avery.lastgolfer+extremely-long-registered-address@example.test", { exact: true });
    check(await email.isVisible(), "full registered email is visible");
    check(await email.evaluate((element) => element.scrollWidth <= element.clientWidth), "long email wraps without clipping");
    check(await body.getByText("mid-onboarding", { exact: true }).isVisible(), "onboarding badge is preserved");
    check(await body.getByText("reviewer", { exact: true }).isVisible(), "reviewer badge is preserved");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "search results do not overflow");
    await page.screenshot({ path: path.join(output, "search-" + width + ".png"), fullPage: false });

    await toggle.focus();
    await page.keyboard.press("Space");
    await until(() => toggle.getAttribute("aria-expanded"), "false", "Space folds the roster");
    check((await search.inputValue()) === " AVERY.LASTGOLFER+ ", "folding preserves search");
    await page.keyboard.press("Space");
    await until(() => toggle.getAttribute("aria-expanded"), "true", "Space reopens the roster");
    await search.fill("@AVERY_LAST");
    await until(() => body.locator("p.select-text").count(), 1, "username search works");
    await search.fill("Avery Lastgolfer");
    await until(() => body.locator("p.select-text").count(), 1, "name search works");
    await search.fill("missing-address@example.test");
    await body.getByText("No matching users.", { exact: true }).waitFor();
    check((await status.innerText()).startsWith("0 matching accounts"), "empty-result count is correct");
    await page.getByRole("button", { name: "Clear user search" }).click();
    check(await search.inputValue() === "", "clear empties the search");
    check(await search.evaluate((element) => element === document.activeElement), "clear returns focus to the input");
    await until(() => body.locator("p.select-text").count(), 100, "clearing resets pagination");

    await search.fill("golfer229@");
    await page.evaluate(() => window.adminUsersQA.setRows(235));
    await until(() => status.innerText(), "0 matching accounts of 235 loaded", "live refresh recomputes matches without stale results");
    await search.fill("golfer234@");
    await until(() => body.locator("p.select-text").count(), 1, "newly refreshed account is searchable");
    await page.getByRole("button", { name: "Clear user search" }).click();

    await page.evaluate(() => window.adminUsersQA.setError(true));
    await page.getByRole("alert").waitFor();
    check(await body.locator("p.select-text").count() === 0, "failed load does not show stale emails");
    await toggle.click();
    check(await page.getByRole("alert").isVisible(), "load errors stay visible even folded");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await until(() => page.evaluate(() => window.adminUsersQA.retries), 1, "retry still works");
    check(await body.isHidden(), "retry does not unexpectedly unfold the roster");

    await page.evaluate(() => { window.adminUsersQA.setRows(0); window.adminUsersQA.setLoading(true); });
    await until(() => status.innerText(), "Loading users...", "loading does not imply zero accounts");
    await toggle.click();
    await body.getByText("Loading...", { exact: true }).waitFor();
    await page.evaluate(() => window.adminUsersQA.setLoading(false));
    await body.getByText("No registered users yet.", { exact: true }).waitFor();
    check(true, "empty roster is distinct from no search results and failure");

    await page.evaluate(() => window.adminUsersQA.setRows(1000));
    await page.getByText("Search covers the latest 1,000 loaded accounts.", { exact: true }).waitFor();
    await search.fill("golfer999@");
    await until(() => body.locator("p.select-text").count(), 1, "full loaded roster searched up to RPC cap");
    check(!(await page.evaluate(() => JSON.stringify(localStorage))).includes("golfer999"), "search is not saved to localStorage");
    check(!(await page.evaluate(() => JSON.stringify(sessionStorage))).includes("golfer999"), "search is not saved to sessionStorage");

    await page.reload();
    await toggle.waitFor();
    await until(() => toggle.getAttribute("aria-expanded"), "false", "reload resets to compact roster");
    check(await search.inputValue() === "", "query is not persisted across reload");
    console.log("PASS " + width + "px: fold/search/clear/pagination/refresh/error/loading/empty/cap/keyboard");
  }
  check(errors.length === 0, "no browser JavaScript errors: " + errors.join("; "));
  check(external.length === 0, "fixture tried no external requests: " + external.join(", "));
  console.log("PASS " + checks + " browser assertions. Screenshots: " + output);
} finally {
  await browser?.close();
  await server.close();
}

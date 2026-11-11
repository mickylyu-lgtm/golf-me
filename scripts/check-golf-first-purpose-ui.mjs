// Built-app synthetic QA only. No real account, backend or external browser requests.
import assert from "node:assert/strict";
import fs from "node:fs";
import { preview } from "vite";
import { chromium } from "playwright-core";
const out = "/tmp/golfme-purpose-qa-20261111";
fs.mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:5203";
const server = await preview({ preview: { host: "127.0.0.1", port: 5203, strictPort: true } });
let browser, assertions = 0;
const cases = [];
function equal(a, b, label) { assert.deepEqual(a, b, label); assertions++; }
function ok(value, label) { assert.ok(value, label); assertions++; }
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/home/shmick/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell", headless: true, args: ["--no-sandbox"] });
  for (const locale of ["en", "es", "ja", "ko", "zh-CN", "zh-TW"]) for (const width of [320, 360, 390, 1440]) {
    const dict = Object.values(await import("../src/i18n/locales/" + locale + ".ts"))[0];
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
    await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await context.addInitScript(locale => { localStorage.setItem("golfme:locale", locale); }, locale);
    const page = await context.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/onboarding");
    await page.getByRole("heading", { name: dict["onboarding.screen1Title"], exact: true }).waitFor();
    ok(await page.getByText(dict["onboarding.screen1Body"], { exact: true }).isVisible(), "purpose on first screen");
    equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "onboarding no overflow");
    await page.getByRole("button", { name: dict["onboarding.next"], exact: true }).click();
    await page.getByRole("heading", { name: dict["onboarding.screen2Title"], exact: true }).waitFor();
    await page.getByRole("button", { name: dict["common.skip"], exact: true }).click();
    await page.waitForURL(base + "/signup");
    await page.getByText(dict["auth.welcome.subheadline"], { exact: true }).filter({ visible: true }).waitFor();
    ok(true, "direct signup retains golf purpose");
    equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "signup no overflow");
    if (width === 320) await page.screenshot({ path: out + "/signup-" + locale + ".png", fullPage: true });
    await page.waitForFunction(() => localStorage.getItem("golfme:data:v8"));
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem("golfme:data:v8"));
      data.session = { isLoggedIn: true, hasOnboarded: true };
      data.blocks = [];
      data.golfers.forEach(g => { g.photoUrl = ""; });
      const target = data.golfers.find(g => g.id === "g2");
      target.bio = "Synthetic golfer biography";
      target.availability = ["Weekend Mornings"];
      localStorage.setItem("golfme:data:v8", JSON.stringify(data));
      localStorage.setItem("golfme:isDemo", "1");
    });
    await page.goto(base + "/community");
    await page.getByRole("button", { name: dict["settings.communityGuidelines"], exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(base + "/community/guidelines");
    await page.getByRole("heading", { name: dict["settings.communityGuidelines"], exact: true }).waitFor();
    ok(await page.getByText(dict["guidelines.unwantedContact"], { exact: true }).isVisible(), "unwanted contact rule rendered");
    equal(await page.getByRole("list").filter({ hasText: dict["guidelines.unwantedContact"] }).getByRole("listitem").count(), 8, "semantic complete rules");
    equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "guidelines no overflow");
    if (width === 320) {
      for (const scale of [1.5, 2]) {
        await page.evaluate(scale => document.documentElement.style.fontSize = (16 * scale) + "px", scale);
        equal(await page.getByRole("list").filter({ hasText: dict["guidelines.unwantedContact"] }).evaluate(el => el.scrollWidth <= el.clientWidth), true, "enlarged rules do not clip");
        await page.getByText(dict["guidelines.reporting"], { exact: true }).scrollIntoViewIfNeeded();
        ok(await page.getByText(dict["guidelines.reporting"], { exact: true }).isVisible(), "enlarged reporting help reachable");
      }
      await page.evaluate(() => document.documentElement.style.fontSize = "");
    }
    if (width === 390) await page.screenshot({ path: out + "/guidelines-" + locale + ".png", fullPage: true });
    await page.getByRole("button", { name: dict["common.back"], exact: true }).click();
    await page.waitForURL(base + "/community");
    await page.goto(base + "/golfer/g2");
    const invite = page.getByRole("button", { name: dict["golferProfile.inviteToPlay"], exact: true });
    const message = page.getByRole("button", { name: dict["golferProfile.message"], exact: true });
    await invite.waitFor();
    ok((await invite.getAttribute("class")).includes("bg-gradient-to-br"), "invite is primary");
    ok(!(await message.getAttribute("class")).includes("bg-gradient-to-br"), "message is secondary");
    ok(await invite.evaluate((element, text) => Boolean(element.compareDocumentPosition([...document.querySelectorAll("button")].find(el => el.textContent.trim() === text)) & Node.DOCUMENT_POSITION_FOLLOWING), dict["golferProfile.message"]), "invite first in focus/DOM order");
    for (const locator of [invite, message]) { const b = await locator.boundingBox(); ok(b.height >= 44, "44px action target"); ok(b.x >= 0 && b.x + b.width <= width, "action in viewport"); }
    ok(await page.getByText(dict["golferProfile.playingStyle"], { exact: true }).evaluate(el => Boolean(el.compareDocumentPosition([...document.querySelectorAll("p")].find(p => p.textContent === "Synthetic golfer biography")) & Node.DOCUMENT_POSITION_FOLLOWING)), "playing facts precede bio");
    equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "profile no overflow");
    if (width === 320) await page.screenshot({ path: out + "/profile-" + locale + ".png", fullPage: true });
    await message.click(); await page.waitForURL(base + "/messages/g2");
    equal(await page.evaluate(() => JSON.parse(localStorage.getItem("golfme:chatDrafts") ?? "{}")["dm:g2"] ?? ""), "", "secondary message opens without seeding a draft");
    await page.goBack(); await invite.waitFor();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("golfme:data:v8")).directMessages);
    await invite.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(base + "/messages/g2");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("golfme:chatDrafts") ?? "{}")["dm:g2"]);
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("golfme:chatDrafts"))["dm:g2"]);
    ok(draft.length > 0, "round invitation seeds a draft");
    equal(await page.evaluate(() => JSON.parse(localStorage.getItem("golfme:data:v8")).directMessages), before, "invitation sends nothing");
    await page.goBack(); await invite.waitFor(); await invite.click(); await page.waitForURL(base + "/messages/g2");
    equal(await page.evaluate(() => JSON.parse(localStorage.getItem("golfme:chatDrafts"))["dm:g2"]), draft, "repeated invite preserves draft");
    await page.goto(base + "/golfer/g2");
    await page.evaluate(() => localStorage.setItem("golfme:chatDrafts", JSON.stringify({ "dm:g2": "Keep my existing draft" })));
    await invite.click(); await page.waitForURL(base + "/messages/g2");
    equal(await page.evaluate(() => JSON.parse(localStorage.getItem("golfme:chatDrafts"))["dm:g2"]), "Keep my existing draft", "existing draft preserved");
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem("golfme:data:v8"));
      data.blocks = [{ blockerId: "g1", blockedId: "g2", createdAt: new Date().toISOString() }];
      localStorage.setItem("golfme:data:v8", JSON.stringify(data));
    });
    await page.goto(base + "/golfer/g2");
    await page.getByRole("heading").first().waitFor();
    equal(await invite.count(), 0, "own block hides invite");
    equal(await message.count(), 0, "own block hides message");
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem("golfme:data:v8"));
      data.blocks = [{ blockerId: "g2", blockedId: "g1", createdAt: new Date().toISOString() }];
      localStorage.setItem("golfme:data:v8", JSON.stringify(data));
    });
    await page.reload(); await page.getByRole("heading").first().waitFor();
    equal(await invite.count(), 0, "other block hides invite");
    equal(await message.count(), 0, "other block hides message");
    equal(errors, [], "no runtime exceptions");
    cases.push({ locale, width, passed: true });
    console.log("PASS", locale, width);
    await context.close();
  }
  fs.writeFileSync("docs/qa/golf-first-purpose-ui-results.json", JSON.stringify({ assertions, cases, network: "All external requests blocked; synthetic demo data only.", limits: "Chromium only, no physical device, real Auth/backend or native shell tests." }, null, 2) + "\n");
  console.log("PASS", assertions, "assertions");
} finally { await browser?.close(); await new Promise(resolve => server.httpServer.close(resolve)); }

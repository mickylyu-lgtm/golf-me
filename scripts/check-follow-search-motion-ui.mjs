// Local synthetic Chromium/WebKit QA. No customer accounts, data or calls.
// node scripts/check-follow-search-motion-ui.mjs (installed Playwright browser)
import { chromium, webkit } from "playwright-core";
import { createServer } from "vite";
import { syntheticKeyboardPlugin } from "./synthetic-keyboard-plugin.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "synthetic-search-only";
const base = "http://127.0.0.1:5197";
const fixture = { name: "search-sheet-native-fixture", enforce: "pre", transform(source, id) {
  if (!id.split("?")[0].endsWith("/src/lib/useSearchSheetLayout.ts")) return;
  const target = "const native = Capacitor.isNativePlatform();";
  assert.ok(source.includes(target));
  return source.replace(target, "const native = (window as Window & { __searchTestNative?: boolean }).__searchTestNative === true;").replaceAll("env(safe-area-inset-top, 0px)", "var(--synthetic-safe-top, 0px)");
} };
const server = await createServer({ plugins: [syntheticKeyboardPlugin(), fixture], server: { host: "127.0.0.1", port: 5197, strictPort: true,
  fs: { allow: [process.cwd(), resolve(dirname(fileURLToPath(import.meta.resolve("vite/package.json"))), "../..")] } } });
await server.listen();
let browser;
let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions++; };
const equal = (a, b, message) => { assert.equal(a, b, message); assertions++; };
const errors = [];
let blocked = 0;
fs.mkdirSync("artifacts.local/follow-search", { recursive: true });
try {
  const engine = process.env.SEARCH_TEST_ENGINE === "webkit" ? webkit : chromium;
  browser = await engine.launch({ headless: true,
    ...(engine === webkit && process.env.WEBKIT_EXECUTABLE ? { executablePath: process.env.WEBKIT_EXECUTABLE } : {}), ...(process.env.CHROMIUM_EXECUTABLE && engine === chromium ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}), ...(engine === chromium ? { args: ["--no-sandbox"] } : {}) });
  for (const [width, height, keyboardHeight] of [[320,844,320],[390,844,320],[1440,900,320],[844,390,216]]) {
    if (process.env.SEARCH_TEST_WIDTH && width !== Number(process.env.SEARCH_TEST_WIDTH)) continue;
    const context = await browser.newContext({ viewport: { width, height } });
    await context.route("**/*", route => {
      if (route.request().url().startsWith(base + "/")) return route.continue();
      blocked++; return route.abort();
    });
    await context.addInitScript(() => { window.__searchTestNative = true; });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await page.evaluate(async () => {
      const { seedData } = await import("/src/lib/storage.ts");
      const data = seedData();
      data.session = { isLoggedIn: true, hasOnboarded: true };
      data.golfers = data.golfers.map(g => ({ ...g, photoUrl: "" }));
      const template = data.golfers.find(g => g.id === "g2");
      const people = Array.from({ length: 65 }, (_, i) => ({ ...template, id: "search-" + i, name: "Search Golfer " + i, username: "searchgolfer" + i, photoUrl: "" }));
      data.golfers.push(...people);
      data.follows = people.flatMap((g, i) => [
        { id: "in-" + i, followerId: g.id, followingId: "g1", createdAt: "2026-01-01T00:00:00Z" },
        { id: "out-" + i, followerId: "g1", followingId: g.id, createdAt: "2026-01-01T00:00:00Z" },
      ]);
      data.blocks = []; data.followRequests = [];
      localStorage.setItem("golfme:isDemo", "1"); localStorage.setItem("golfme:data:v8", JSON.stringify(data)); localStorage.setItem("golfme:locale", "en");
    });
    await page.goto(base + "/profile");
    const dialog = page.getByRole("dialog").first();
    const open = async () => { await page.getByRole("button", { name: "65 followers", exact: true }).click(); await dialog.getByRole("searchbox").waitFor(); await page.waitForTimeout(350); };
    const keyboard = value => page.evaluate(value => window.dispatchEvent(new CustomEvent("golfme:synthetic-keyboard", { detail: { height: value } })), value);
    const close = async () => { await dialog.getByRole("button", { name: "Close", exact: true }).click(); await dialog.waitFor({ state: "hidden" }); };
    await open();
    const search = dialog.getByRole("searchbox");
    const scroller = dialog.locator(":scope > div").nth(1);
    const initial = await search.boundingBox();
    const beforeWindow = await page.evaluate(() => window.scrollY);
    const initialSheet = await dialog.boundingBox();
    await scroller.evaluate(el => el.scrollTop = 110);
    const scrollBefore = await scroller.evaluate(el => el.scrollTop);
    await search.click();
    await keyboard(keyboardHeight);
    await page.waitForTimeout(60);
    const mid = await dialog.boundingBox();
    if (height > 600) {
      check(mid.height < initialSheet.height - 1 && mid.height > initialSheet.height - keyboardHeight + 1, "native bottom edge has intermediate motion " + width);
      check(Math.abs((await search.boundingBox()).y - initial.y) < 1, "search does not jump at focus " + width);
    }
    await page.waitForTimeout(320);
    const shown = await search.boundingBox();
    check(shown.y >= 0 && shown.y + shown.height <= height - keyboardHeight + 1, "search visible above keyboard " + width);
    const closeBox = await dialog.getByRole("button", { name: "Close", exact: true }).boundingBox();
    check(closeBox.y >= 0 && closeBox.y + closeBox.height <= height - keyboardHeight + 1, "Close visible " + width);
    const sheet = await dialog.boundingBox();
    check(sheet.y + sheet.height <= height - keyboardHeight + 1, "sheet fits keyboard " + width);
    equal(await page.evaluate(() => window.scrollY), beforeWindow, "background never pans " + width);
    equal(await scroller.evaluate(el => el.scrollTop), scrollBefore, "opening preserves list scroll " + width);
    for (const query of ["searchgolfer64", "missing", "", "Search Golfer 1"]) {
      await search.fill(query);
      await page.waitForTimeout(180);
      check(Math.abs((await search.boundingBox()).y - shown.y) < 1, "query/results do not move search " + query + " " + width);
      check(Math.abs((await dialog.boundingBox()).height - sheet.height) < 1, "query/results keep sheet height " + width);
    }
    await search.fill(""); await page.waitForTimeout(150);
    await dialog.getByRole("button", { name: "Following 65", exact: true }).click();
    await page.waitForTimeout(150);
    equal(await search.inputValue(), "", "tab switch resets query");
    if (height > 600) check(Math.abs((await search.boundingBox()).y - shown.y) < 1, "following search shares stable header " + width);
    else { await search.focus(); await page.waitForTimeout(80); check((await search.boundingBox()).y + (await search.boundingBox()).height <= height - keyboardHeight + 1, "landscape refocus reveals search after tab scroll"); }
    await dialog.getByRole("button", { name: "Load more", exact: true }).click();
    await page.waitForTimeout(150);
    check(await dialog.locator("li").count() >= 60, "following loads more above keyboard");
    if (height > 600) check(Math.abs((await search.boundingBox()).y - shown.y) < 1, "list scrolling keeps search pinned");
    // Native reopen and keyboard-height retargeting must not leave a queued jump.
    await search.focus(); await keyboard(0); await page.waitForTimeout(50); await keyboard(keyboardHeight + (height > 600 ? 30 : 0));
    await page.waitForTimeout(320);
    if (height > 600) check(Math.abs((await search.boundingBox()).y - initial.y) < 1, "interrupted close/open stays anchored");
    await keyboard(0); await page.waitForTimeout(320);
    check(Math.abs((await search.boundingBox()).y - initial.y) < 1, "close returns original header");
    const afterCloseScroll = await scroller.evaluate(el => el.scrollTop);
    check(afterCloseScroll > 0, "keyboard close does not undo deliberate list scrolling");
    await page.screenshot({ path: `artifacts.local/follow-search/native-${width}.png` });
    await close();
    equal(await page.evaluate(() => document.body.style.overflow), "", "close unlocks page");
    await keyboard(keyboardHeight); await open();
    check((await dialog.boundingBox()).y + (await dialog.boundingBox()).height <= height - keyboardHeight + 1, "mount while keyboard open fits");
    await keyboard(0); await page.waitForTimeout(320);
    await dialog.getByRole("button", { name: "Remove Search Golfer 0 as a follower", exact: true }).click();
    equal(await page.getByRole("dialog").count(), 2, "nested confirm opens");
    await page.keyboard.press("Escape");
    equal(await page.getByRole("dialog").count(), 1, "Escape closes only nested confirmation");
    equal(await page.evaluate(() => document.body.style.overflow), "hidden", "nested close preserves page lock");
    await close(); await keyboard(0);
    // Synthetic Safari visualViewport: no native signal, no doubled inset or
    // CSS animation lag behind the viewport's already-moving keyboard.
    await page.evaluate(() => {
      window.__searchTestNative = false;
      const viewport = new EventTarget();
      Object.assign(viewport, { height: innerHeight, width: innerWidth, offsetTop: 0, scale: 1 });
      Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
    });
    await open();
    const webInitial = await search.boundingBox();
    await search.focus();
    for (const inset of [80, 180, keyboardHeight]) {
      await page.evaluate(inset => { window.visualViewport.height = innerHeight - inset; window.visualViewport.dispatchEvent(new Event("resize")); }, inset);
      await page.waitForTimeout(30);
      const box = await dialog.boundingBox();
      check(box.y + box.height <= height - inset + 1, "web sheet follows actual viewport " + inset);
      equal(await dialog.evaluate(el => getComputedStyle(el).transitionDuration), "0s", "web does not animate a second time");
      if (height > 600) check(Math.abs((await search.boundingBox()).y - webInitial.y) < 1, "web search anchored " + inset);
    }
    await search.fill("missing"); await page.waitForTimeout(100);
    if (height > 600) check(Math.abs((await search.boundingBox()).y - webInitial.y) < 1, "web empty state anchored");
    await search.evaluate(el => el.blur());
    await page.evaluate(() => { window.visualViewport.height = innerHeight; window.visualViewport.dispatchEvent(new Event("resize")); });
    await page.waitForTimeout(50); await close();
    equal(await page.evaluate(() => document.body.style.overflow), "", "web close unlocks");
    await page.evaluate(() => { window.visualViewport.height = innerHeight - 200; window.visualViewport.dispatchEvent(new Event("resize")); });
    equal(await page.getByRole("dialog").count(), 0, "no late viewport event reopens sheet");
    // Android layout resize: blur occurs before the keyboard expands the
    // viewport. Neither that blur nor an in-sheet tab tap may reset the anchor.
    if (width === 390) {
      await page.evaluate(() => { window.visualViewport.height = innerHeight; });
      await open(); await search.focus();
      await page.evaluate(() => {
        window.__innerHeightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");
        Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight - 320 });
        window.visualViewport.height = innerHeight;
        window.dispatchEvent(new Event("resize"));
      });
      await page.waitForTimeout(60);
      const resized = await search.boundingBox();
      await search.evaluate(el => el.blur()); await page.waitForTimeout(60);
      check(Math.abs((await search.boundingBox()).y - resized.y) < 1, "Android blur before recovery preserves anchor");
      await dialog.getByRole("button", { name: "Following 65", exact: true }).click(); await page.waitForTimeout(60);
      check(Math.abs((await search.boundingBox()).y - resized.y) < 1, "Android tab switch before recovery preserves anchor");
      await page.evaluate(() => { Object.defineProperty(window, "innerHeight", window.__innerHeightDescriptor); window.visualViewport.height = innerHeight; window.dispatchEvent(new Event("resize")); });
      await page.waitForTimeout(60); await close();
    }
    if (width === 844) {
      await page.evaluate(() => { window.__searchTestNative = true; });
      // Enlarge real rem-based text and assert the INPUT is inside its clipping
      // toolbar, rather than merely inside the page/keyboard rectangle.
      for (const locale of ["en", "zh-CN", "zh-TW", "es", "ko", "ja"]) {
        await page.evaluate(locale => localStorage.setItem("golfme:locale", locale), locale);
        await page.goto(base + "/profile");
        await page.getByTestId("own-profile-stats-grid").waitFor();
        await page.getByTestId("own-profile-stats-grid").getByRole("button").last().click();
        await dialog.getByRole("searchbox").waitFor();
        await page.evaluate(() => document.documentElement.style.fontSize = "200%");
        await page.waitForTimeout(350);
        await search.focus(); await keyboard(216); await page.waitForTimeout(350);
        const geometry = await search.evaluate(el => {
          const input = el.getBoundingClientRect(); const toolbar = el.parentElement.parentElement.parentElement.getBoundingClientRect();
          return { inputTop: input.top, inputBottom: input.bottom, toolbarTop: toolbar.top, toolbarBottom: toolbar.bottom };
        });
        check(geometry.inputTop >= geometry.toolbarTop - 1 && geometry.inputBottom <= geometry.toolbarBottom + 1, "200% landscape input unclipped " + locale + " " + JSON.stringify(geometry));
        check(geometry.inputBottom <= 174 + 1, "200% landscape input above keyboard " + locale);
        const closeBox = await dialog.getByRole("button", { name: "Close", exact: true }).boundingBox();
        check(closeBox.y + closeBox.height <= 174 + 1, "200% Close reachable " + locale);
        await page.screenshot({ path: `artifacts.local/follow-search/large-landscape-${locale}.png` });
        await close(); await keyboard(0);
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = ""; localStorage.setItem("golfme:locale", "en"); });
      await page.goto(base + "/profile");
    }
    if (width === 390) {
      await page.setViewportSize({ width: 390, height: 667 });
      await page.evaluate(() => { window.__searchTestNative = true; document.documentElement.style.fontSize = "200%"; document.documentElement.style.setProperty("--synthetic-safe-top", "47px"); });
      await open(); await search.focus(); await keyboard(430); await page.waitForTimeout(350);
      const bounds = await search.evaluate(el => { const a=el.getBoundingClientRect(), b=el.parentElement.parentElement.parentElement.getBoundingClientRect(); return { top:a.top, bottom:a.bottom, clipTop:b.top, clipBottom:b.bottom }; });
      check(bounds.top >= bounds.clipTop - 1 && bounds.bottom <= bounds.clipBottom + 1, "safe-area enlarged search remains unclipped " + JSON.stringify(bounds));
      check(bounds.bottom <= 238, "safe-area enlarged search stays above keyboard " + JSON.stringify(bounds) + " height=" + await page.evaluate(() => innerHeight));
      await close(); await keyboard(0);
      await page.evaluate(() => { document.documentElement.style.fontSize = ""; document.documentElement.style.removeProperty("--synthetic-safe-top"); });
      await page.setViewportSize({ width, height });
    }
    // Reduced-motion native resize is instant.
    await page.evaluate(() => { window.__searchTestNative = true; });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(); await search.focus(); await keyboard(keyboardHeight); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check((await dialog.boundingBox()).y + (await dialog.boundingBox()).height <= height - keyboardHeight + 1, "reduced motion instantly fits " + width + " " + JSON.stringify(await dialog.boundingBox()) + " " + JSON.stringify(await dialog.evaluate(el => ({style:el.getAttribute("style"), parent:el.parentElement.getAttribute("style"), innerHeight, native:window.__searchTestNative, font:getComputedStyle(document.documentElement).fontSize}))));
    await close(); await keyboard(0);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal overflow");
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ engine: process.env.SEARCH_TEST_ENGINE ?? "chromium", assertions, errors, externalRequestsBlocked: blocked, status: "passed", limitation: "Synthetic keyboard source/visualViewport; not physical iOS or Capacitor plugin verification." }, null, 2));
} finally { await browser?.close(); await server.close(); }

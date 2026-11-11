// Local synthetic auth only; external requests blocked. See tutorial-test-plugin.
import { chromium } from "playwright-core";
import { createServer } from "vite";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tutorialTestPlugin } from "./tutorial-test-plugin.mjs";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "synthetic-preview-only";
const base = "http://127.0.0.1:5193";
const server = await createServer({ plugins: [tutorialTestPlugin()], server: { host: "127.0.0.1", port: 5193, strictPort: true, fs: { allow: [process.cwd(), resolve(dirname(fileURLToPath(import.meta.resolve("vite/package.json"))), "../..")] } } });
await server.listen();
let browser;
let checks = 0;
function ok(condition, label) { assert.ok(condition, label); checks++; }
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox"], env: { ...process.env, ...(process.env.CHROMIUM_LIB_DIR ? { LD_LIBRARY_PATH: process.env.CHROMIUM_LIB_DIR } : {}) } });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const blocked = [];
  await context.route("**/*", route => {
    if (route.request().url().startsWith(base + "/")) return route.continue();
    blocked.push(route.request().url()); return route.abort();
  });
  await context.addInitScript(() => { window.__tutorialTestInitialAuth = { isDemo: false, authUser: { id: "ordinary-account" }, onboardingTutorialCompleted: true }; });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base);
  await page.evaluate(async () => {
    const { seedData } = await import("/src/lib/storage.ts");
    const data = seedData(); data.session = { isLoggedIn: true, hasOnboarded: true };
    data.golfers = data.golfers.map(g => ({ ...g, photoUrl: "" }));
    localStorage.setItem("golfme:isDemo", "1"); localStorage.setItem("golfme:data:v8", JSON.stringify(data)); localStorage.setItem("golfme:locale", "en");
  });
  await page.goto(base + "/settings");
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  const founder = await page.evaluate(async () => (await import("/src/lib/founder.ts")).FOUNDER_USER_ID);
  const setAuth = async (id, isDemo = false, completed = true) => {
    await page.evaluate(({ id, isDemo, completed }) => window.__setTutorialTestAuth({ isDemo, authUser: id ? { id } : null, onboardingTutorialCompleted: completed }), { id, isDemo, completed });
    await page.waitForTimeout(30);
  };
  const controls = action => page.evaluate(action => window.__tutorialTestControls[action](), action);
  const dialog = () => page.getByRole("dialog");
  for (const [id, demo] of [["ordinary-account", false], ["other-admin", false], [null, false], [founder, true], ["g1", true]]) {
    await setAuth(id, demo);
    ok(await page.getByRole("button", { name: "Replay Tutorial", exact: true }).count() === 0, "replay hidden for non-founder " + id);
    const before = page.url(); await controls("replay"); await controls("start");
    ok(await dialog().count() === 0 && page.url() === before, "direct replay and completed onboarding refused " + id);
  }
  await setAuth("brand-new-account", false, false);
  await controls("start"); await dialog().waitFor();
  ok(await dialog().count() === 1, "new ordinary account still gets onboarding");
  await controls("skip"); await dialog().waitFor({ state: "hidden" });
  await controls("start");
  ok(await dialog().count() === 0, "completion blocks automatic restart in same session");
  ok(await page.evaluate(() => window.__tutorialTestSaves.length) === 1, "completion persisted exactly once");
  await setAuth(founder);
  await page.goto(base + "/settings"); await setAuth(founder);
  await page.getByRole("button", { name: "Replay Tutorial", exact: true }).click(); await dialog().waitFor();
  await setAuth("ordinary-account");
  ok(await dialog().count() === 0, "account switch immediately ends founder replay");
  await setAuth(founder);
  ok(await dialog().count() === 0, "returning to founder does not resume stale replay");
  fs.mkdirSync("artifacts.local", { recursive: true });
  for (const [width, height] of [[320, 568], [390, 844], [1440, 900]]) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: "no-preference" });
    await controls("replay"); await dialog().waitFor(); await page.waitForTimeout(650);
    await page.evaluate(() => { window.__spotlightNode = document.querySelector("[data-tutorial-spotlight]"); });
    for (let step = 0; step < 7; step++) {
      await page.waitForTimeout(850);
      const state = await page.evaluate(async () => {
        const ring = document.querySelector("[data-tutorial-spotlight]");
        const index = window.__tutorialTestControls.stepIndex;
        const { TUTORIAL_STEPS } = await import("/src/lib/tutorialSteps.ts");
        const target = [...document.querySelectorAll(`[data-tutorial-id="${TUTORIAL_STEPS[index].targetId}"]`)].find(e => e.offsetParent !== null && !e.closest('[inert], [aria-hidden="true"]'));
        const r = ring.getBoundingClientRect(), t = target?.getBoundingClientRect();
        return { index, same: ring === window.__spotlightNode, opacity: getComputedStyle(ring).opacity, delta: t ? Math.max(Math.abs(r.x - (t.x - 8)), Math.abs(r.y - (t.y - 8)), Math.abs(r.width - (t.width + 16)), Math.abs(r.height - (t.height + 16))) : null };
      });
      ok(state.index === step && state.same, "single stable cutout " + width + " step " + step);
      ok(state.opacity === "1" && state.delta !== null && state.delta < 2, "settled spotlight follows target " + width + " step " + step + JSON.stringify(state));
      if (step === 1) {
        // Move the real target via a layout-affecting DOM insertion, then resize.
        await page.evaluate(() => { const target = document.querySelector('[data-tutorial-id="tutorial-course-map"]'); target.style.width = "70px"; target.append(document.createElement("span")); });
        await page.waitForTimeout(550);
        ok(await page.locator("[data-tutorial-spotlight]").evaluate(e => Math.abs(e.getBoundingClientRect().width - 86) < 2), "async target resize followed");
      }
      if (step === 5) await page.screenshot({ path: `artifacts.local/tutorial-spotlight-${width}.png` });
      if (step < 6) {
        const before = await page.locator("[data-tutorial-spotlight]").boundingBox();
        await dialog().getByRole("button", { name: "Next", exact: true }).click();
        if (step === 1) {
          await page.waitForTimeout(80);
          const middle = await page.locator("[data-tutorial-spotlight]").boundingBox();
          await page.waitForTimeout(650);
          const after = await page.locator("[data-tutorial-spotlight]").boundingBox();
          ok(Math.abs(middle.y - before.y) > 1 && Math.abs(middle.y - after.y) > 1, "interpolated movement rather than snap " + width);
        }
      }
    }
    await controls("next"); await dialog().waitFor({ state: "hidden" });
    ok(new URL(page.url()).pathname === "/", "finish returns home");
    await controls("replay"); await dialog().waitFor();
    await controls("next"); await controls("back"); await controls("next"); await controls("skip");
    await dialog().waitFor({ state: "hidden" }); await page.waitForTimeout(500);
    ok(await page.locator("[data-tutorial-spotlight]").count() === 0, "rapid next/back/skip leaves no overlay");
  }
  await page.emulateMedia({ reducedMotion: "reduce" }); await controls("replay"); await dialog().waitFor();
  ok(await page.locator("[data-tutorial-spotlight]").evaluate(e => getComputedStyle(e).transitionProperty === "none"), "reduced motion disables cutout transition");
  await controls("next"); await page.waitForTimeout(50);
  ok(await page.locator("[data-tutorial-spotlight]").evaluate(e => getComputedStyle(e).transitionProperty === "none"), "reduced motion remains instant on next");
  await controls("skip");
  // Bounded sampling cleans up; delayed unrelated DOM changes cannot restore a dismissed overlay.
  await page.evaluate(() => document.body.append(document.createElement("div"))); await page.waitForTimeout(1800);
  ok(await dialog().count() === 0, "late target changes after dismissal do not reopen");
  await page.goto(base + "/"); await page.waitForFunction(() => !!window.__tutorialTestControls); await setAuth("automatic-home-new", false, false);
  await dialog().waitFor();
  ok(await dialog().count() === 1, "Home automatically starts onboarding for new ordinary account");
  await controls("skip"); await dialog().waitFor({ state: "hidden" });
  await page.waitForTimeout(200);
  ok(await dialog().count() === 0, "Home cannot reopen a skipped tutorial");
  const lateTarget = await page.evaluate(async () => {
    const { watchTutorialTarget } = await import("/src/lib/tutorialSpotlight.ts");
    let callbacks = 0, scrolls = 0;
    const stop = watchTutorialTarget("synthetic-late-target", () => callbacks++);
    await new Promise(resolve => setTimeout(resolve, 1750));
    const target = document.createElement("div"); target.dataset.tutorialId = "synthetic-late-target";
    target.style.cssText = "position:absolute;top:2500px;left:20px;width:100px;height:50px";
    const scroll = target.scrollIntoView.bind(target);
    target.scrollIntoView = options => { scrolls++; scroll(options); };
    document.body.append(target); await new Promise(resolve => setTimeout(resolve, 500));
    const acquired = callbacks > 0;
    target.style.width = "120px"; await new Promise(resolve => setTimeout(resolve, 200));
    const beforeStop = callbacks; stop(); target.remove();
    window.dispatchEvent(new Event("resize")); await new Promise(resolve => setTimeout(resolve, 500));
    return { acquired, scrolls, callbacks, beforeStop };
  });
  ok(lateTarget.acquired, "target arriving after 1.6 second sampling window is acquired");
  ok(lateTarget.scrolls === 1, "late target scrolls once despite resize and repeated measurement");
  ok(lateTarget.callbacks === lateTarget.beforeStop, "disposed tracker cannot publish after target removal or resize");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "PASS", checks, viewports: [320, 390, 1440], blockedExternalRequests: blocked.length, pageErrors: errors.length }));
} finally { await browser?.close(); await server.close(); }

// Local-only real component QA. Network calls outside this Vite server are blocked.
// AUTO_MATCH_ENGINE=webkit node scripts/check-auto-match-motion-ui.mjs
import { chromium, webkit } from "playwright-core";
import { createServer } from "vite";
import { realpath, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "dummy";
const origin = "http://127.0.0.1:5199";
const engine = process.env.AUTO_MATCH_ENGINE === "webkit" ? "webkit" : "chromium";
const fixture = {
  name: "auto-match-local-fixture", enforce: "pre",
  transform(source, id) {
    if (!id.split("?")[0].endsWith("/src/pages/AutoMatch.tsx")) return;
    const replacements = [
      ["} = useData();", "} = useFixtureData(useData());"],
      ["const { isDemo } = useAuth();", "const { isDemo } = useFixtureAuth(useAuth());"],
      ["const rounds = useRealRounds();", "const rounds = useFixtureRounds(useRealRounds());"],
      ["const social = useRealSocial();", "const social = useFixtureSocial(useRealSocial());"],
    ];
    for (const [from, to] of replacements) {
      assert.ok(source.includes(from), "fixture target still exists: " + from);
      source = source.replace(from, to);
    }
    return 'import { useFixtureData, useFixtureAuth, useFixtureRounds, useFixtureSocial } from "/scripts/automatch-motion-state.ts";\n' + source;
  },
};
const server = await createServer({ plugins: [fixture], cacheDir: ".vite-automatch.local",
  server: { host: "127.0.0.1", port: 5199, strictPort: true, fs: { allow: [process.cwd(), await realpath("node_modules"), await realpath("node_modules/@fontsource/inter")] } } });
await server.listen();
let browser;
let assertions = 0;
let blocked = 0;
const errors = [];
function check(value, message) { assertions++; assert.ok(value, message); }
function equal(actual, expected, message) { assertions++; assert.equal(actual, expected, message); }
await mkdir("artifacts.local/automatch", { recursive: true });
try {
  browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
    ...(engine === "chromium" ? { executablePath: process.env.CHROMIUM_EXECUTABLE, args: ["--no-sandbox"] } : { executablePath: process.env.WEBKIT_EXECUTABLE }),
  });
  for (const [width, height] of [[320,844], [390,844], [844,390], [1440,900]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.route("**/*", route => {
      if (route.request().url().startsWith(origin + "/")) return route.continue();
      blocked++; return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/login");
    await page.evaluate(async () => {
      const { seedData } = await import("/src/lib/storage.ts");
      const data = seedData();
      data.session = { isLoggedIn: true, hasOnboarded: true };
      data.golfers = data.golfers.map(g => ({ ...g, photoUrl: "", playingAreaCoords: { lat: 40.7891, lng: -73.135 } }));
      const template = data.golfCalls[0];
      data.golfCalls = [0,1,2].map(i => ({ ...template, id: "match-" + i, course: "Match Course " + (i + 1), dateISO: new Date(Date.now() + 3 * 86400000).toISOString(), distanceMiles: i + 2 }));
      localStorage.setItem("golfme:isDemo", "1");
      localStorage.setItem("golfme:data:v8", JSON.stringify(data));
      localStorage.setItem("golfme:locale", "en");
    });
    await page.goto(origin + "/find");
    await page.getByRole("heading", { name: "Find golf near you", exact: true }).waitFor();
    let heldRoute;
    const hold = new Promise(resolve => { heldRoute = resolve; });
    const lazyPattern = "**/src/pages/AutoMatch.tsx";
    await page.route(lazyPattern, async route => { await hold; await route.continue(); });
    await page.getByRole("button", { name: /Auto-Match Me Rounds picked for you/ }).click();
    await page.locator(".gm-automatch-searching").waitFor();
    equal(await page.locator(".gm-automatch-searching").count(), 1, "lazy route uses special loader " + width);
    heldRoute();
    await page.getByRole("heading", { name: "Auto-Match", exact: true }).waitFor();
    await page.unroute(lazyPattern);
    await page.locator(".gm-automatch-results").waitFor();
    equal(await page.locator(".gm-automatch-searching").count(), 0, "cached results shown immediately " + width);
    equal(await page.locator(".gm-automatch-mark").count(), 1, "cached mode has one entrance scene");
    const status = () => page.locator('[role="status"]').filter({ has: page.locator(".gm-automatch-searching") });
    const setMode = async mode => {
      await page.evaluate(async mode => { const fixture = await import("/scripts/automatch-motion-state.ts"); fixture.setMode(mode); }, mode);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    await page.getByRole("button", { name: "Show Another Match", exact: true }).click();
    await page.getByRole("button", { name: "Show Another Match", exact: true }).click();
    check((await page.locator(".gm-automatch-results").textContent()).includes("3 of 3"), "rapid next stays responsive");
    equal(await page.locator(".gm-automatch-searching").count(), 0, "next match never adds loading");
    await page.getByRole("button", { name: "Edit Preferences", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    equal(await page.getByRole("dialog").count(), 0, "preference dialog dismisses");
    check((await page.locator(".gm-automatch-results").textContent()).includes("3 of 3"), "preference close preserves displayed match");
    await page.waitForTimeout(1100);
    equal(await page.locator(".gm-automatch-mark").evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === "running").length), 0, "selected header stays still, no idle looping");

    for (const mode of ["roundsLoading", "golfersLoading"]) {
      await setMode(mode);
      await status().waitFor();
      equal(await page.locator(".gm-automatch-results").count(), 0, "pending cannot display false results");
      equal(await status().getAttribute("aria-live"), "polite", "loader has polite status");
      equal(await page.locator(".gm-automatch-searching").getAttribute("aria-hidden"), "true", "decorative scene not announced");
      const gradientIds = await page.locator(".gm-automatch-scene linearGradient").evaluateAll(nodes => nodes.map(node => node.id));
      equal(new Set(gradientIds).size, 2, "header and loading radar gradients are distinct");
      equal(await page.locator(".gm-automatch-mark").evaluate(el => el.getAnimations({ subtree: true }).length), 0, "static header matches selected preview");
      const balls = page.locator(".gm-automatch-searching .gm-automatch-ball");
      equal(await balls.first().evaluate(el => getComputedStyle(el).animationIterationCount), "infinite", "real wait loops");
      const sweep = page.locator(".gm-automatch-searching .gm-automatch-sweep");
      const before = await sweep.evaluate(el => getComputedStyle(el).transform);
      await page.waitForTimeout(500);
      check(before !== await sweep.evaluate(el => getComputedStyle(el).transform), "radar visibly sweeps");
      const back = page.getByRole("button", { name: "Back", exact: true });
      equal(await back.isEnabled(), true, "back is usable during a wait");
    }
    await page.screenshot({ path: `artifacts.local/automatch/${engine}-loading-${width}.png` });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const selector of [".gm-automatch-searching .gm-automatch-ball", ".gm-automatch-searching .gm-automatch-sweep", ".gm-automatch-mark .gm-automatch-ball"]) {
      equal(await page.locator(selector).first().evaluate(el => getComputedStyle(el).animationName), "none", "reduced motion stops live animation");
      equal(await page.locator(selector).first().evaluate(el => getComputedStyle(el).transform), "none", "reduced motion uses settled position");
    }
    await setMode("rounds");
    equal(await page.locator(".gm-automatch-results").evaluate(el => getComputedStyle(el).animationName), "none", "reduced-motion result is instant");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    await setMode("error");
    equal(await page.locator(".gm-automatch-searching").count(), 0, "error stops search animation");
    const retry = page.getByRole("button", { name: "Try again", exact: true });
    await retry.click();
    await status().waitFor();
    equal(await page.locator(".gm-automatch-searching").count(), 1, "retry resumes only actual wait");
    await setMode("needsLocation");
    equal(await page.locator(".gm-automatch-searching").count(), 0, "missing location not hidden by loader");
    await page.getByRole("button", { name: "Set location", exact: true }).waitFor();
    await setMode("empty");
    await page.getByText("No rounds or golfers near you yet", { exact: true }).waitFor();
    equal(await page.locator(".gm-automatch-searching").count(), 0, "empty is not searching");
    await setMode("golfers");
    await page.getByText("No open rounds near you yet", { exact: true }).waitFor();
    check(await page.getByRole("button", { name: "View profile", exact: true }).count() > 0, "golfer-only fallback remains usable");
    await setMode("rounds");

    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow " + width);
    await page.screenshot({ path: `artifacts.local/automatch/${engine}-results-${width}.png` });
    if (width === 390) {
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await page.screenshot({ path: `artifacts.local/automatch/${engine}-dark.png` });
      await setMode("roundsLoading");
      await page.screenshot({ path: `artifacts.local/automatch/${engine}-dark-loading.png` });
      check(await page.locator(".gm-automatch-searching > path").first().evaluate(el => getComputedStyle(el).fill) !== "rgb(229, 242, 232)", "dark scene uses dusk greens");
      await page.evaluate(() => document.documentElement.classList.remove("dark"));
      // Back during search, then Forward cannot leave a stale overlay or loader.
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.waitForURL(origin + "/find");
      equal(await page.locator(".gm-automatch-scene").count(), 0, "back removes all mode motion");
      await setMode("rounds");
      await page.goForward();
      await page.locator(".gm-automatch-results").waitFor();
      equal(await page.locator(".gm-automatch-searching").count(), 0, "forward uses current settled state");
      equal(await page.evaluate(() => document.body.style.overflow), "", "navigation leaves no scroll lock");
    }
    if (width === 320) {
      for (const locale of ["en", "zh-CN", "zh-TW", "es", "ko", "ja"]) {
        await page.evaluate(locale => localStorage.setItem("golfme:locale", locale), locale);
        await page.reload();
        await page.locator(".gm-automatch-results").waitFor();
        await page.evaluate(() => document.documentElement.style.fontSize = "200%");
        await page.screenshot({ path: `artifacts.local/automatch/${engine}-enlarged-${locale}.png` });
        const headerOverflow = await page.locator(".gm-automatch-mark").evaluate(el => {
          const header = el.parentElement.parentElement;
          return [header, ...header.querySelectorAll("h1, p")].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => ({ tag: node.tagName, text: node.textContent, width: node.clientWidth, scroll: node.scrollWidth }));
        });
        check(headerOverflow.length === 0, "enlarged localized header fits " + locale + ": " + JSON.stringify(headerOverflow));
        await setMode("roundsLoading");
        await status().waitFor();
        check((await status().textContent()).trim().length > 10, "localized search status is present " + locale);
        check(await status().evaluate(el => el.scrollWidth <= el.clientWidth + 1), "enlarged localized loader fits " + locale);
        await page.screenshot({ path: `artifacts.local/automatch/${engine}-locale-${locale}.png` });
      }
    }
    await context.close();
  }
  equal(errors.length, 0, "no runtime errors: " + JSON.stringify(errors));
  const report = { engine, assertions, blockedExternalRequests: blocked, errors, productionDataAccess: false, nativeDeviceVerified: false };
  await writeFile(`artifacts.local/automatch/${engine}-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser?.close(); await server.close(); }

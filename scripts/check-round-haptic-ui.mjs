// Synthetic StrictMode hook + real card QA; no backend, accounts or device claims.
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright-core";
import { createServer } from "vite";
import { realpath } from "node:fs/promises";
const origin = "http://127.0.0.1:5206";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5206, strictPort: true, fs: { allow: [process.cwd(), await realpath("node_modules"), await realpath("node_modules/@fontsource/inter")] } },
  plugins: [{ name: "round-haptic-fixture", configureServer(s) { s.middlewares.use("/haptic-fixture", async (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(await s.transformIndexHtml("/haptic-fixture", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/round-haptic-fixture.tsx"></script></body></html>'));
  }); } }],
});
await server.listen();
let browser;
let count = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); count++; };
try {
  const engine = process.env.HAPTIC_TEST_ENGINE === "webkit" ? webkit : chromium;
  browser = await engine.launch({ headless: true, ...(engine === webkit && process.env.WEBKIT_EXECUTABLE ? { executablePath: process.env.WEBKIT_EXECUTABLE } : {}), ...(engine === chromium ? { args: ["--no-sandbox"] } : {}) });
  for (const reducedMotion of ["no-preference", "reduce"]) {
    for (const blockedStorage of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion });
      await context.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
      if (blockedStorage) await context.addInitScript(() => {
        const get = Storage.prototype.getItem;
        const set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) { if (key.startsWith("gm.roundCelebrated.")) throw Error("synthetic blocked storage"); return get.call(this, key); };
        Storage.prototype.setItem = function (key, value) { if (key.startsWith("gm.roundCelebrated.")) throw Error("synthetic blocked storage"); return set.call(this, key, value); };
      });
      const page = await context.newPage();
      const errors = []; page.on("pageerror", e => { errors.push(e.message); console.error(e.message); });
      await page.goto(origin + "/haptic-fixture");
      await page.getByTestId("celebrating").waitFor();
      const haptics = () => page.evaluate(() => window.__gmTapHaptics);
      const set = async next => { await page.evaluate(next => window.qa.set(next), next); await page.waitForTimeout(60); };
      eq(await haptics(), [], "no success for an active round or initial mounting");

      // Host completion is explicitly called only after the write resolves.
      await page.evaluate(() => { window.qa.celebrate(); window.qa.celebrate(); });
      eq(await haptics(), ["success"], "same-tick completion claims exactly once");
      await page.getByRole("status").waitFor();
      eq(await page.getByRole("status").getAttribute("aria-live"), "polite", "visual confirmation stays accessible");
      await set({ status: "completed" });
      eq(await haptics(), ["success"], "realtime echo and StrictMode visual mounting never duplicate");
      await page.evaluate(() => window.qa.done());
      await set({ mounted: false }); await set({ mounted: true });
      eq(await haptics(), ["success"], "revisiting a completed round does not repeat, even with blocked storage");
      eq(await page.getByTestId("celebrating").textContent(), "false", "completed revisit is quiet");

      // A group member sees a confirmed completion once.
      await set({ userId: "member" });
      eq(await haptics(), ["success", "success"], "each member/account has its own once-per-round acknowledgement");
      await page.evaluate(() => window.qa.done());
      await set({ id: "round-2", status: "open" });
      await page.evaluate(() => { window.qa.late = window.qa.celebrate; });
      await set({ id: "round-3" });
      await page.evaluate(() => window.qa.late());
      eq((await haptics()).length, 2, "late success from another route is ignored");
      await page.evaluate(() => { window.qa.late = window.qa.celebrate; });
      await set({ userId: "different-user" });
      await page.evaluate(() => window.qa.late());
      eq((await haptics()).length, 2, "late success from another account is ignored");
      await page.evaluate(() => { window.qa.late = window.qa.celebrate; });
      await set({ mounted: false });
      await page.evaluate(() => window.qa.late());
      eq((await haptics()).length, 2, "unmounted page never buzzes");
      await set({ mounted: true, member: false, status: "completed" });
      await page.evaluate(() => window.qa.celebrate());
      eq((await haptics()).length, 2, "non-members never celebrate");

      await set({ id: "round-4", member: true, status: "cancelled" });
      eq((await haptics()).length, 2, "cancelled state never celebrates");
      await set({ status: "completed", dateISO: "2020-01-01" });
      eq((await haptics()).length, 2, "old historical completion is silent");
      await set({ id: "round-5", status: "open", dateISO: new Date().toISOString() });
      await set({ status: "completed" });
      eq((await haptics()).length, 3, "newly fetched completion celebrates once");
      await page.getByRole("status").waitFor();
      if (reducedMotion === "reduce") {
        eq(await page.locator(".gm-holed-ball").evaluate(el => getComputedStyle(el).animationName), "none", "reduced motion remains respected");
      }
      eq(errors, [], "no runtime errors");
      await context.close();
    }
  }
  console.log(JSON.stringify({ engine: process.env.HAPTIC_TEST_ENGINE ?? "chromium", assertions: count, result: "passed" }));
} finally { await browser?.close(); await server.close(); }

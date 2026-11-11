// Built-app synthetic QA. No account or backend writes; all external requests blocked.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { preview } from "vite";
import { chromium } from "playwright-core";
const root = process.cwd();
const out = process.env.QA_OUTPUT_DIR ?? "/tmp/golfme-handicap-qa-20261111";
fs.mkdirSync(out, { recursive: true });
const server = await preview({ root, preview: { host: "127.0.0.1", port: 5199, strictPort: true } });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? "/home/shmick/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell",
  args: ["--no-sandbox"],
});
const base = "http://127.0.0.1:5199";
const colors = {
  light: { gold: "rgb(143, 102, 20)", violet: "rgb(109, 40, 217)", teal: "rgb(15, 118, 110)", forest: "rgb(27, 74, 45)", sage: "rgb(75, 102, 87)", neutral: "rgb(91, 104, 120)" },
  dark: { gold: "rgb(244, 185, 66)", violet: "rgb(221, 214, 254)", teal: "rgb(94, 234, 212)", forest: "rgb(143, 214, 168)", sage: "rgb(167, 183, 173)", neutral: "rgb(152, 165, 158)" },
};
const samples = [[0, "gold"], [2.35, "violet"], [5, "teal"], [10, "forest"], [20, "sage"], [30, "neutral"], [null, "neutral"]];
let assertions = 0;
const results = [];
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); assertions++; }
async function verifyStyles(locator, appearance) {
  const styles = await locator.evaluateAll(nodes => nodes.map(node => {
    const s = getComputedStyle(node);
    return { tone: [...node.classList].find(c => c.startsWith("gm-handicap--")).replace("gm-handicap--", ""), color: s.color, background: s.backgroundColor, border: s.borderTopColor, opacity: s.opacity, animation: s.animationName, text: node.textContent, overflow: node.scrollWidth > node.clientWidth + 1 };
  }));
  assert.ok(styles.length); assertions++;
  for (const s of styles) {
    equal(s.color, colors[appearance][s.tone], "computed ink " + s.tone);
    equal(s.opacity, "1", "no fading");
    equal(s.animation, "none", "no animation");
    equal(s.overflow, false, "no label overflow");
    if (["forest", "sage", "neutral"].includes(s.tone)) {
      equal(s.background, "rgba(0, 0, 0, 0)", "higher bands have no fill");
      equal(s.border, "rgba(0, 0, 0, 0)", "higher bands have no visible frame");
    }
  }
  return styles;
}
try {
  for (const width of [320, 390, 1440]) for (const appearance of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1100 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.goto(base + "/login");
    await page.waitForFunction(() => localStorage.getItem("golfme:data:v8"));
    const fixtures = await page.evaluate(({ samples, appearance }) => {
      const data = JSON.parse(localStorage.getItem("golfme:data:v8"));
      data.session = { isLoggedIn: true, hasOnboarded: true };
      const me = data.golfers.find(g => g.id === "g1");
      me.handicap = -2.3;
      const others = data.golfers.filter(g => g.id !== "g1");
      if (others.length < samples.length) throw Error("Not enough existing demo golfers");
      others.forEach((g, i) => { g.handicap = samples[i % samples.length][0]; });
      localStorage.setItem("golfme:data:v8", JSON.stringify(data));
      localStorage.setItem("golfme:isDemo", "1");
      localStorage.setItem("golfme:appearance", appearance);
      return others.slice(0, samples.length).map((g, i) => ({ id: g.id, value: g.handicap, tone: samples[i][1] }));
    }, { samples, appearance });
    await page.goto(base + "/profile");
    equal(await page.locator("html").evaluate(el => el.classList.contains("dark")), appearance === "dark", "appearance");
    await page.locator(".gm-handicap").first().waitFor();
    equal(await page.locator(".gm-handicap--gold").first().innerText(), "+2.3", "own profile plus notation");
    await verifyStyles(page.locator(".gm-handicap"), appearance);
    await page.screenshot({ path: path.join(out, "profile-" + appearance + "-" + width + ".png"), animations: "disabled" });
    for (const fixture of fixtures) {
      await page.goto(base + "/golfer/" + fixture.id);
      await page.getByRole("button", { name: "Compare", exact: true }).waitFor();
      if (fixture.value === null) {
        equal(await page.locator(".gm-handicap").count(), 0, "unknown public profile has no prestigious number");
      } else {
        equal(await page.locator(".gm-handicap").first().innerText(), String(fixture.value), "public profile numeric precision");
        const publicStyles = await verifyStyles(page.locator(".gm-handicap"), appearance);
        equal(publicStyles[0].tone, fixture.tone, "public profile correct band");
      }
      await page.getByRole("button", { name: "Compare", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const styles = await verifyStyles(dialog.locator(".gm-handicap"), appearance);
      equal(styles.map(s => s.tone), ["gold", fixture.tone], "Compare both sides");
      equal(styles[0].text, "+2.3 handicap", "localized plus label");
      equal(await dialog.getByText("Credibility", { exact: true }).count(), 0, "credibility removal preserved");
      if (fixture.value === null) equal(styles[1].text, "No handicap yet", "unknown label");
      if (fixture.tone === "violet") await page.screenshot({ path: path.join(out, "compare-" + appearance + "-" + width + ".png"), animations: "disabled" });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "page no horizontal overflow");
    }
    await page.goto(base + "/discover");
    await page.locator(".gm-handicap").first().waitFor();
    const cardStyles = await verifyStyles(page.locator(".gm-handicap"), appearance);
    equal([...new Set(cardStyles.map(s => s.tone))].sort(), ["forest", "gold", "neutral", "sage", "teal", "violet"], "cards show all six bands");
    await page.screenshot({ path: path.join(out, "cards-" + appearance + "-" + width + ".png"), animations: "disabled" });
    equal(await page.evaluate(() => JSON.parse(localStorage.getItem("golfme:data:v8")).golfers.find(g => g.id === "g1").handicap), -2.3, "rendering does not change stored value");
    equal(errors, [], "no runtime errors");
    results.push({ width, appearance, fixtures: fixtures.length, checks: "own/public profile, cards, Compare, all bands, plus precision, null, styles, close, overflow, no mutations" });
    await context.close();
  }
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ assertions, results }, null, 2));
  console.log(JSON.stringify({ assertions, results }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}

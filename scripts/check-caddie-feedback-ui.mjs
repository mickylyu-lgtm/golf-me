// Focused real mapping + score JSX, synthetic content only. Not full-page/provider QA.
import assert from "node:assert/strict";
import fs from "node:fs";
import { realpath } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright-core";
const out = "artifacts.local/caddie-feedback";
fs.mkdirSync(out, { recursive: true });
if (process.env.QA_CJK_FONT) fs.copyFileSync(process.env.QA_CJK_FONT, out + "/qa-font.ttc");
const context = fs.readFileSync("src/context/RealCaddieContext.tsx", "utf8");
const pageSource = fs.readFileSync("src/pages/CaddieAnalysisDetail.tsx", "utf8");
const mappings = context.slice(context.indexOf("const SCORE_CRITERION_KEYS:"), context.indexOf("const jsonToPoseData"));
const labels = pageSource.slice(pageSource.indexOf("const SCORE_CRITERIA_ORDER:"), pageSource.indexOf("function Section"));
const score = pageSource.slice(pageSource.indexOf("          {details.score && ("), pageSource.indexOf('          <p className="text-sm text-slate-700">{details.summary}'));
assert.ok(mappings.includes("json = cleanCaddieFeedback(json)"));
assert.ok(score.includes("{c.reason}"));
const expected = { en: "Keep your finish balanced.", "zh-CN": "收杆时重心保持在前脚，但身体略有晃动。", "zh-TW": "收桿時重心保持在前腳，但身體略有晃動。", es: "Mantén el equilibrio al terminar.", ko: "피니시에서 균형을 유지하세요.", ja: "フィニッシュでバランスを保ちましょう。" };
const fixture = [
  'import { useState } from "react"; import { createRoot } from "react-dom/client";',
  'import { cleanCaddieFeedback } from "../../supabase/functions/_shared/caddieFeedbackText.ts";',
  'import { sanitizeWorkOnCheckpoint, sanitizeCheckpointCues as checkpointCuesFromJson } from "../../supabase/functions/_shared/caddieCues.ts";',
  'import { phasesFromJson } from "../../supabase/functions/_shared/caddieVerdicts.ts";',
  'import { analysisLanguageFromJson } from "../../src/lib/caddieLanguage";',
  'import { en } from "../../src/i18n/locales/en"; import { zhCN } from "../../src/i18n/locales/zh-CN";',
  'import { zhTW } from "../../src/i18n/locales/zh-TW"; import { es } from "../../src/i18n/locales/es";',
  'import { ko } from "../../src/i18n/locales/ko"; import { ja } from "../../src/i18n/locales/ja";',
  'import "../../src/index.css";',
  process.env.QA_CJK_FONT ? 'const style = document.createElement("style"); style.textContent = \'@font-face{font-family:QA-CJK;src:url("/artifacts.local/caddie-feedback/qa-font.ttc")}body{font-family:QA-CJK,Arial,sans-serif}\'; document.head.appendChild(style);' : "",
  mappings, labels,
  'const locales = { en, "zh-CN": zhCN, "zh-TW": zhTW, es, ko, ja };',
  'const prose = ' + JSON.stringify(expected) + ';',
  'function App() {',
  'const [locale, setLocale] = useState("zh-CN"); const [visible, setVisible] = useState(true); const [legacy, setLegacy] = useState(false);',
  'const raw = { language: legacy ? undefined : locale, summary: prose[locale], score: Object.fromEntries(SCORE_CRITERION_KEYS.map(([key]) => [key, { points: 12, reason: prose[locale] + " Constraints遵守。 Analysis completed successfully." }])) };',
  'const before = JSON.stringify(raw); const details = jsonToDetails(raw, 60)!;',
  'if (JSON.stringify(raw) !== before) throw Error("Stored data mutated");',
  'const t = (key, vars = {}) => Object.entries(vars).reduce((text, [k, v]) => text.replace("{"+k+"}", v), locales[locale][key] ?? en[key]);',
  'return <main className="mx-auto max-w-lg p-4"><p>Local synthetic score fixture</p>',
  '<div className="flex flex-wrap gap-3 my-3">{Object.keys(locales).map(key => <button key={key} onClick={() => setLocale(key)}>{key}</button>)}</div>',
  '<button onClick={() => setVisible(v => !v)}>Toggle saved result</button><button className="ml-3" onClick={() => setLegacy(v => !v)}>Toggle legacy language</button>',
  '{visible && <section data-testid="score">' + score + '</section>}</main>;',
  '} createRoot(document.getElementById("root")!).render(<App />);',
].join("\n");
fs.writeFileSync(out + "/fixture.tsx", fixture);
const origin = "http://127.0.0.1:5201";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5201, strictPort: true, fs: { allow: [process.cwd(), await realpath("node_modules"), await realpath("node_modules/@fontsource/inter")] } },
  plugins: [{ name: "caddie-feedback-fixture", configureServer(s) {
    s.middlewares.use("/feedback-fixture", async (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(await s.transformIndexHtml("/feedback-fixture", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/artifacts.local/caddie-feedback/fixture.tsx"></script></body></html>'));
    });
  } }],
});
await server.listen();
const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROMIUM_PATH ?? "/home/shmick/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell",
  args: ["--no-sandbox"],
});
let assertions = 0;
try {
  for (const width of [320, 390, 1440]) {
    const p = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    p.on("pageerror", e => errors.push(e.message));
    await p.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await p.goto(origin + "/feedback-fixture");
    await p.getByTestId("score").waitFor();
    for (const locale of ["zh-CN", "en", "ja", "ko", "es", "zh-TW", "zh-CN"]) {
      await p.getByRole("button", { name: locale, exact: true }).click();
      for (const legacy of [false, true]) {
        if (legacy) await p.getByRole("button", { name: "Toggle legacy language" }).click();
        const text = await p.getByTestId("score").innerText();
        assert.doesNotMatch(text, /Constraints|Analysis completed successfully/); assertions++;
        assert.equal(await p.getByTestId("score").getByText(expected[locale], { exact: true }).count(), 5); assertions++;
        assert.equal(await p.getByTestId("score").getByText("12/20", { exact: true }).count(), 5); assertions++;
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assertions++;
        await p.getByRole("button", { name: "Toggle saved result" }).click();
        assert.equal(await p.getByTestId("score").count(), 0); assertions++;
        await p.getByRole("button", { name: "Toggle saved result" }).click();
        await p.getByTestId("score").waitFor();
        if (legacy) await p.getByRole("button", { name: "Toggle legacy language" }).click();
      }
    }
    await p.screenshot({ path: out + "/score-zh-CN-" + width + ".png", fullPage: true });
    assert.deepEqual(errors, []); assertions++;
    await p.close();
  }
  fs.writeFileSync(out + "/results.json", JSON.stringify({ assertions, widths: [320, 390, 1440], synthetic: true, cases: "six locales, recorded/missing language, repeated switching, close/reopen, all five reasons and unchanged points, no overflow or runtime errors" }, null, 2));
  console.log("PASS " + assertions + " synthetic score-render assertions");
} finally { await browser.close(); await server.close(); }

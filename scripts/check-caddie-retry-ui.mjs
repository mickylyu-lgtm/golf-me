import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { createServer } from "vite";
import { chromium } from "playwright-core";
const out = "artifacts.local/caddie-retry";
fs.mkdirSync(out, { recursive: true });
const source = fs.readFileSync("src/pages/CaddieAnalysisDetail.tsx", "utf8");
const section = source.slice(source.indexOf("  const autoScopeKey ="), source.indexOf("\n  // Opened cold"));
assert(section.includes("autoRequestRef.current?.id === autoId || isTranslationRunning(autoId)"));
const fixture = [
    'import { StrictMode, useEffect, useRef, useState } from "react"; import { createRoot } from "react-dom/client";',
    'import { claimAutoTranslateAttempt, needsAutoTranslate, releaseAutoTranslateAttempt } from "../../src/lib/caddieLanguage";',
    'import { isExplicitCaddieLocale, isTranslationRunning, queueAutoTranslation, whenTranslationSettled } from "../../src/lib/caddieAutoTranslate";',
    'import { translationRetryDelay } from "../../src/lib/caddieTranslationRetry";',
    'let now=1000,timerId=0;const timers=new Map(),realSet=window.setTimeout.bind(window),realClear=window.clearTimeout.bind(window);Date.now=()=>now;',
    'window.setTimeout=((fn,ms,...args)=>{if(ms>=5500){const id=1000000+(++timerId);timers.set(id,{at:now+ms,fn});return id;}return realSet(fn,ms,...args);});window.clearTimeout=((id)=>{if(timers.has(id))timers.delete(id);else realClear(id);});',
    'const qa=window.__qa={calls:[],pending:[],seconds:86400,mode:"limited",timers,props:{isDemo:false,authUser:{id:"a"},autoId:"one",autoLanguage:"en",autoSample:"Hold finish.",locale:"ja"}};',
    'const translateCaddieAnalysis=async(id,target)=>{qa.calls.push({id,target});if(qa.mode==="pending")await new Promise((resolve,reject)=>qa.pending.push({resolve,reject}));else if(qa.mode==="error")throw {status:502};else throw {status:429,code:"rate_limited",retryAfterSeconds:qa.seconds};};',
    'function Fixture(props){const {isDemo,authUser,autoId,autoLanguage,autoSample,locale}=props;const [translating,setTranslating]=useState(false);',
    section,
    'return <div data-busy={translating}>Synthetic translation lifecycle</div>;}',
    'const root=createRoot(document.getElementById("root"));qa.render=(changes={})=>{Object.assign(qa.props,changes);root.render(<StrictMode><Fixture {...qa.props}/></StrictMode>);};qa.hide=()=>root.render(null);qa.advance=(ms)=>{now+=ms;for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}};qa.render();'
].join("\n");
fs.writeFileSync(out + "/fixture.tsx", fixture);
fs.writeFileSync(out + "/index.html", '<div id="root"></div><script type="module" src="./fixture.tsx"></script>');
const server = await createServer({ server: { host: "127.0.0.1", port: 5189, strictPort: true }, logLevel: "error" });
await server.listen();
// CHROMIUM_PATH can select an existing installation. Otherwise let Playwright
// use its normal cached browser; headless-only Linux installs are supported.
const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(homedir(), ".cache", "ms-playwright");
const shells = fs.existsSync(cache) ? fs.readdirSync(cache).filter((name) => name.startsWith("chromium_headless_shell-")).sort().reverse() : [];
const cachedShell = shells.map((name) => path.join(cache, name, "chrome-headless-shell-linux64", "chrome-headless-shell")).find((file) => fs.existsSync(file));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? cachedShell, args: ["--no-sandbox"] });
const page = await browser.newPage(), errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
let assertions = 0;
const check = async (calls, timers) => { await page.waitForTimeout(30); const result = await page.evaluate(() => ({ calls: window.__qa.calls.length, timers: window.__qa.timers.size })); assert.deepEqual(result, { calls, timers }); assertions += 2; };
try {
    await page.goto("http://127.0.0.1:5189/" + out + "/index.html");
    await page.waitForFunction(() => window.__qa?.calls.length === 1);
    await check(1, 1);
    await page.evaluate(() => window.__qa.render({ autoSample: "Cooldown rerender." }));
    await check(1, 1);
    await page.evaluate(() => window.__qa.advance(86399999));
    await check(1, 1);
    await page.evaluate(() => window.__qa.advance(1));
    await check(2, 1);
    await page.evaluate(() => window.__qa.hide());
    await check(2, 0);
    await page.evaluate(() => window.__qa.render({ autoId: "two" }));
    await check(3, 1);
    await page.evaluate(() => window.__qa.hide());
    await check(3, 0);
    await page.evaluate(() => { window.__qa.mode = "pending"; window.__qa.render({ autoId: "pending", locale: "ja" }); });
    await check(4, 0);
    await page.evaluate(() => window.__qa.render({ autoSample: "Pending rerender." }));
    await check(4, 0);
    await page.evaluate(() => window.__qa.pending.shift().reject({ status: 429, retryAfterSeconds: 60 }));
    await check(4, 1);
    await page.evaluate(() => window.__qa.render({ authUser: null }));
    await check(4, 0);
    await page.evaluate(() => window.__qa.render({ authUser: { id: "b" }, autoId: "rapid", locale: "ja" }));
    await check(5, 0);
    await page.evaluate(() => window.__qa.render({ locale: "ko" }));
    await check(5, 0);
    await page.evaluate(() => window.__qa.render({ locale: "ja" }));
    await check(5, 0);
    await page.evaluate(() => window.__qa.pending.shift().reject({ status: 429, retryAfterSeconds: 86400 }));
    await check(6, 0);
    await page.evaluate(() => window.__qa.hide());
    await check(6, 0);
    await page.evaluate(() => window.__qa.pending.shift().reject({ status: 429, retryAfterSeconds: 86400 }));
    await check(6, 0);
    await page.evaluate(() => { window.__qa.mode = "error"; window.__qa.render({ autoId: "error" }); });
    await check(7, 0);
    await page.evaluate(() => window.__qa.render({ autoSample: "Error rerender." }));
    await check(7, 0);
    assert.deepEqual(errors, []);
    assertions++;
    console.log(JSON.stringify({ assertions, strictMode: true, actualPageEffect: true, externalRequests: "blocked", result: "PASS" }));
}
finally {
    await browser.close();
    await server.close();
}

// Actual React component, synthetic native events/web viewport and place service.
// This does not verify physical iOS/WKWebView keyboard integration.
import { chromium, webkit } from "playwright-core";
import { createServer } from "vite";
import { syntheticKeyboardPlugin } from "./synthetic-keyboard-plugin.mjs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
const before = process.env.LOCATION_BEFORE === "1";
const engineName = process.env.LOCATION_ENGINE || "chromium";
const engine = engineName === "webkit" ? webkit : chromium;
const port = engineName === "webkit" ? 5218 : 5217;
const base = `http://127.0.0.1:${port}`;
const out = `artifacts.local/location-picker/${before ? "before" : "after"}/${engineName}`;
fs.mkdirSync(out, { recursive: true });
const baseline = before ? execFileSync("git", ["show", "7766e56346881b7a1b98b7c8d58eb68b799acccf:src/components/location/LocationPicker.tsx"], { encoding: "utf8" }) : null;
const fixture = { name: "location-picker-fixture", enforce: "pre", transform(source, id) {
  const path = id.split("?")[0];
  if (path.endsWith("/src/components/location/LocationPicker.tsx") && before) return baseline;
  if (path.endsWith("/src/context/AuthContext.tsx")) return "export const useAuth = () => ({ isDemo: (window as any).__demo });";
  if (path.endsWith("/src/lib/realCourseSearch.ts")) return `export async function searchRealPlaces(q:string) { await new Promise(r=>setTimeout(r,120)); if(q==='error') throw new Error('Synthetic failure'); return q==='town' ? Array.from({length:20},(_,i)=>({label:'Test Town '+i,coords:{lat:30,lng:-97}})) : []; }`;
  if (path.endsWith("/src/lib/useSearchSheetLayout.ts")) return source.replace("const native = Capacitor.isNativePlatform();", "const native = (window as any).__native === true;");
}, configureServer(server) {
  server.middlewares.use("/__location", async (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml("/__location", '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/location-picker-fixture.tsx"></script></body></html>'));
  });
} };
const server = await createServer({ plugins: [syntheticKeyboardPlugin(), fixture], server: { host: "127.0.0.1", port, strictPort: true } });
await server.listen();
let browser, assertions = 0;
const errors = [], measurements = [];
const check = (value, message) => { assert.ok(value, message); assertions++; };
try {
  browser = await engine.launch({ headless: true });
  for (const [width,height,kb] of [[390,844,320],[320,568,280],[844,390,176],[1440,900,0]]) {
    if (process.env.LOCATION_WIDTH && width !== Number(process.env.LOCATION_WIDTH)) continue;
    for (const native of [true,false]) for (const reduced of [false,true]) {
      if (before && (!native || reduced)) continue;
      const label = `${width}x${height}-${native ? "native-simulation" : "web-viewport"}-${reduced ? "reduced" : "motion"}`;
      const context = await browser.newContext({ viewport: { width,height }, reducedMotion: reduced ? "reduce" : "no-preference" });
      await context.route("**/*", route => route.request().url().startsWith(base + "/") ? route.continue() : route.abort());
      await context.addInitScript(({native}) => {
        window.__native = native; window.__demo = false;
        const vv = new EventTarget(); Object.assign(vv, {height:innerHeight,width:innerWidth,offsetTop:0,scale:1});
        Object.defineProperty(window, "visualViewport", { get:()=>vv });
        window.testKeyboard = height => {
          vv.height = innerHeight - (native ? 0 : height);
          document.querySelector("#keyboard").style.cssText = height ? `position:fixed;bottom:0;left:0;right:0;z-index:100;background:#d5d8df;padding:16px;height:${height}px` : "display:none";
          if (native) window.dispatchEvent(new CustomEvent("golfme:synthetic-keyboard", {detail:{height}}));
          vv.dispatchEvent(new Event("resize"));
        };
      }, {native});
      const page = await context.newPage(); page.on("pageerror", e=>errors.push(e.message));
      await page.goto(base + "/__location");
      const opener = page.getByRole("button", {name:"Choose course location"});
      const dialog = page.getByRole("dialog");
      const search = dialog.getByRole("searchbox");
      const keyboard = h=>page.evaluate(h=>window.testKeyboard(h),h);
      // WebKit does not focus buttons on pointer click. Establish a keyboard
      // opener explicitly when asserting focus restoration on dismissal.
      const open = async()=>{await opener.focus();await opener.press("Enter");await search.waitFor();await page.waitForTimeout(350);};
      await open();
      if (!before) check(await dialog.evaluate(el=>document.activeElement===el), "opening does not automatically summon keyboard " + label);
      const resting = await search.boundingBox();
      const restingSheet = await dialog.boundingBox();
      await page.screenshot({path:`${out}/${label}-rest.png`});
      await search.click(); await keyboard(kb); await page.waitForTimeout(60);
      const mid = await dialog.boundingBox();
      await page.waitForTimeout(330);
      const focused = await search.boundingBox();
      const finalSheet = await dialog.boundingBox();
      measurements.push({label,restingY:resting.y,focusedY:focused.y,deltaY:focused.y-resting.y,midSheetHeight:mid.height});
      await page.screenshot({path:`${out}/${label}-focused.png`});
      if (before) {await context.close();continue;}
      if (native && !reduced && kb>0) check(mid.height<restingSheet.height-1 && mid.height>finalSheet.height+1,"native resize has intermediate motion " + label);
      const band = height-kb;
      check(focused.y>=0 && focused.y+focused.height<=band+1, "search above keyboard " + label);
      if (height>=800) check(Math.abs(focused.y-resting.y)<1, "stable search top " + label);
      check(await page.evaluate(()=>window.scrollY)===0, "no background pan " + label);
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), "no horizontal overflow " + label);
      const duration = await dialog.evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration));
      check(reduced || !native ? duration <= 0.001 : duration === 0.25, "motion preference " + label);
      const closeBox=await dialog.getByRole("button", {name:"Close",exact:true}).boundingBox();
      check(closeBox.y>=0 && closeBox.y+closeBox.height<=band+1, "close accessible " + label);
      const scroller=dialog.locator(":scope > div").nth(1);
      for (const query of ["Austin", "missing", "error", "town", ""]) {
        await search.fill(query);
        if (query.length>=2) {await dialog.getByText("Searching places...", {exact:true}).waitFor({state:"visible"});assertions++;}
        await page.waitForTimeout(500);
        check(Math.abs((await search.boundingBox()).y-focused.y)<1, "typing/results do not move search " + label + query);
        if(query==="error") check(await dialog.getByText("Couldn't search places right now. Pick from the list or try again.", {exact:true}).count()===1, "error remains rendered");
        if(query==="town") {
          const last=dialog.getByRole("button", {name:"Test Town 19",exact:true});
          check(await last.count()===1,"all remote results retained");
          await scroller.evaluate(el=>el.scrollTop=el.scrollHeight);
          await last.focus();
          await page.waitForTimeout(150);
          const box=await last.boundingBox(), scrollBox=await scroller.boundingBox();
          await page.screenshot({path:`${out}/${label}-results.png`});
          check(box.y>=scrollBox.y-1 && box.y+box.height<=band+1,"last result reachable above keyboard " + label + JSON.stringify({box,scrollBox,band}));
          await search.focus();
        }
      }
      await search.evaluate(el=>el.blur()); await keyboard(0); await page.waitForTimeout(350);
      check(Math.abs((await search.boundingBox()).y-resting.y)<1,"blur/dismiss restores header " + label);
      await search.focus(); await keyboard(kb); await page.waitForTimeout(350);
      await search.fill("Austin"); await page.waitForTimeout(500);
      await search.press("Tab");
      check(await page.evaluate(()=>document.activeElement?.textContent?.includes("Austin")),"Tab reaches result " + label);
      await page.keyboard.press("Enter"); await dialog.waitFor({state:"hidden"}); await keyboard(0);
      check((await page.locator("[data-picked]").textContent())==="Austin, TX","keyboard selection works");
      check(await opener.evaluate(el=>document.activeElement===el),"opener focus restored");
      for(let i=0;i<2;i++) {await open(); await search.focus();await keyboard(kb);await page.waitForTimeout(300);await search.press("Escape");await dialog.waitFor({state:"hidden"});await keyboard(0);}
      await page.evaluate(()=>window.__demo=true); await open();await search.fill("London");
      await dialog.getByRole("button",{name:/^London/}).click();await dialog.waitFor({state:"hidden"});
      check((await page.locator("[data-picked]").textContent())==="London","demo selection works");
      await open();await dialog.getByRole("button",{name:"Close",exact:true}).click();await dialog.waitFor({state:"hidden"});
      await open();await page.mouse.click(1,1);await dialog.waitFor({state:"hidden"});
      check(await page.evaluate(()=>document.body.style.overflow!=="hidden"),"scroll lock released");
      await context.close();
    }
  }
  check(errors.length===0, JSON.stringify(errors));
  fs.writeFileSync(`${out}/report.json`,JSON.stringify({before,engine:engineName,assertions,errors,measurements},null,2));
  console.log(JSON.stringify({before,engine:engineName,assertions,errors,out}));
} finally {await browser?.close();await server.close();}

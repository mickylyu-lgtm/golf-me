// Local synthetic auth only; external requests blocked. See tutorial-test-plugin.
import { chromium } from "playwright-core";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tutorialTestPlugin } from "./tutorial-test-plugin.mjs";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "synthetic-preview-only";
const base = "http://127.0.0.1:5193";
const server = await createServer({ plugins: [tutorialTestPlugin()], server: { host: "127.0.0.1", port: 5193, strictPort: true, fs: { allow: [process.cwd(), resolve(dirname(fileURLToPath(import.meta.resolve("vite/package.json"))), "../..")] } } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox"], env: { ...process.env, ...(process.env.CHROMIUM_LIB_DIR ? { LD_LIBRARY_PATH: process.env.CHROMIUM_LIB_DIR } : {}) } });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const blocked = [];
  await context.route("**/*", route => {
    if (route.request().url().startsWith(base + "/")) return route.continue();
    blocked.push(route.request().url()); return route.abort();
  });
  await context.addInitScript(() => { window.__tutorialTestInitialAuth = { isDemo: false, authUser: { id: "ordinary-account" }, onboardingTutorialCompleted: false }; });

  const page=await context.newPage();
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(base);
  await page.evaluate(async()=>{
    const {seedData}=await import("/src/lib/storage.ts");
    const data=seedData();data.session={isLoggedIn:true,hasOnboarded:true};
    data.golfers=data.golfers.map(g=>({...g,photoUrl:""}));
    localStorage.setItem("golfme:isDemo","1");
    localStorage.setItem("golfme:data:v8",JSON.stringify(data));
    localStorage.setItem("golfme:locale","en");
  });
  await page.goto(base+"/");
  const dialog=page.getByRole("dialog");
  const read=()=>page.evaluate(()=>window.__tutorialTestControls?.stepIndex);
  await dialog.getByRole("button",{name:"Next",exact:true}).waitFor();
  const seen=[];
  for(let index=0;index<6;index++){
    await page.waitForTimeout(200);
    const actual=await read();seen.push(actual);
    assert.equal(actual,index,"Tutorial went backward or restarted: "+seen.join(","));
    await dialog.getByRole("button",{name:"Next",exact:true}).click();
  }
  await dialog.getByRole("button",{name:"Start exploring",exact:false}).click();
  await dialog.waitFor({state:"hidden"});
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>window.__tutorialTestSaves.length),1,"profile completion saved once");
  assert.equal(await dialog.count(),0,"Home mount cannot reopen the finished tutorial");
  assert.deepEqual(errors,[]);
  console.log("PASS automatic onboarding moves through all seven cards and completes once");
}finally{await browser?.close();await server.close()}

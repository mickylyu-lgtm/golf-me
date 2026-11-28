// Local synthetic auth only; external requests blocked. See tutorial-test-plugin.
import { chromium } from "playwright-core";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tutorialTestPlugin } from "./tutorial-test-plugin.mjs";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "synthetic-preview-only";
const base = "http://127.0.0.1:5217";
const server = await createServer({ plugins: [tutorialTestPlugin()], server: { host: "127.0.0.1", port: 5217, strictPort: true, fs: { allow: [process.cwd(), resolve(dirname(fileURLToPath(import.meta.resolve("vite/package.json"))), "../..")] } } });
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
  await context.addInitScript(() => { window.__tutorialTestInitialAuth = { isDemo: false, authUser: { id: "ordinary-account" }, onboardingTutorialCompleted: true }; });


  const page=await context.newPage();
  await page.goto(base);
  await page.evaluate(async()=>{
    const {seedData}=await import("/src/lib/storage.ts");
    const data=seedData();data.session={isLoggedIn:true,hasOnboarded:true};
    data.golfers=data.golfers.map(g=>({...g,photoUrl:""}));
    localStorage.setItem("golfme:isDemo","1");
    localStorage.setItem("golfme:data:v8",JSON.stringify(data));
    localStorage.setItem("golfme:locale","en");
  });
  const notice=page.locator('section[aria-labelledby="whats-new-title"]');
  const expected={
    en:"Host a simulator session",es:"Organiza una sesión de simulador",ja:"シミュレーターラウンドを開催しよう",
    ko:"시뮬레이터 라운드를 열어 보세요","zh-CN":"发起模拟器球局","zh-TW":"發起模擬器球局"
  };
  const names=await page.evaluate(async()=> (await import("/src/i18n/LocaleContext.tsx")).LOCALES.map(({value,nativeName})=>[value,nativeName]));
  for(const [locale,name] of names){
    await page.goto(base+"/settings/language");
    await page.getByRole("button",{name,exact:true}).click();
    await page.waitForFunction(x=>localStorage.getItem("golfme:locale")===x,locale);
    assert.equal(await notice.count(),0,"not on Settings");
    await page.goto(base+"/");
    await notice.getByRole("heading",{name:expected[locale],exact:true}).waitFor();
    assert.equal(await notice.count(),1);
    assert.equal(await notice.getByRole("listitem").count(),2);
    assert.equal(await notice.locator("strong").count(),4);
    assert.equal(await notice.getByText("Quick Reminder",{exact:true}).count(),0);
  }
  await page.goto(base+"/settings/language");
  await page.getByRole("button",{name:"English",exact:true}).click();
  await page.waitForFunction(()=>localStorage.getItem("golfme:locale")==="en");
  await page.goto(base+"/");
  await notice.getByRole("heading",{name:expected.en}).waitFor();
  await notice.getByRole("button",{name:"Close",exact:true}).click();
  await notice.waitFor({state:"hidden"});
  await page.reload();
  await page.locator('[data-tutorial-id="nav-home"]:visible').first().waitFor();
  assert.equal(await notice.count(),0);
  console.log("PASS Settings language for all six locales, one replacement notice and dismissal across reload");
}finally{await browser?.close();await server.close()}

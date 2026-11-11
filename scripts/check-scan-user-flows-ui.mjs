// Local synthetic QA only. No accounts or backend requests.
// CHROMIUM_EXECUTABLE=... CHROMIUM_LIB_DIR=... node scripts/check-scan-user-flows-ui.mjs
import assert from "node:assert/strict";
import { realpath, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright-core";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "dummy";
if (!process.env.CHROMIUM_EXECUTABLE) throw Error("Set CHROMIUM_EXECUTABLE");
const origin = "http://127.0.0.1:5193";
const mock = resolve("scripts/scan-user-flows-context.tsx");
const server = await createServer({
  resolve: { alias: [ { find: /.*context\/AuthContext$/, replacement: mock }, { find: /.*context\/RealRoundsContext$/, replacement: mock } ] },
  server: { host: "127.0.0.1", port: 5193, strictPort: true, fs: { allow: [process.cwd(), await realpath("node_modules"), await realpath("node_modules/@fontsource/inter")] } },
  plugins: [{ name:"scan-fixture", configureServer(s) { s.middlewares.use("/scan-fixture", async (_req,res) => { res.setHeader("Content-Type","text/html"); res.end(await s.transformIndexHtml('/scan-fixture','<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/scan-user-flows-fixture.tsx"></script></body></html>')); }); } }],
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, args:["--no-sandbox"], env:{...process.env,...(process.env.CHROMIUM_LIB_DIR ? {LD_LIBRARY_PATH:process.env.CHROMIUM_LIB_DIR}: {})} });
await mkdir("artifacts.local", {recursive:true});
try {
  for (const width of [320,390,1440]) {
    const page=await browser.newPage({viewport:{width,height:844}});
    const errors=[]; page.on("pageerror",e=>{errors.push(e.message);console.error(e.message);});
    await page.route("**/*",route=>route.request().url().startsWith(origin+"/")||route.request().url().startsWith("data:")?route.continue():route.abort());
    await page.goto(origin+"/scan-fixture");
    const input=page.getByRole("textbox",{name:"Comment",exact:true});
    await input.fill("First draft");
    await page.getByRole("button",{name:"Send comment",exact:true}).click();
    assert.equal(await input.inputValue(),"First draft");
    await input.fill("Newer draft");
    await page.evaluate(()=>window.__scan.pending.shift().reject(Error("synthetic offline")));
    await page.getByTestId("result").filter({hasText:"failed"}).waitFor();
    assert.equal(await input.inputValue(),"Newer draft");
    await page.getByRole("button",{name:"Send comment",exact:true}).click();
    await input.fill("Edited while sending");
    await page.evaluate(()=>window.__scan.pending.shift().resolve());
    await page.getByTestId("result").filter({hasText:"edited"}).waitFor();
    assert.equal(await input.inputValue(),"Edited while sending");
    await page.getByRole("button",{name:"Send comment",exact:true}).click();
    await page.getByRole("button",{name:"Switch post",exact:true}).click();
    await input.fill("Other post draft");
    await page.evaluate(()=>window.__scan.pending.shift().reject(Error("late failure")));
    assert.equal(await input.inputValue(),"Other post draft");
    await page.getByRole("button",{name:"Send comment",exact:true}).click();
    await page.getByRole("button",{name:"Switch account",exact:true}).click();
    await input.fill("Other account draft");
    await page.evaluate(()=>window.__scan.pending.shift().resolve());
    assert.equal(await input.inputValue(),"Other account draft");
    await page.getByRole("button",{name:"Send comment",exact:true}).click();
    await page.evaluate(()=>window.__scan.pending.shift().resolve());
    await page.getByTestId("result").filter({hasText:"sent"}).waitFor();
    assert.equal(await input.inputValue(),"");

    await input.fill("Submitted before unmount");
    await page.getByRole("button",{name:"Send comment",exact:true}).click();
    await page.getByRole("button",{name:"Toggle composer",exact:true}).click();
    await page.evaluate(()=>window.__scan.pending.shift().resolve());
    await page.getByRole("button",{name:"Toggle composer",exact:true}).click();
    assert.equal(await input.inputValue(),"","successful unmounted submit is not restored as unsent");

    await page.getByRole("button",{name:"Edit round",exact:true}).click();
    const save=page.getByRole("button",{name:"Save",exact:true});
    assert.equal(await save.isEnabled(),true,"time-only edit retains original coordinates");
    const course=page.getByRole("combobox");
    await course.fill("Synthetic renamed course");
    assert.equal(await save.isDisabled(),true,"manual course edit cannot silently drop coordinates");
    await page.getByRole("button",{name:"Choose the course's town",exact:true}).click();
    assert.equal(await page.getByRole("dialog").count(),2);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(),1,"Escape closes only location sheet");
    assert.equal(await save.isDisabled(),true);
    await page.getByRole("button",{name:"Choose the course's town",exact:true}).click();
    await page.getByPlaceholder("Search town, neighborhood or zip...").fill("ZZ Unknown Town");
    await page.getByRole("button",{name:/Use .*ZZ Unknown Town/}).click();
    assert.equal(await page.getByRole("dialog").count(),2,"name-only area is not accepted");
    await page.getByPlaceholder("Search town, neighborhood or zip...").fill("New York");
    await page.getByRole("button",{name:/New York/}).first().click();
    assert.equal(await page.getByRole("dialog").count(),1);
    assert.equal(await save.isEnabled(),true);
    await page.screenshot({path:`artifacts.local/scan-edit-town-${width}.png`});
    await save.click();
    const saved=await page.evaluate(()=>window.__scan.saves.at(-1));
    assert.ok(Number.isFinite(saved.courseLat)&&Number.isFinite(saved.courseLng));
    assert.equal(saved.courseName,"Synthetic renamed course");
    assert.equal(await page.getByRole("dialog").count(),0);
    assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px: comment late results, account/post changes, nested town picker, coordinate-safe save`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }

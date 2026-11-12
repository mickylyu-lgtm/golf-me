import {chromium,webkit} from "playwright-core";
import {createServer} from "vite";
import {syntheticKeyboardPlugin} from "./synthetic-keyboard-plugin.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const port=5203,base="http://127.0.0.1:"+port;
const fake = {name:"course-local-test",enforce:"pre",transform(source,id) {
  if(id.split("?")[0].endsWith("/src/components/golfcall/CourseAutocomplete.tsx"))
    return source.replace("const isNative = Capacitor.isNativePlatform();","const isNative = (window as any).__native === true;");
  if(id.split("?")[0].endsWith("/src/lib/useCourseSearch.ts"))
    return `const results=Array.from({length:6},(_,i)=>({id:"course-"+i,name:["Rock Spring Golf Club","Dyker Beach Golf Course","Liberty National Golf Club","Bayonne Golf Club","Silver Lake Golf Course","Forest Park Golf Course"][i],area:"New York, New York"}));
    export const useNearbyCourses=()=>({results,loading:false,error:null,retry:()=>{}});
    export const useCourseTextSearch=(q:string)=>({results:q==="none"?[]:results,loading:q==="loading",error:q==="error"?"Synthetic failure":null,retry:()=>{}});`;
},configureServer(server) {
 server.middlewares.use("/__course",async(req,res)=>{res.setHeader("Content-Type","text/html");res.end(await server.transformIndexHtml("/__course",'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/course-search-fixture.tsx"></script></body></html>'));});
}};
const server=await createServer({plugins:[syntheticKeyboardPlugin(),fake],server:{host:"127.0.0.1",port,strictPort:true,fs:{allow:[process.cwd(),resolve(dirname(fileURLToPath(import.meta.resolve("vite/package.json"))),"../..")]}}});
await server.listen();
const engine=process.env.COURSE_ENGINE==="webkit"?webkit:chromium;
const browser=await engine.launch({headless:true,...(engine===chromium?{args:["--no-sandbox"]}:process.env.WEBKIT_EXECUTABLE?{executablePath:process.env.WEBKIT_EXECUTABLE}:{})});
const errors=[];let count=0;
const check=(v,m)=>{assert.ok(v,m);count++};
fs.mkdirSync("artifacts.local/course-search",{recursive:true});
try {
 for(const native of [true,false]) for(const [width,height,kb] of [[390,844,320],[320,667,280],[844,390,176],[1440,900,0]]) {
  const context=await browser.newContext({viewport:{width,height}});
  await context.route("**/*",r=>r.request().url().startsWith(base+"/")?r.continue():r.abort());
  await context.addInitScript(({native})=>{
    window.__native=native;
    const vv=new EventTarget();Object.assign(vv,{height:innerHeight,offsetTop:0,width:innerWidth,scale:1});
    Object.defineProperty(window,"visualViewport",{get:()=>vv});
    window.testKeyboard=(height,pan=0)=>{
      vv.height=innerHeight-(window.__native?0:height)-pan;vv.offsetTop=pan;
      document.querySelector("#keyboard").style.cssText=height?"position:fixed;bottom:0;left:0;right:0;z-index:100;background:#d5d8df;padding:20px;height:"+height+"px":"display:none";
      if(window.__native) window.dispatchEvent(new CustomEvent("golfme:synthetic-keyboard",{detail:{height}}));
      vv.dispatchEvent(new Event("resize"));
    };
  },{native});
  const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
  await page.goto(base+"/__course");
  const input=page.getByRole("combobox");
  await input.fill("golf");
  await page.evaluate(k=>window.testKeyboard(k),kb);
  await page.waitForTimeout(650);
  const band=height-kb-12;
  let ib=await input.boundingBox(),lb=await page.getByRole("listbox").boundingBox();
  check(ib.y>=(height<500?75:111) && ib.y+ib.height<=band+1,"input fits "+[native,width]);
  check(lb.height>20 && lb.y+lb.height<=band+1,"list fits "+[native,width]);
  check(await page.getByRole("option").count()===6,"six options preserved");
  const list=page.getByRole("listbox");
  await list.evaluate(el=>el.scrollTop=el.scrollHeight);
  const last=page.getByRole("option").last();
  const lastBox=await last.boundingBox();
  check(lastBox.y>=lb.y-1&&lastBox.y+lastBox.height<=band+1,"last result scrolls above keyboard");
  await page.screenshot({path:`artifacts.local/course-search/${process.env.COURSE_ENGINE||"chromium"}-${native?"native":"web"}-${width}.png`});
  await last.click();
  const afterPick = await page.evaluate(()=>window.scrollY);
  await page.waitForTimeout(230);
  check(Math.abs(await page.evaluate(()=>window.scrollY)-afterPick)<2,"delayed keyboard close does not clamp page");

  check((await page.locator("[data-picked]").textContent())==="Forest Park Golf Course","last selection preserves callback");
  await page.evaluate(()=>window.testKeyboard(0));
  await input.fill("golf");
  await page.evaluate(k=>window.testKeyboard(k),kb);
  await page.waitForTimeout(500);
  await input.press("ArrowUp");
  check(await input.getAttribute("aria-activedescendant")!==null,"keyboard navigation active");
  const active=await page.locator('[role=option][aria-selected=true]').boundingBox();
  lb=await list.boundingBox();
  check(active.y>=lb.y-1&&active.y+active.height<=lb.y+lb.height+1,"active result scrolls internally");
  await input.press("Enter");
  if(kb===0) check(await input.evaluate(el=>document.activeElement===el),"desktop selection preserves focus");
  await input.fill("golf");
  await page.evaluate(k=>window.testKeyboard(k),kb);
  await page.waitForTimeout(400);
  const before=await input.boundingBox();
  for(const q of ["none","loading","error","golf"]) {await input.fill(q);await page.waitForTimeout(80);}
  check(Math.abs((await input.boundingBox()).y-before.y)<2,"query/status changes do not jump field");
  await page.evaluate(()=>window.testKeyboard(0));
  await page.waitForTimeout(350);
  check((await list.boundingBox()).height>0,"keyboard dismissal restores results");
  // Manual page scroll resizes options without snapping the field back.
  await page.evaluate(()=>window.scrollBy(0,25));
  await page.waitForTimeout(80);
  const manualY=await page.evaluate(()=>window.scrollY);
  await input.press("Escape");
  await page.waitForTimeout(320);
  check(await page.evaluate(()=>window.scrollY)===manualY,"Escape preserves deliberate page scroll");
  await input.fill("golf");await page.waitForTimeout(350);
  // Unmount during an in-flight reveal cannot move a later screen.
  await page.evaluate(k=>{window.testKeyboard(k);window.unmountSearch();},kb);
  await page.waitForTimeout(30);
  const y=await page.evaluate(()=>window.scrollY);await page.waitForTimeout(400);
  check(await page.evaluate(()=>window.scrollY)===y,"unmount cancels scrolling");
  await context.close();
 }
 check(errors.length===0,JSON.stringify(errors));
 console.log(JSON.stringify({engine:process.env.COURSE_ENGINE||"chromium",assertions:count,errors}));
} finally {await browser.close();await server.close();}

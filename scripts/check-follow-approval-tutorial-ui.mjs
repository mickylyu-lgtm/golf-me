// Local-only synthetic regression. No accounts, credentials or backend calls.
// CHROMIUM_EXECUTABLE=/path/to/chromium [CHROMIUM_LIB_DIR=/path/to/libs] node scripts/check-follow-approval-tutorial-ui.mjs
import { tutorialTestPlugin } from "./tutorial-test-plugin.mjs";
import { chromium } from "playwright-core";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
process.env.VITE_SUPABASE_URL="http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY="synthetic-preview-only";
if (!process.env.CHROMIUM_EXECUTABLE) throw new Error("Set CHROMIUM_EXECUTABLE to an installed Chromium.");
const server=await createServer({plugins:[tutorialTestPlugin()],server:{host:"127.0.0.1",port:5191,strictPort:true,fs:{allow:[process.cwd(),resolve(dirname(fileURLToPath(import.meta.resolve("vite/package.json"))),"../..")]}}});
await server.listen();
let browser;
try {
browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox"], env:{...process.env,...(process.env.CHROMIUM_LIB_DIR ? {LD_LIBRARY_PATH:process.env.CHROMIUM_LIB_DIR}:{})} });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const outbound = [];
await context.route("**/*", route => { if (route.request().url().startsWith("http://127.0.0.1:5191/")) return route.continue(); outbound.push(route.request().url()); return route.abort(); });
const page = await context.newPage(); const errors=[];
page.on("pageerror", err => errors.push(err.message));
await page.goto("http://127.0.0.1:5191/");
await page.evaluate(async () => {
  const {seedData}=await import('/src/lib/storage.ts'); const data=seedData();
  data.session={isLoggedIn:true,hasOnboarded:true};
  const names={g1:'Jordan Lee',g11:'Alex Green',g12:'Bea Park',g2:'Cam Hill',g3:'Drew Lake',g5:'Eli River',g6:'Fran Moss'};
  data.golfers=data.golfers.map(g=>({...g,photoUrl:'',name:names[g.id]??g.name,avatarInitials:(names[g.id]??g.name).split(' ').map(x=>x[0]).join('').slice(0,2),username:g.id in names ? names[g.id].toLowerCase().replace(' ','.') : g.username}));
  data.follows=[['g1','g11'],['g1','g2'],['g11','g1'],['g12','g1'],['g2','g1'],['g2','g11'],['g3','g11']].map(([followerId,followingId],i)=>({id:'follow-'+i,followerId,followingId,createdAt:new Date().toISOString()}));
  data.blocks=[{blockerId:'g3',blockedId:'g1',createdAt:new Date().toISOString()}];
  data.privateFollowProfiles={g11:true,g12:true};
  data.followRequests=[['g5','g1'],['g6','g1']].map(([followerId,followingId],i)=>({id:'request-'+i,followerId,followingId,createdAt:new Date().toISOString()}));
  localStorage.setItem('golfme:isDemo','1'); localStorage.setItem('golfme:data:v8',JSON.stringify(data));localStorage.setItem('golfme:locale','en');
});
const base='http://127.0.0.1:5191';fs.mkdirSync('artifacts.local',{recursive:true});
const layouts=[];let lastDict;
const cases=process.env.TUTORIAL_TEXT_SCALE ? [[320,568,Number(process.env.TUTORIAL_TEXT_SCALE)]] : [[320,568,1],[390,844,1],[390,320,1],[320,568,1.5],[320,568,2]];
for(const locale of ['en','es','ja','ko','zh-CN','zh-TW']){
 await page.evaluate(locale=>localStorage.setItem('golfme:locale',locale),locale);
 await page.goto(base+'/settings');
 const dict=await page.evaluate(async locale=>Object.values(await import('/src/i18n/locales/'+locale+'.ts'))[0],locale);
 lastDict=dict;
 for(const [width,height,scale] of cases){
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/settings');await page.getByRole('button',{name:dict['settings.replayTutorial'],exact:true}).click();
  let overlay=page.getByRole('dialog');
  for(let i=0;i<5;i++)await overlay.getByRole('button',{name:dict['tutorial.next'],exact:true}).click();
  overlay=page.getByRole('dialog',{name:dict['socialPrivacy.title'],exact:true});await overlay.waitFor();await page.setViewportSize({width,height});await page.evaluate(scale=>{document.documentElement.style.fontSize=(16*scale)+'px';window.dispatchEvent(new Event('resize'));},scale);await page.waitForTimeout(1750);
  const target=page.locator('[data-tutorial-id="tutorial-follow-approval"]');assert.equal(await target.count(),1);
  const card=overlay.locator(':scope > div').last();const box=await card.boundingBox();
  layouts.push({locale,width,height,scale,box});console.log('LAYOUT',JSON.stringify(layouts.at(-1)));
  assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height,'card fully visible '+locale+' '+width);
  const backgroundWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
  if(scale===1)assert.ok(backgroundWidth<=width,'no horizontal overflow');
  else console.log('ENLARGED_BACKGROUND',JSON.stringify({locale,scale,backgroundWidth,viewportWidth:width}));
  assert.ok(await card.evaluate(e=>e.scrollWidth<=e.clientWidth),'no horizontal card clipping');
  if(scale===1 && height>=568)assert.ok(await card.evaluate(e=>e.scrollHeight<=e.clientHeight),'portrait text fits');
  for(const key of ['tutorial.next','tutorial.back','tutorial.skip']){await overlay.getByRole('button',{name:dict[key],exact:true}).scrollIntoViewIfNeeded();const b=await overlay.getByRole('button',{name:dict[key],exact:true}).boundingBox();assert.ok(b.y>=0&&b.y+b.height<=height,'button visible '+key);}
  assert.equal(await target.getByRole('switch').getAttribute('aria-checked'),'false','tutorial never changes approval');
  const targetBefore=await target.boundingBox();await card.evaluate(e=>e.scrollTop=e.scrollHeight);await card.hover();await page.mouse.wheel(0,1200);await page.waitForTimeout(100);const targetAfter=await target.boundingBox();assert.ok(Math.abs(targetAfter.y-targetBefore.y)<2,'scroll contained within card');
  await card.evaluate(e=>e.scrollTop=0);
  await page.screenshot({path:'artifacts.local/tutorial-follow-approval-'+locale+'-'+width+(scale!==1||height===320?'-'+height+'-'+scale:'')+'.png'});
  await overlay.getByRole('button',{name:dict['tutorial.back'],exact:true}).click();await page.getByRole('dialog',{name:dict['tutorial.caddie.title'],exact:true}).waitFor();
  // Other steps are intentionally unchanged; restore baseline before traversing them.
  await page.evaluate(()=>document.documentElement.style.fontSize='');await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  await page.getByRole('dialog').getByRole('button',{name:dict['tutorial.next'],exact:true}).click();await overlay.waitFor();
  await overlay.getByRole('button',{name:dict['tutorial.next'],exact:true}).click();await page.getByRole('dialog',{name:dict['tutorial.appearance.title'],exact:true}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:dict['tutorial.startExploring'],exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.evaluate(()=>document.documentElement.style.fontSize='');
 }
}
await page.goto(base+'/settings');await page.getByRole('button',{name:lastDict['settings.replayTutorial'],exact:true}).click();
for(let i=0;i<5;i++)await page.getByRole('dialog').getByRole('button',{name:lastDict['tutorial.next'],exact:true}).click();
await page.getByRole('dialog',{name:lastDict['socialPrivacy.title'],exact:true}).getByRole('button',{name:lastDict['tutorial.skip'],exact:true}).click();
await page.getByRole('dialog').waitFor({state:'hidden'});assert.ok(page.url().endsWith('/settings'));
await page.reload();assert.equal(await page.getByRole('dialog').count(),0,'replay is not forced after reload');
assert.deepEqual(errors,[]);console.log('PASS tutorial target/card/button bounds,6locales portrait/landscape/150%/200% targeted new-card text,back/next/finish/skip,no setting mutation. External blocked:',outbound.length);
}finally{await browser?.close();await server.close();}

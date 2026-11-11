// Local-only synthetic regression. No accounts, credentials or backend calls.
// CHROMIUM_EXECUTABLE=/path/to/chromium [CHROMIUM_LIB_DIR=/path/to/libs] node scripts/check-profile-followers-ui.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
process.env.VITE_SUPABASE_URL="http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY="synthetic-preview-only";
if (!process.env.CHROMIUM_EXECUTABLE) throw new Error("Set CHROMIUM_EXECUTABLE to an installed Chromium.");
const server=await createServer({server:{host:"127.0.0.1",port:5191,strictPort:true,fs:{allow:[process.cwd(),resolve(dirname(fileURLToPath(import.meta.resolve("vite/package.json"))),"../..")]}}});
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
  const names={g1:'Jordan Lee',g11:'Alex Green',g12:'Bea Park',g2:'Cam Hill',g3:'Drew Lake'};
  data.golfers=data.golfers.map(g=>({...g,photoUrl:'',name:names[g.id]??g.name,avatarInitials:(names[g.id]??g.name).split(' ').map(x=>x[0]).join('').slice(0,2),username:g.id in names ? names[g.id].toLowerCase().replace(' ','.') : g.username}));
  data.follows=[['g1','g11'],['g1','g2'],['g11','g1'],['g12','g1'],['g2','g1'],['g2','g11'],['g3','g11']].map(([followerId,followingId],i)=>({id:'follow-'+i,followerId,followingId,createdAt:new Date().toISOString()}));
  data.blocks=[{id:'block',blockerId:'g3',blockedId:'g1',createdAt:new Date().toISOString()}];
  localStorage.setItem('golfme:isDemo','1'); localStorage.setItem('golfme:data:v8',JSON.stringify(data));localStorage.setItem('golfme:locale','en');
});
await page.goto("http://127.0.0.1:5191/profile");
await page.getByRole('button',{name:'3 followers',exact:true}).waitFor();
fs.mkdirSync('artifacts.local',{recursive:true});
await page.waitForTimeout(350);await page.screenshot({path:'artifacts.local/profile-followers-mobile.png'});
await page.getByRole('button',{name:'3 followers',exact:true}).click();
const dialog=page.getByRole('dialog');
await dialog.getByText('Bea Park',{exact:true}).waitFor();
assert.equal(await dialog.locator('li').count(),3);
await page.waitForTimeout(350);await page.screenshot({path:'artifacts.local/followers-list-mobile.png'});
await dialog.getByRole('button',{name:'Mutuals 2',exact:true}).click();
assert.equal(await dialog.locator('li').count(),2);
assert.equal(await dialog.getByText('Bea Park',{exact:true}).count(),0);
await page.waitForTimeout(350);await page.screenshot({path:'artifacts.local/followers-mutuals-mobile.png'});
await dialog.getByRole('searchbox').fill('@cam');assert.equal(await dialog.locator('li').count(),1);
await dialog.getByRole('searchbox').fill('missing');await dialog.getByText('No matching followers.').waitFor();
await dialog.getByRole('searchbox').fill('');
await dialog.getByRole('button',{name:/Alex Green/}).click();
await page.waitForURL('**/golfer/g11');
await page.getByRole('button',{name:'2 followers',exact:true}).click();
await dialog.getByText('Cam Hill',{exact:true}).waitFor();
assert.equal(await dialog.locator('li').count(),2);assert.equal(await dialog.getByText('Drew Lake',{exact:true}).count(),0);
await dialog.getByRole('button',{name:'Mutuals 1',exact:true}).click();
assert.equal(await dialog.locator('li').count(),1);
await page.waitForTimeout(350);await page.screenshot({path:'artifacts.local/other-profile-mutuals-mobile.png'});
await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
await page.getByRole('button',{name:'Following',exact:true}).click();
await page.getByRole('button',{name:'Follow',exact:true}).waitFor();
await page.goto('http://127.0.0.1:5191/profile');
await page.getByRole('button',{name:'3 followers',exact:true}).click();
await dialog.getByRole('button',{name:'Mutuals 1',exact:true}).waitFor();
assert.equal(await dialog.getByText('Mutual',{exact:true}).count(),1,'unfollow refreshes mutual badges');
await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});

for(const width of [320,1440]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal overflow '+width);}
await page.setViewportSize({width:1440,height:1000});
await page.goto('http://127.0.0.1:5191/profile');
await page.getByRole('button',{name:'3 followers',exact:true}).click();await dialog.getByText('Bea Park',{exact:true}).waitFor();
await page.waitForTimeout(350);await page.screenshot({path:'artifacts.local/followers-list-desktop.png'});
assert.deepEqual(errors,[]);
console.log('PASS: own follower count; follower/mutual lists; username search; no-results state; navigation to follower; other-profile mutuals; two-way block filtering; Escape dismiss; 320/390/1440 layouts. No page errors.');
console.log('External requests blocked:',outbound.length);
} finally {await browser?.close();await server.close();}

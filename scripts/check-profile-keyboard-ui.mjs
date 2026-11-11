// Local-only synthetic regression. No accounts, credentials or backend calls.
// CHROMIUM_EXECUTABLE=/path/to/chromium [CHROMIUM_LIB_DIR=/path/to/libs] node scripts/check-profile-followers-ui.mjs
import { syntheticKeyboardPlugin } from "./synthetic-keyboard-plugin.mjs";
import { chromium } from "playwright-core";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
process.env.VITE_SUPABASE_URL="http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY="synthetic-preview-only";
if (!process.env.CHROMIUM_EXECUTABLE) throw new Error("Set CHROMIUM_EXECUTABLE to an installed Chromium.");
const server=await createServer({plugins:[syntheticKeyboardPlugin()],server:{host:"127.0.0.1",port:5191,strictPort:true,fs:{allow:[process.cwd(),resolve(dirname(fileURLToPath(import.meta.resolve("vite/package.json"))),"../..")]}}});
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
const base='http://127.0.0.1:5191';
const dialog=page.getByRole('dialog');
const keyboard=height=>page.evaluate(height=>window.dispatchEvent(new CustomEvent('golfme:synthetic-keyboard',{detail:{height}})),height);
const fit=async(height)=>{
 const box=await dialog.first().boundingBox();assert.ok(box.y>=0 && box.y+box.height<=844-height+2,'sheet above synthetic keyboard');
 const close=await dialog.first().getByRole('button',{name:'Close',exact:true}).boundingBox();assert.ok(close.y>=0 && close.y+close.height<=844-height,'Close reachable');
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden','background locked');
};
await page.goto(base+'/profile');
await page.getByRole('button',{name:'3 followers',exact:true}).click();await dialog.getByText('Bea Park',{exact:true}).waitFor();
await dialog.getByRole('searchbox').focus();await keyboard(320);await page.waitForTimeout(100);await fit(320);
await dialog.getByRole('searchbox').fill('Bea');await dialog.getByText('Bea Park',{exact:true}).waitFor();
await dialog.getByRole('button',{name:'Remove Bea Park as a follower',exact:true}).click();
await page.waitForFunction(()=>document.activeElement?.tagName!=='INPUT');
// Focus transfer dismisses the native keyboard; this is an explicit synthetic
// hide signal, not evidence that Capacitor actually delivered that signal.
await keyboard(0);await page.waitForTimeout(350);
const confirmation=page.getByRole('dialog').last();const confirmBox=await confirmation.boundingBox();assert.ok(confirmBox.y>=0 && confirmBox.y+confirmBox.height<=844);
await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
assert.equal(await dialog.count(),1,'nested confirmation dismisses alone');assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
await keyboard(0);await page.waitForTimeout(100);await fit(0);
await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'});
assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden','background restored');
// Mount while store already records an open keyboard.
await keyboard(320);await page.getByRole('button',{name:'3 followers',exact:true}).click();await dialog.getByText('Bea Park',{exact:true}).waitFor();await fit(320);
await dialog.getByRole('button',{name:'Close',exact:true}).click();await keyboard(0);
// Large list exercises scrolling restoration, Load more and row navigation.
await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('golfme:data:v8'));const template=d.golfers.find(g=>g.id==='g2');const added=Array.from({length:65},(_,i)=>({...template,id:'key-'+String(i).padStart(3,'0'),name:'Keyboard '+i,username:'keyboard'+i,photoUrl:''}));d.golfers.push(...added);d.follows=added.map((g,i)=>({id:'key-follow-'+i,followerId:g.id,followingId:'g11',createdAt:'2026-01-01T00:00:00Z'}));localStorage.setItem('golfme:data:v8',JSON.stringify(d));});
await page.goto(base+'/golfer/g11');await page.getByRole('button',{name:'65 followers',exact:true}).click();await dialog.getByText('Keyboard 0',{exact:true}).waitFor();
const scroller=dialog.locator(':scope > div').nth(1);
await scroller.evaluate(el=>el.scrollTop=120);const before=await scroller.evaluate(el=>el.scrollTop);
await keyboard(320);await page.waitForTimeout(100);await fit(320);
await dialog.getByRole('button',{name:'Load more',exact:true}).scrollIntoViewIfNeeded();
const more=await dialog.getByRole('button',{name:'Load more',exact:true}).boundingBox();assert.ok(more.y>=0 && more.y+more.height<=524,'load more reachable above keyboard');
await dialog.getByRole('button',{name:'Load more',exact:true}).click();await dialog.getByText('Keyboard 59',{exact:true}).waitFor();
await keyboard(0);await page.waitForTimeout(100);assert.ok(Math.abs(await scroller.evaluate(el=>el.scrollTop)-before)<2,'prekeyboard list scroll restored');
for(const width of [320,390]){await page.setViewportSize({width,height:844});await keyboard(300);await page.waitForTimeout(100);await fit(300);assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await keyboard(0);}
await dialog.getByRole('searchbox').fill('keyboard64');await keyboard(320);await dialog.getByText('Keyboard 64',{exact:true}).waitFor();await fit(320);
await dialog.getByRole('button',{name:/Keyboard 64 @keyboard64/}).click();await page.waitForURL('**/golfer/key-064');await keyboard(0);assert.equal(await dialog.count(),0);assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');
await page.goBack();await page.getByRole('button',{name:'65 followers',exact:true}).click();await dialog.getByRole('searchbox').waitFor();await dialog.getByRole('button',{name:'Close',exact:true}).click();assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');
assert.deepEqual(errors,[]);console.log('PASS synthetic keyboard source:show/hide,mount-open,search/load-more/Close,nested confirm,scroll lock/restoration,reopen,navigation,320/390. NOT actual Capacitor integration.');
console.log('External requests blocked:',outbound.length);
}finally{await browser?.close();await server.close();}

// Synthetic actual-app reproduction + production-hook regression; no backend.
// BEFORE=1 reproduces main's behavior without modifying the worktree.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.VITE_SUPABASE_URL='http://127.0.0.1:9';
process.env.VITE_SUPABASE_ANON_KEY='synthetic-only';
const before=process.env.BEFORE==='1';
const base='http://127.0.0.1:5199';
const out='artifacts.local/follower-count'; fs.mkdirSync(out,{recursive:true});
const plugin={name:'delayed-synthetic-count',enforce:'pre',transform(source,id){
 if(id.split('?')[0].endsWith('/src/context/DataContext.tsx')){
  const target='const getConnectionSummary = useCallback(async (id: string, kind: ConnectionKind) => auth.isDemo';
  assert.ok(source.includes(target));
  return source.replace(target,'const getConnectionSummary = useCallback(async (id: string, kind: ConnectionKind) => (await new Promise(resolve => setTimeout(resolve, 1200)), auth.isDemo)');
 }
 if(before && id.split('?')[0].endsWith('/src/components/profile/ProfileFollowers.tsx')) return source.replace('useSocialRead(read, permitted, true)','useSocialRead(read, permitted)');
}};
const server=await createServer({plugins:[plugin],server:{host:'127.0.0.1',port:5199,strictPort:true,fs:{allow:[process.cwd(),resolve(dirname(fileURLToPath(import.meta.resolve('vite/package.json'))),'../..')]}}});
await server.listen(); let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);
 await page.evaluate(async()=>{
  const {seedData}=await import('/src/lib/storage.ts');const d=seedData();d.session={isLoggedIn:true,hasOnboarded:true};
  d.golfers=d.golfers.map(g=>({...g,photoUrl:''}));
  const people=Array.from({length:17},(_,i)=>({...d.golfers[1],id:'fixture-'+i,name:'Demo Golfer '+(i+1),photoUrl:''}));d.golfers.push(...people);
  d.follows=people.map((g,i)=>({id:'in-'+i,followerId:g.id,followingId:'g1',createdAt:'2026-01-01'}));
  d.follows.push(...people.slice(0,2).map((g,i)=>({id:'out-'+i,followerId:'g1',followingId:g.id,createdAt:'2026-01-01'})));
  d.blocks=[];d.followRequests=[];
  localStorage.setItem('golfme:isDemo','1');localStorage.setItem('golfme:data:v8',JSON.stringify(d));localStorage.setItem('golfme:locale','en');
 });
 await page.goto(base+'/profile');
 const count=page.getByRole('button',{name:'17 followers',exact:true});await count.waitFor();
 // Label artifacts visibly so they cannot be mistaken for device/live evidence.
 await page.evaluate(()=>{const e=document.createElement('div');e.textContent='SYNTHETIC · Chromium 390px · delayed refresh';e.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#102b22;color:white;font:11px sans-serif;padding:3px;text-align:center;z-index:99999';document.body.appendChild(e);});
 for(let i=1;i<=2;i++){
  await count.click();const dialog=page.getByRole('dialog').first();await dialog.getByRole('button',{name:'Followers 17',exact:true}).waitFor();
  if(i===1) await page.screenshot({path:out+'/'+(before?'before':'after')+'-connections.png'});
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'});
  const counter=page.getByTestId('own-profile-stats-grid').getByRole('button',{name:/followers/});
  assert.equal(await counter.locator('strong').textContent(),before?'–':'17','count immediately after close '+i);
  await page.screenshot({path:out+'/'+(before?'before':'after')+'-dismiss-'+i+'.png'});
  await count.waitFor();
 }
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 const stat=page.getByTestId('own-profile-stats-grid').getByRole('button',{name:/followers/});
 assert.equal(await stat.locator('strong').textContent(),before?'–':'17','focus refresh');await count.waitFor();
 if(!before){
  await page.goto(base+'/');
  await page.evaluate(async()=>{document.getElementById('root')?.remove();const {mountFixture}=await import('/scripts/social-privacy-read-fixture.tsx');window.fixture=mountFixture(true);});
  const state=page.getByTestId('read-state');
  const pending=n=>page.waitForFunction(n=>window.fixture.pendingCount()===n,n);
  const finish=(i,v)=>page.evaluate(([i,v])=>window.fixture.resolve(i,[v]),[i,v]);
  const expect=v=>state.getByText(v,{exact:true}).waitFor();
  const click=name=>page.getByRole('button',{name,exact:true}).click();
  await pending(1);await finish(0,'17');await expect('17');
  await click('Retry');await pending(2);await expect('17');
  await click('Retry');await pending(3);await finish(2,'16');await expect('16');await finish(1,'99');await expect('16');
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await pending(4);await expect('16');await finish(3,'0');await expect('0');
  await click('Switch viewer');await pending(5);await expect('loading');
  await click('Switch viewer');await pending(6);await finish(4,'stale-viewer');await expect('loading');await finish(5,'new-a');await expect('new-a');
  await click('Retry');await pending(7);await click('Toggle access');await expect('private');await click('Toggle access');await pending(8);await expect('loading');await finish(6,'revoked');await expect('loading');
  await page.evaluate(()=>window.fixture.reject(7));await expect('error');await click('Retry');await pending(9);await finish(8,'recovered');await expect('recovered');
  await click('Retry');await pending(10);await expect('recovered');await page.evaluate(()=>window.fixture.reject(9));await expect('error');
  await click('Retry');await pending(11);await page.evaluate(()=>window.fixture.unmount());await finish(10,'unmounted');
 }
 assert.deepEqual(errors,[]);
 console.log('PASS '+(before?'before reproduction':'fixed dismissal twice, focus/visibility refresh, changed/zero counts, overlapping responses, viewer switch, revoke/re-grant, errors/recovery, unmount')+'; artifacts: '+out);
}finally{await browser?.close();await server.close();}

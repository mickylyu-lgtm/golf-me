// Real Home/PostCard UI with synthetic context. No live data or external requests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
process.env.VITE_SUPABASE_URL='http://127.0.0.1:9';
process.env.VITE_SUPABASE_ANON_KEY='dummy';
const before=process.env.QA_BASELINE === '1';
const version=before?'before':'after';
const base='0e8ce6adf0c1374c089732e25f6493a5469b0642';
const original=before?execFileSync('git',['show',base+':src/pages/Home.tsx'],{encoding:'utf8'}):null;
const oldEnglish=before?execFileSync('git',['show',base+':src/i18n/locales/en.ts'],{encoding:'utf8'}):null;
const origin='http://127.0.0.1:5199';
const mock=resolve('scripts/round-preview-context.tsx');
const server=await createServer({
 cacheDir:'.vite-home.local',
 resolve:{alias:[{find:/.*context\/(AuthContext|DataContext|ModerationContext|RealCommunityContext|TutorialContext|FirstRoundPromptContext)$/,replacement:mock},{find:/.*lib\/useFollowingFeed$/,replacement:mock}]},
 server:{host:'127.0.0.1',port:5199,strictPort:true,fs:{allow:[process.cwd(),await realpath('node_modules')]}},
 plugins:[{name:'home-baseline',enforce:'pre',transform(source,id){if(original&&id.split('?')[0].endsWith('/src/pages/Home.tsx'))return original;if(oldEnglish&&id.split('?')[0].endsWith('/src/i18n/locales/en.ts'))return oldEnglish;}},{name:'home-fixture',configureServer(s){s.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/home?'))return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/round-preview-fixture.tsx"></script></body></html>'));});}}]
});
await server.listen();
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE || '/home/shmick/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox']});
 await mkdir('artifacts.local',{recursive:true});
 for(const width of [390,1100]){
  const page=await browser.newPage({viewport:{width,height:950}});
  let failPhoto=false,failAerial=false;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const url=r.request().url();if((failPhoto&&url.endsWith('/skyway-round-photo.webp'))||(failAerial&&url.endsWith('/skyway-aerial.jpg')))return r.abort();return url.startsWith(origin+'/')||url.startsWith('data:')?r.continue():r.abort();});
  async function open(scenario){await page.goto(origin+'/home?scenario='+scenario+'&version=Round-card-preview');await page.locator('#home-rounds-strip').waitFor();}
  await open('mixed');
  const card=page.locator('article').first();
  await card.getByText('Skyway Golf Course',{exact:true}).waitFor();
  assert.ok((await card.innerText()).includes('Booking status not provided'));
  assert.ok((await card.innerText()).includes('1:30 PM'));
  assert.ok((await card.innerText()).includes('Jersey City, NJ'));
  assert.ok((await card.innerText()).includes('~$49'));
  assert.ok((await card.innerText()).includes('hosted by Jamie Lee'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('article img').evaluateAll(async imgs => { await Promise.all(imgs.map(img => img.decode().catch(() => {}))); });
  await page.screenshot({path:'artifacts.local/home-round-preview-'+width+'.png',fullPage:false});
  assert.equal(await card.getByRole('link',{name:'CC BY-SA 4.0',exact:true}).getAttribute('href'),'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.ok((await card.locator('img').getAttribute('src')).endsWith('skyway-round-photo.webp'));
  await card.getByRole('button').click();assert.ok(page.url().endsWith('/golf-calls/preview-round'));
  failPhoto=true;await open('mixed');await card.locator('img[src="/courses/skyway-aerial.jpg"]').waitFor();assert.ok((await card.innerText()).includes('Aerial: USGS'));assert.equal(await card.getByRole('link').count(),0);
  failAerial=true;await open('mixed');await card.getByRole('img',{name:'Golf course illustration',includeHidden:true}).waitFor();assert.equal(await card.locator('img').count(),0);failPhoto=false;failAerial=false;
  await open('fallback');
  assert.equal(await card.locator('img').count(),0);
  assert.ok((await card.innerText()).includes('Without A Verified Photo'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await open('booked');assert.ok((await card.innerText()).includes('Booked · Host reported'));
  assert.ok(!(await card.innerText()).includes('Booking status not provided'));
  await open('missing');assert.ok(!(await card.innerText()).includes('hosted by'));
  await open('empty');assert.equal(await page.locator('article').count(),0);assert.equal(await page.getByText('No rounds yet',{exact:true}).count(),1);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS actual Home/card 390 and 1100: navigation, overflow, booking truth, empty/missing profiles and image fallback');
}finally{await browser?.close();await server.close();}

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
const origin='http://127.0.0.1:5197';
const mock=resolve('scripts/home-community-context.tsx');
const server=await createServer({
 cacheDir:'.vite-home.local',
 resolve:{alias:[{find:/.*context\/(AuthContext|DataContext|ModerationContext|RealCommunityContext|TutorialContext|FirstRoundPromptContext)$/,replacement:mock},{find:/.*lib\/useFollowingFeed$/,replacement:mock}]},
 server:{host:'127.0.0.1',port:5197,strictPort:true,fs:{allow:[process.cwd(),await realpath('node_modules')]}},
 plugins:[{name:'home-baseline',enforce:'pre',transform(source,id){if(original&&id.split('?')[0].endsWith('/src/pages/Home.tsx'))return original;if(oldEnglish&&id.split('?')[0].endsWith('/src/i18n/locales/en.ts'))return oldEnglish;}},{name:'home-fixture',configureServer(s){s.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/home?'))return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/home-community-fixture.tsx"></script></body></html>'));});}}]
});
await server.listen();
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 await mkdir('artifacts.local',{recursive:true});
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin+'/')||r.request().url().startsWith('data:')?r.continue():r.abort());
  async function open(scenario){await page.goto(origin+'/home?scenario='+scenario+'&version='+version);await page.locator('#home-feed').waitFor();}
  await open('mixed');
  await page.getByText('Older followed post',{exact:false}).waitFor();
  const newest=page.getByText('Newest community post',{exact:false});
  assert.equal(await newest.count(),before?0:1);
  await page.screenshot({path:`artifacts.local/home-community-${version}-${width}.png`,fullPage:true});
  if(!before){
   const text=await page.locator('main').innerText();assert.ok(text.indexOf('Newest community post')<text.indexOf('Older followed post'));
   await open('zero');await page.getByText('Newest community post',{exact:false}).waitFor();assert.equal(await page.getByText('Your feed is quiet',{exact:true}).count(),0);
   await open('large');
   // Wait for a first layout; observer may prefetch one chunk, never the whole list.
   await page.getByText('Newest community post',{exact:false}).waitFor();
   let count=await page.locator('main').getByText(/Community practice update/).count();assert.ok(count<30, 'large feed is bounded initially: '+count);
   for(let i=0;i<25;i++){await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(120);}
   assert.equal(await page.getByText(/Community practice update/).count(),118);
   await page.getByRole('button',{name:'See all posts in Community',exact:true}).waitFor();
   await open('server');
   await page.getByText('Newest community post',{exact:false}).waitFor();
   for(let i=0;i<6;i++){await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(120);}
   await page.getByText('Second paged followed post',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.__serverPages),1);
   assert.equal(await page.getByText('First paged followed post',{exact:true}).count(),1);
   assert.equal(await page.getByText('Hidden paged post',{exact:true}).count(),0);
   assert.equal(await page.getByText('Removed paged post',{exact:true}).count(),0);
   await open('empty');await page.getByText('Your feed is quiet',{exact:true}).waitFor();
   await open('loading');assert.equal(await page.getByText('Your feed is quiet',{exact:true}).count(),0);
   await open('error');assert.equal(await page.getByText('Your feed is quiet',{exact:true}).count(),0);await page.getByRole('button',{name:/retry|try again/i}).click();assert.equal(await page.evaluate(()=>window.__retried),true);
   await open('stale');await page.getByText('Newest community post',{exact:false}).waitFor();await page.getByRole('button',{name:/retry|try again/i}).waitFor();
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS '+version+': real Home screenshots at 390/1440; '+(before?'following-only baseline reproduced':'mixed/zero-follow/120-post incremental/server-pagination/safety/load/error/empty/stale browser checks'));
}finally{await browser?.close();await server.close();}

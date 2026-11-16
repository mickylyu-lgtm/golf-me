// Real provider, Supabase client, Home and PostDetail; synthetic REST transport only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir,realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
process.env.VITE_SUPABASE_URL='http://127.0.0.1:9';process.env.VITE_SUPABASE_ANON_KEY='dummy';
const before=process.env.QA_BASELINE==='1',version=before?'before':'after',origin='http://127.0.0.1:5196';
const oldHome=before?execFileSync('git',['show','0b190d9:src/pages/Home.tsx'],{encoding:'utf8'}):null;
const oldEnglish=before?execFileSync('git',['show','0b190d9:src/i18n/locales/en.ts'],{encoding:'utf8'}):null;
const mock=resolve('scripts/home-pagination-context.tsx');
const server=await createServer({cacheDir:'.vite-pagination.local',resolve:{alias:[{find:/.*\/(AuthContext|DataContext|ModerationContext|TutorialContext|FirstRoundPromptContext)$/,replacement:mock},{find:/.*lib\/useFollowingFeed$/,replacement:mock}]},server:{host:'127.0.0.1',port:5196,strictPort:true,fs:{allow:[process.cwd(),await realpath('node_modules')]}},plugins:[{name:'baseline',enforce:'pre',transform(s,id){if(oldHome&&id.split('?')[0].endsWith('/src/pages/Home.tsx'))return oldHome;if(oldEnglish&&id.split('?')[0].endsWith('/src/i18n/locales/en.ts'))return oldEnglish;}},{name:'fixture',configureServer(s){s.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/home?')&&!req.url?.startsWith('/community/'))return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/home-pagination-fixture.tsx"></script></body></html>'));});}}]});
await server.listen();let browser;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.CHROMIUM_EXECUTABLE});await mkdir('artifacts.local',{recursive:true});
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];await page.routeWebSocket('ws://127.0.0.1:9/**',ws=>ws.close());page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
  let posts=Array.from({length:85},(_,i)=>({id:id(1000-i),author_id:id(i===1?8888:9000+i),type:'text',text:i===0?'Newest community post from a golfer you do not follow':i===1?'Older followed post':`Older community post ${i}`,category:'general',created_at:new Date(Date.UTC(2026,10,16)-i*3600000).toISOString(),swing_analysis_status:'not_applicable'}));
  const hidden=posts.slice(30,50).map(p=>({owner_id:id(9999),post_id:p.id}));
  const tables={community_post_media:[],community_comments:[{id:id(2),post_id:id(925),author_id:id(9075),text:'Hydrated older reply',created_at:'2026-11-15T01:00:00Z',parent_comment_id:null}],community_post_votes:[{post_id:id(925),voter_id:id(9999)}],community_comment_votes:[],saved_posts:[],hidden_posts:hidden};
  let olderReads=0,failPage=false,hideWrites=0;const saveOrder=[];
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin===origin||url.protocol==='data:')return route.continue();
   if(url.origin!=='http://127.0.0.1:9')return route.abort();
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS'}});
   const table=url.pathname.split('/').pop();let rows=[];
   if(table==='golfer_public_profiles'){const body=route.request().postDataJSON();rows=body.p_ids.map(n=>({id:n,name:n===id(8888)?'Followed Golfer':`Community Golfer ${Number(n.slice(-4))-9000}`,avatar_initials:'CG',avatar_color:'#285c45',has_onboarded:true}));}
   else if(table==='community_feed_version')return route.fulfill({status:404,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({code:'PGRST205',message:'synthetic signal unavailable'})});
   else {
    if(route.request().method()==='POST'&&!tables[table])return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'null'});
    if(route.request().method()==='DELETE'){saveOrder.push('delete');const owner=url.searchParams.get('owner_id')?.slice(3),post=url.searchParams.get('post_id')?.slice(3);tables[table]=tables[table].filter(r=>!(r.owner_id===owner&&r.post_id===post));return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*'}});}
    if(route.request().method()==='POST'){if(table==='hidden_posts')hideWrites++;if(table==='saved_posts'){saveOrder.push('insert-start');await new Promise(r=>setTimeout(r,150));saveOrder.push('insert-end');}tables[table].push(route.request().postDataJSON());return route.fulfill({status:201,headers:{'Access-Control-Allow-Origin':'*'},body:''});}
    rows=table==='community_posts'?[...posts]:[...(tables[table]??[])];
    for(const [key,value]of url.searchParams){if(value.startsWith('in.(')){const values=value.slice(4,-1).split(',');rows=rows.filter(r=>values.includes(String(r[key])));}if(value.startsWith('eq.'))rows=rows.filter(r=>String(r[key])===value.slice(3));}
    const or=url.searchParams.get('or');if(or){olderReads++;if(failPage)return route.fulfill({status:400,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({code:'XX000',message:'synthetic page failure'})});const m=or.match(/created_at.lt.([^,]+),and\(created_at.eq.[^,]+,id.lt.([^)]*)/);rows=rows.filter(r=>r.created_at<m[1]||(r.created_at===m[1]&&r.id<m[2]));}
    const order=(url.searchParams.get('order')??'').split(',').filter(Boolean);rows.sort((a,b)=>{for(const o of order){const[k,d]=o.split('.');const cmp=String(a[k]).localeCompare(String(b[k]));if(cmp)return d==='desc'?-cmp:cmp;}return 0;});
    const offset=Number(url.searchParams.get('offset')??0),limit=Math.min(Number(url.searchParams.get('limit')??30),table==='community_posts'?30:11);rows=rows.slice(offset,offset+limit);
   }
   return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(rows)});
  });
  await page.goto(origin+'/home?version='+version);await page.getByText('Older followed post',{exact:true}).waitFor();
  assert.equal(await page.getByText('Newest community post from a golfer you do not follow',{exact:true}).count(),before?0:1);
  await page.screenshot({path:`artifacts.local/community-pagination-${version}-${width}.png`});
  if(!before){
   assert.ok(await page.getByText(/Older community post/).count()<20);
   for(let i=0;i<35;i++){await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(130);}
   await page.getByText('Older community post 84',{exact:true}).waitFor();assert.ok(olderReads>=4);assert.equal(await page.getByText('Older community post 35',{exact:true}).count(),0);
   assert.equal(await page.evaluate(()=>window.__community.posts.length),85);
   await page.evaluate(()=>Promise.all([window.__community.hidePost('00000000-0000-4000-8000-000000000940'),window.__community.hidePost('00000000-0000-4000-8000-000000000940')]));
   assert.equal(hideWrites,1);assert.equal(await page.getByText('Older community post 60',{exact:true}).count(),0);
   await page.evaluate(()=>Promise.all([window.__community.savePost('00000000-0000-4000-8000-000000000924'),window.__community.unsavePost('00000000-0000-4000-8000-000000000924')]));
   assert.deepEqual(saveOrder,['insert-start','insert-end','delete']);assert.equal(await page.evaluate(()=>window.__community.isPostSaved('00000000-0000-4000-8000-000000000924')),false);

   await page.getByText('Older community post 75',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts.local/community-pagination-older-${width}.png`});
   await page.getByText('Older community post 75',{exact:true}).click();await page.getByText('Hydrated older reply',{exact:true}).waitFor();assert.equal(await page.getByText('Community Golfer 75',{exact:true}).count()>0,true);
   // Refresh a retained older page: removed rows disappear; loaded range persists.
   posts=posts.filter(p=>p.id!==id(925));await page.evaluate(()=>window.__community.retry());assert.equal(await page.evaluate(()=>window.__community.getPost('00000000-0000-4000-8000-000000000925')),undefined);
   assert.equal(await page.evaluate(()=>window.__community.posts.length),84);
   // All initial and next-page rows hidden: sentinel must continue without a card.
   tables.hidden_posts.push(...posts.slice(0,30).map(p=>({owner_id:id(9999),post_id:p.id})));
   await page.goto(origin+'/home?version='+version);
   await page.getByText('Older community post 50',{exact:true}).waitFor();
   assert.equal(await page.getByText('Your feed is quiet',{exact:true}).count(),0);
   // A later page error is retryable and cannot auto-spin requests.
   failPage=true;
   await page.evaluate(()=>window.__community.loadOlderPosts());
   await page.getByRole('button',{name:/retry|try again/i}).waitFor();
   const failedReads=olderReads;await page.waitForTimeout(250);assert.equal(olderReads,failedReads);
   failPage=false;await page.getByRole('button',{name:/retry|try again/i}).click();
   await page.waitForFunction(()=>!window.__community.pageError&&!window.__community.isPaging);

  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS '+version+': actual provider, Home and older PostDetail; capped transport, hidden-page traversal, hydration, refresh removal, phone/desktop screenshots');
}finally{await browser?.close();await server.close();}

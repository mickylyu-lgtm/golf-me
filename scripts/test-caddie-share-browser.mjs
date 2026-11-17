// Browser integration with mocked Supabase (no production requests/writes).
// Run after dummy-env build and local Vite preview on 127.0.0.1:4178.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || "/usr/bin/chromium",headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}});
const owner='00000000-0000-0000-0000-000000000010', id='00000000-0000-0000-0000-000000000001';
const user={id:owner,aud:'authenticated',role:'authenticated',email:'fixture@example.invalid',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()};
const profile={id:owner,name:'Fixture Golfer',username:'fixture',bio:'',has_onboarded:true,onboarding_tutorial_completed:true,language:'en',favorite_courses:[],vibes:[],availability:[],preferred_courses:[],push_enabled:false};
const analysis={id,owner_id:owner,source_type:'direct_upload',source_media_url:'',source_media_path:owner+'/fixture.mp4',thumbnail_url:null,swing_type:'Driver',status:'complete',shared_to_community:false,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),strengths:[],issues:[],recommendations:[],drills:[],analysis_json:{summary:'Fixture swing',language:'en',strengths:['Balanced finish'],work_on:[{issue:'Keep posture',why_it_matters:'Consistency',confidence:'medium'}],focus:{title:'Balance',instruction:'Hold finish'},drill:{name:'Finish drill',steps:['Hold finish']},limitations:[]}};
let outcome='created', calls=[];
await page.addInitScript(({user})=>localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user})),{user});
await page.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.origin==='http://127.0.0.1:4178') return route.continue();
 if(url.origin!=='http://127.0.0.1:9') return route.abort();
 let data=[];
 if(url.pathname==='/auth/v1/user') data=user;
 else if(url.pathname==='/rest/v1/profiles') data=profile;
 else if(url.pathname==='/rest/v1/caddie_analyses') data=route.request().headers()['accept']?.includes('object') ? analysis : [analysis];
 else if(url.pathname==='/rest/v1/rpc/share_caddie_feedback') {
  const args=route.request().postDataJSON(); calls.push(args);
  if(outcome==='legacy'&&!args.p_confirm_legacy) return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Previous feedback share cannot be verified.',hint:'caddie_legacy_share_confirmation',code:'P0001'})});
  data={post_id:outcome==='unavailable'?null:'00000000-0000-0000-0000-000000000030',outcome:outcome==='legacy'?'created':outcome};
  if(data.outcome==='created') analysis.shared_to_community=true;
 }
 else if(url.pathname.startsWith('/storage/')) data={signedURL:'/storage/v1/object/sign/caddie-media/fixture.mp4'};
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
try {
 await page.goto('http://127.0.0.1:4178/caddie/'+id);
 await page.getByRole('button',{name:'Share Caddie Feedback',exact:true}).waitFor({timeout:30000});
 await page.getByRole('button',{name:'Share Caddie Feedback',exact:true}).click();
 await page.getByText('Shared to Community',{exact:true}).waitFor();
 assert.equal(calls.length,1);
 await page.getByRole('button',{name:'Share Caddie Feedback',exact:true}).waitFor();
 outcome='existing';
 await page.getByRole('button',{name:'Share Caddie Feedback',exact:true}).click();
 await page.getByText('Your feedback is already shared. No new post was created.',{exact:true}).waitFor();
 outcome='unavailable';
 await page.getByRole('button',{name:'Share Caddie Feedback',exact:true}).click();
 await page.getByText('This feedback post is unavailable. It cannot be shared again.',{exact:true}).waitFor();
 const beforeCancel=calls.length; outcome='legacy'; page.once('dialog',dialog=>dialog.dismiss());
 await page.getByRole('button',{name:'Share Caddie Feedback',exact:true}).click();
 await page.waitForTimeout(250); const cancelledCalls=calls.length; assert.equal(cancelledCalls,beforeCancel+1);
 await page.waitForFunction(()=>![...document.querySelectorAll('p')].some(e=>e.textContent==='Shared to Community')); page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Share Caddie Feedback',exact:true}).click();
 await page.getByText('Shared to Community',{exact:true}).waitFor();
 assert.equal(calls.length,cancelledCalls+2); assert.equal(calls.at(-1).p_confirm_legacy,true);
 // Simulate a deletion/refetch while mounted: the enabled stale-shared button
 // must still call the RPC, allowing its authoritative created response.
 await page.waitForFunction(()=>![...document.querySelectorAll('p')].some(e=>e.textContent==='Shared to Community')); const beforeReshare=calls.length; outcome='created'; analysis.shared_to_community=false;
 await page.getByRole('button',{name:'Share Caddie Feedback',exact:true}).click();
 await page.getByText('Shared to Community',{exact:true}).waitFor();
 assert.equal(calls.length,beforeReshare+1); await page.screenshot({path:'reshare-success.png',fullPage:true}); await page.getByRole('button',{name:'Share swing video',exact:true}).click();
 await page.waitForURL('**/community/new');
 assert.match(page.url(),/community\/new$/);
 console.log('PASS: created/existing/moderated UI, legacy cancel+confirm, stale shared re-share, separate video composer handoff');
 console.log('LIMIT: mocked API/session; not full Supabase auth/storage/realtime end-to-end.');
} catch(error) { console.log(await page.locator('body').innerText()); throw error; }
finally {await browser.close();}

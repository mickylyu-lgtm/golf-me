
// Local-only synthetic browser regression. Never signs into an account or contacts a backend.
// CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/check-message-edit-ui.mjs
// Optionally set CHROMIUM_LIB_DIR when the local browser needs a private runtime library directory.
import { mkdir, realpath } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
process.env.VITE_SUPABASE_URL='http://127.0.0.1:9';
process.env.VITE_SUPABASE_ANON_KEY='dummy';
const executablePath=process.env.CHROMIUM_EXECUTABLE;
if (!executablePath) throw new Error('Set CHROMIUM_EXECUTABLE to your installed Chromium executable.');
await mkdir('artifacts.local',{recursive:true});
const server = await createServer({server:{host:'127.0.0.1',port:5189,strictPort:true,fs:{allow:[process.cwd(),await realpath('node_modules')]}}});
await server.listen();
const browser = await chromium.launch({executablePath,headless:true,args:['--no-sandbox'],env:{...process.env,...(process.env.CHROMIUM_LIB_DIR?{LD_LIBRARY_PATH:process.env.CHROMIUM_LIB_DIR}:{})}});
const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:5189/') || route.request().url().startsWith('data:') ? route.continue():route.abort());
try {
  await page.goto('http://127.0.0.1:5189');
  const seed=await page.evaluate(async()=>{
    const {seedData}=await import('/src/lib/storage.ts');
    const data=seedData();
    const {dmConversationId}=await import('/src/lib/dm.ts');
    data.session={isLoggedIn:true,hasOnboarded:true};
    const me=data.currentUserId;
    const other=data.golfers.find(g=>g.id!==me);
    data.golfers=data.golfers.map(g=>({...g,photoUrl:'',name:g.id===me?'Demo Golfer':g.id===other.id?'Alex Green':g.name}));
    data.follows=[{followerId:me,followedId:other.id,createdAt:new Date().toISOString()},{followerId:other.id,followedId:me,createdAt:new Date().toISOString()}];
    data.directMessages=[
      {id:'old',senderId:me,receiverId:other.id,text:'Old message',createdAt:new Date(Date.now()-360000).toISOString()},
      {id:'incoming',senderId:other.id,receiverId:me,text:'See you at the first tee!',createdAt:new Date().toISOString()},
      {id:'edit-me',senderId:me,receiverId:other.id,text:'See you at 9',createdAt:new Date().toISOString()},
    ];
    data.directMessages=data.directMessages.map(m=>({...m,conversationId:dmConversationId(me,other.id)}));
    const round=data.golfCalls.find(g=>g.joinedGolferIds.includes(me));
    round.status='open';round.dateISO=new Date(Date.now()+86400000).toISOString();round.joinedGolferIds=[me,other.id];
    data.messages=[{id:'round-edit',senderId:me,golfCallId:round.id,text:'Meet by the clubhouse',createdAt:new Date().toISOString()}];
    localStorage.setItem('golfme:isDemo','1');localStorage.setItem('golfme:data:v8',JSON.stringify(data));
    return {me,other:other.id,round:round.id};
  });
  await page.goto('http://127.0.0.1:5189/messages/'+seed.other);
  await page.locator('[data-actions-bubble="edit-me"]').waitFor();
  console.log('ROUTE',page.url(), await page.locator('textarea').count());
  await page.getByPlaceholder('Type a message...').fill('Unsent draft stays here');
  const original=await page.locator('[data-actions-bubble="edit-me"]').boundingBox();
  await page.locator('[data-actions-bubble="edit-me"]').click({button:'right'});
  await page.getByRole('menuitem',{name:'Edit',exact:true}).click();
  await page.getByRole('textbox',{name:'Message text'}).waitFor();
  await page.waitForTimeout(350);
  const edit=await page.getByRole('textbox',{name:'Message text'}).boundingBox();
  console.log('SIZES',JSON.stringify({original,edit}));
  assert.ok(edit.height<50,'one-line editor must be compact');
  assert.ok(Math.abs(edit.width-original.width)<20,'short editor matches bubble width');
  assert.equal(await page.locator('[role="dialog"]').count(),0);
  assert.equal(await page.getByText(/5 minutes after/).count(),0);
  await page.screenshot({path:'artifacts.local/dm-inline-edit.png'});
  await page.getByRole('textbox',{name:'Message text'}).fill('A longer message that wraps naturally onto multiple lines while keeping the compact inline bubble style.');
  assert.ok((await page.getByRole('textbox',{name:'Message text'}).boundingBox()).height>edit.height);
  await page.screenshot({path:'artifacts.local/dm-inline-edit-expanded.png'});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  console.log('CANCEL PASS');
  assert.equal(await page.getByPlaceholder('Type a message...').inputValue(),'Unsent draft stays here');
  assert.equal(await page.locator('[data-actions-bubble="edit-me"]').textContent(),'See you at 9');
  await page.locator('[data-actions-bubble="edit-me"]').click({button:'right'});
  await page.getByRole('menuitem',{name:'Edit',exact:true}).click();
  await page.getByRole('textbox',{name:'Message text'}).fill('See you at 9:30');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForTimeout(400);
  console.log('AFTER SAVE',await page.locator('[data-chat-edit]').allTextContents(), await page.locator('[role="alert"]').allTextContents());
  await page.locator('[data-actions-bubble="edit-me"]').waitFor();
  assert.match(await page.locator('[data-actions-bubble="edit-me"]').textContent(),/See you at 9:30.*Edited/);
  assert.equal(await page.getByPlaceholder('Type a message...').inputValue(),'Unsent draft stays here');
  for (const id of ['incoming','old']) {
    await page.locator('[data-actions-bubble="'+id+'"]').click({button:'right'});
    assert.equal(await page.getByRole('menuitem',{name:'Edit',exact:true}).count(),0);
    await page.keyboard.press('Escape');await page.waitForTimeout(300);
  }
  console.log('DM PASS');
  await page.goto('http://127.0.0.1:5189/messages/round/'+seed.round);
  await page.locator('[data-actions-bubble="round-edit"]').waitFor();
  await page.locator('[data-actions-bubble="round-edit"]').click({button:'right'});
  await page.getByRole('menuitem',{name:'Edit',exact:true}).click();
  await page.waitForTimeout(350);
  await page.screenshot({path:'artifacts.local/round-inline-edit.png'});
  await page.getByRole('textbox',{name:'Message text'}).fill('Meet by the practice green');
  await page.getByRole('textbox',{name:'Message text'}).press('Control+Enter');
  await page.locator('[data-actions-bubble="round-edit"]').waitFor();
  assert.match(await page.locator('[data-actions-bubble="round-edit"]').textContent(),/Meet by the practice green.*Edited/);
  console.log('PASS: real demo DM and round integration, compact dimensions, growth, cancel, repeat edit/save, ownership/expiry offer, preserved composer draft.',errors);
  await page.goto('http://127.0.0.1:5189/scripts/fixtures/message-edit-harness.html');
  const field=page.getByRole('textbox',{name:'Message text'});
  const save=page.getByRole('button',{name:'Save',exact:true});
  const reset=async(result='failed')=>{await page.evaluate(result=>{window.qa.reset();window.qa.result(result);},result);await field.waitFor();};
  await field.fill(' ');
  assert.equal(await save.isDisabled(),true);
  await field.fill('x'.repeat(4000));
  assert.ok((await field.boundingBox()).height<=160);
  assert.ok(await field.evaluate(el=>el.scrollHeight>el.clientHeight));
  for (const width of [320,1440]) {
    await page.setViewportSize({width,height:844});
    await field.fill('A long inline draft '.repeat(15));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal overflow at '+width+'px');
  }
  await page.setViewportSize({width:390,height:844});
  await reset('failed');
  await field.fill('Keep my draft');
  await save.click();
  assert.match(await page.getByRole('alert').textContent(),/Couldn't save/);
  assert.equal(await field.inputValue(),'Keep my draft');
  await page.evaluate(()=>window.qa.result('edited'));
  await save.click();await page.getByText('Closed',{exact:true}).waitFor();
  await reset('expired');
  await field.fill('Expired draft');
  await save.click();
  assert.equal(await field.inputValue(),'Expired draft');
  assert.equal(await field.getAttribute('readonly'),'');
  assert.equal(await page.getByRole('button',{name:'Copy text',exact:true}).count(),1);
  assert.doesNotMatch(await page.getByRole('alert').textContent(),/5 minutes/);
  await reset('conflict');
  await field.fill('Keep the revision');
  await save.click();
  assert.match(await page.getByRole('alert').textContent(),/another device/);
  await page.evaluate(()=>window.qa.result('edited'));
  await save.click();
  assert.deepEqual(await page.evaluate(()=>window.qa.calls()),['Original',undefined]);
  await reset();
  await field.fill('Retained after unsend');
  await page.evaluate(()=>window.qa.gone());
  assert.equal(await field.inputValue(),'Retained after unsend');
  assert.equal(await save.count(),0);
  await reset('pending');
  await field.fill('Awaiting save');
  await field.dispatchEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true});
  assert.equal(await page.evaluate(()=>window.qa.calls().length),0);
  await save.evaluate(el=>{el.click();el.click();});
  assert.equal(await page.evaluate(()=>window.qa.calls().length),1);
  assert.equal(await field.getAttribute('readonly'),'');
  await reset('edited');
  await page.evaluate(()=>window.qa.resolve());
  await field.waitFor();
  assert.equal(await field.inputValue(),'Original','late response cannot close a newer editor');
  await field.press('Escape');
  await page.getByText('Closed',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: failure/retry, expiry, conflict/retry, unsent draft retention, empty/long text, IME, duplicate save, late response and Escape.');

} finally {
  await browser.close();await server.close();
}

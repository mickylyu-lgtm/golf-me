
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
  const composer = page.getByPlaceholder(/^(Type a message|Message the group)\.\.\.$/);
  const editor = page.getByRole('textbox', { name: 'Message text' });
  const paused = page.locator('[data-chat-composer-paused]');
  const enterEdit = async id => {
    await page.locator('[data-actions-bubble="'+id+'"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await editor.waitFor();
    await page.waitForTimeout(180);
  };
  const assertExclusive = async draft => {
    assert.equal(await composer.isDisabled(), true, 'normal composer is disabled');
    assert.equal(await composer.inputValue(), draft, 'unsent draft stays mounted');
    assert.equal(await page.getByRole('textbox').count(), 1, 'only the editor is accessible');
    assert.equal(await paused.locator('[inert]').count(), 1, 'all composer controls are inert');
    assert.equal(await paused.locator('[aria-hidden="true"][inert]').count(), 1);
    assert.equal(await paused.locator('[inert]').evaluate(el => getComputedStyle(el).opacity), '0.25');
    await editor.focus();
    await composer.evaluate(el => el.focus());
    assert.equal(await editor.evaluate(el => document.activeElement === el), true, 'programmatic composer focus cannot steal edit focus');
    for (let i = 0; i < 3; i++) await page.locator('[data-chat-composer-shield]').click();
    assert.equal(await editor.evaluate(el => document.activeElement === el), true, 'taps on the dimmed composer keep edit focus');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await paused.evaluate(el => el.contains(document.activeElement)), false, 'Tab skips all paused controls');
    }
    await editor.focus();
    await paused.locator('button[aria-label="Send message"]').evaluate(el => el.click());
    await composer.dispatchEvent('keydown', { key: 'Enter' });
    assert.equal(await composer.inputValue(), draft, 'attempted send does not clear draft');
    assert.equal(await editor.count(), 1, 'attempted send does not close editor');
  };
  const assertRestored = async draft => {
    assert.equal(await paused.count(), 0);
    assert.equal(await composer.isDisabled(), false);
    assert.equal(await composer.inputValue(), draft);
    assert.equal(await page.locator('[data-chat-composer-shield]').count(), 0);
  };

  await page.goto('http://127.0.0.1:5189/messages/'+seed.other);
  await page.locator('[data-actions-bubble="edit-me"]').waitFor();
  await composer.fill('Unsent draft stays here');
  const original = await page.locator('[data-actions-bubble="edit-me"]').boundingBox();
  const composerHeight = await composer.locator('xpath=ancestor::div[@data-chat-composer-paused or contains(@class,"transition-opacity")]').first().evaluate(el => el.getBoundingClientRect().height);
  await enterEdit('edit-me');
  const edit = await editor.boundingBox();
  assert.ok(edit.height < 50, 'one-line editor must be compact');
  assert.ok(Math.abs(edit.width-original.width) < 20, 'short editor matches bubble width');
  assert.equal(await page.locator('[role="dialog"]').count(), 0);
  assert.equal(await page.getByText(/5 minutes after/).count(), 0);
  await assertExclusive('Unsent draft stays here');
  assert.equal(await paused.locator('[inert]').evaluate(el => el.getBoundingClientRect().height), composerHeight, 'composer keeps its height');
  await page.screenshot({ path: 'artifacts.local/dm-inline-edit.png' });
  await editor.fill('A longer message that wraps naturally onto multiple lines while keeping the compact inline bubble style.');
  assert.ok((await editor.boundingBox()).height > edit.height);
  await page.screenshot({ path: 'artifacts.local/dm-inline-edit-expanded.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await assertRestored('Unsent draft stays here');
  assert.equal(await page.locator('[data-actions-bubble="edit-me"]').textContent(), 'See you at 9');
  // A blocked send must not acquire the send guard: the restored draft sends once.
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText('Unsent draft stays here', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-actions-bubble]').filter({ hasText: 'Unsent draft stays here' }).count(), 1);
  await composer.fill('Another unsent draft');
  await enterEdit('edit-me');
  await assertExclusive('Another unsent draft');
  await editor.fill('See you at 9:30');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('[data-actions-bubble="edit-me"]').waitFor();
  assert.match(await page.locator('[data-actions-bubble="edit-me"]').textContent(), /See you at 9:30.*Edited/);
  await assertRestored('Another unsent draft');
  for (const id of ['incoming', 'old']) {
    await page.locator('[data-actions-bubble="'+id+'"]').click({ button: 'right' });
    assert.equal(await page.getByRole('menuitem', { name: 'Edit', exact: true }).count(), 0);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
  // Preserve a quote and picked image through Escape/cancel; neither is interactable in edit mode.
  await page.locator('[data-actions-bubble="incoming"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click();
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1cAAAAASUVORK5CYII=','base64')});
  await page.locator('[data-media-chip="image"] img').waitFor();
  const replyBefore = await page.locator('button[aria-label="Cancel reply"]').locator('..').textContent();
  const photoBefore = await page.locator('[data-media-chip="image"] img').getAttribute('src');
  await enterEdit('edit-me');
  await assertExclusive('Another unsent draft');
  await editor.press('Escape');
  await assertRestored('Another unsent draft');
  assert.equal(await page.locator('button[aria-label="Cancel reply"]').locator('..').textContent(), replyBefore);
  assert.equal(await page.locator('[data-media-chip="image"] img').getAttribute('src'), photoBefore);
  await page.getByRole('button', {name:'Remove photo', exact:true}).click();
  await page.getByRole('button', {name:'Cancel reply', exact:true}).click();
  // Voice mode stays mounted. This only toggles UI, never opens the microphone.
  const voiceToggle = page.locator('[data-chat-voice-toggle]');
  if (await voiceToggle.count()) {
    await voiceToggle.click();
    assert.equal(await voiceToggle.getAttribute('aria-pressed'), 'true');
    await enterEdit('edit-me');
    await editor.press('Escape');
    assert.equal(await voiceToggle.getAttribute('aria-pressed'), 'true');
    await voiceToggle.click();
    await assertRestored('Another unsent draft');
  }
  // An open desktop emoji popup closes before edit can take focus.
  await page.setViewportSize({width:1024,height:844});
  await page.getByRole('button',{name:'Add emoji',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Add emoji',exact:true}).getAttribute('aria-expanded'),'true');
  await enterEdit('edit-me');
  assert.equal(await paused.locator('button[aria-label="Add emoji"]').getAttribute('aria-expanded'),'false');
  assert.equal(await editor.evaluate(el=>document.activeElement===el),true);
  await editor.press('Escape');
  await page.setViewportSize({width:390,height:844});
  console.log('PASS: DM only editor active, focus/shield/Tab, draft/save/cancel/Escape, one restored send, reply/photo/voice mode, emoji closure, ownership/expiry offers.');

  // Same shared behavior in fullscreen round chat and the embedded round-detail card.
  for (const layout of ['fullscreen','card']) {
    await page.goto('http://127.0.0.1:5189/'+(layout==='fullscreen'?'messages/round/':'golf-calls/')+seed.round);
    await page.locator('[data-actions-bubble="round-edit"]').waitFor();
    await composer.fill('Round draft stays here');
    await enterEdit('round-edit');
    await assertExclusive('Round draft stays here');
    if (layout==='fullscreen') await page.screenshot({path:'artifacts.local/round-inline-edit.png'});
    await editor.fill(layout==='fullscreen'?'Meet by the practice green':'Meet by the first tee');
    await editor.press('Control+Enter');
    await page.locator('[data-actions-bubble="round-edit"]').waitFor();
    await assertRestored('Round draft stays here');
    await enterEdit('round-edit');
    await assertExclusive('Round draft stays here');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await assertRestored('Round draft stays here');
  }
  console.log('PASS: fullscreen and card round edit isolation, preserved draft and restore after save/cancel.');
  await page.goto('http://127.0.0.1:5189/scripts/fixtures/message-edit-harness.html');
  const field=page.getByRole('textbox',{name:'Message text'});
  const save=page.getByRole('button',{name:'Save',exact:true});
  const reset=async(result='failed')=>{await page.evaluate(result=>{window.qa.reset();window.qa.result(result);},result);await field.waitFor();};
  await assertExclusive('Fixture draft stays here');
  await field.fill(' ');
  assert.equal(await save.isDisabled(),true);
  await field.fill('x'.repeat(4000));
  assert.ok((await field.boundingBox()).height<=160);
  assert.ok(await field.evaluate(el=>el.scrollHeight>el.clientHeight));
  for (const width of [320,1440]) {
    await page.setViewportSize({width,height:844});
    await field.fill('A long inline draft '.repeat(15));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const overflow = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth, nodes: [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).map(el => ({ tag: el.tagName, cls: el.className, right: el.getBoundingClientRect().right })).slice(0, 5) }));
    assert.ok(overflow.scroll <= overflow.width, 'no horizontal overflow at '+width+'px '+JSON.stringify(overflow));
  }
  await page.setViewportSize({width:390,height:844});
  await reset('failed');
  await field.fill('Keep my draft');
  await save.click();
  assert.match(await page.getByRole('alert').textContent(),/Couldn't save/);
  await assertExclusive('Fixture draft stays here');
  assert.equal(await field.inputValue(),'Keep my draft');
  await page.evaluate(()=>window.qa.result('edited'));
  await save.click();await page.getByText('Closed',{exact:true}).waitFor();
  await assertRestored('Fixture draft stays here');
  await reset('expired');
  await field.fill('Expired draft');
  await save.click();
  assert.equal(await field.inputValue(),'Expired draft');
  assert.equal(await field.getAttribute('readonly'),'');
  assert.equal(await page.getByRole('button',{name:'Copy text',exact:true}).count(),1);
  assert.doesNotMatch(await page.getByRole('alert').textContent(),/5 minutes/);
  await assertExclusive('Fixture draft stays here');
  await reset('conflict');
  await field.fill('Keep the revision');
  await save.click();
  assert.match(await page.getByRole('alert').textContent(),/another device/);
  await assertExclusive('Fixture draft stays here');
  await page.evaluate(()=>window.qa.result('edited'));
  await save.click();
  assert.deepEqual(await page.evaluate(()=>window.qa.calls()),['Original',undefined]);
  await reset();
  await field.fill('Retained after unsend');
  await page.evaluate(()=>window.qa.gone());
  assert.equal(await field.inputValue(),'Retained after unsend');
  assert.equal(await save.count(),0);
  await assertExclusive('Fixture draft stays here');
  await reset('pending');
  await field.fill('Awaiting save');
  await field.dispatchEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true});
  assert.equal(await page.evaluate(()=>window.qa.calls().length),0);
  await save.evaluate(el=>{el.click();el.click();});
  assert.equal(await page.evaluate(()=>window.qa.calls().length),1);
  assert.equal(await field.getAttribute('readonly'),'');
  await assertExclusive('Fixture draft stays here');
  await reset('edited');
  await page.evaluate(()=>window.qa.resolve());
  await field.waitFor();
  assert.equal(await field.inputValue(),'Original','late response cannot close a newer editor');
  await field.press('Escape');
  await page.getByText('Closed',{exact:true}).waitFor();
  await assertRestored('Fixture draft stays here');
  assert.deepEqual(errors,[]);
  console.log('PASS: failure/retry, expiry, conflict/retry, unsent draft retention, empty/long text, IME, duplicate save, late response and Escape.');

} finally {
  await browser.close();await server.close();
}

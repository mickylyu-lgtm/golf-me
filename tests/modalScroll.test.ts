import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lockPageScroll, isPageScrollLocked } from '../src/lib/scrollLock.ts';

test('every shared modal frame acquires one page lock, not just keyboard variants', () => {
 const source=readFileSync(new URL('../src/components/ui/Modal.tsx',import.meta.url),'utf8');
 const frame=source.slice(source.indexOf('function ModalFrame('),source.indexOf('function KeyboardAwareModal('));
 assert.match(frame,/useLayoutEffect\(\(\) => lockPageScroll\(\), \[\]\)/);
 assert.equal((source.match(/=> lockPageScroll\(\)/g)||[]).length,1);
 assert.match(frame,/min-h-0 flex-1 overflow-y-auto overscroll-contain/);
});

test('nested modal teardown preserves preexisting overflow and never writes scroll position',()=>{
 for(const overflow of ['', 'auto', 'hidden']){
  const body={style:{overflow},scrollTop:420};
  const parent=lockPageScroll(body);const child=lockPageScroll(body);
  parent();assert.equal(body.style.overflow,'hidden');
  child();assert.equal(body.style.overflow,overflow);assert.equal(body.scrollTop,420);
  assert.equal(isPageScrollLocked(),false);
 }
});

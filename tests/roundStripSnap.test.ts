import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachRoundStripSnap} from '../src/lib/roundStripSnap.ts';
function fixture(reduced=false){
 const listeners=new Map<string,Function>();const calls:any[]=[];
 const strip:any={scrollLeft:0,scrollWidth:1450,clientWidth:390,style:{scrollSnapType:'',touchAction:''},getBoundingClientRect:()=>({left:0}),addEventListener:(n:string,f:Function)=>listeners.set(n,f),removeEventListener:(n:string)=>listeners.delete(n),scrollTo:(p:any)=>{calls.push(p);strip.scrollLeft=p.left;}};
 strip.children=[0,350,700,1050].map(left=>({getBoundingClientRect:()=>({left:left+16-strip.scrollLeft})}));
 globalThis.getComputedStyle=(()=>({scrollPaddingLeft:'16px'})) as any;
 globalThis.matchMedia=(()=>({matches:reduced})) as any;
 const dispose=attachRoundStripSnap(strip);
 const fire=(name:string,x=200,y=100,count=1,cancelable=true)=>{let prevented=false;listeners.get(name)?.({touches:Array.from({length:count},()=>({clientX:x,clientY:y})),cancelable,detail:1,preventDefault:()=>{prevented=true;},stopPropagation:()=>{}});return prevented;};
 return {strip,calls,fire,dispose,listeners};
}
test('light intentional horizontal swipe advances one measured card, long fling never skips',()=>{for(const delta of [15,16,24,50,900]){const f=fixture();f.fire('touchstart');assert.equal(f.fire('touchmove',200-delta),true);f.fire('touchend');assert.equal(f.strip.scrollLeft,350);assert.equal(f.strip.style.scrollSnapType,'');assert.equal(f.fire('click'),true);}});
test('tiny horizontal drag returns to original card and ordinary tap is untouched',()=>{for(const delta of [8,10,12,14]){const f=fixture();f.fire('touchstart');f.fire('touchmove',200-delta);f.fire('touchend');assert.equal(f.strip.scrollLeft,0);assert.equal(f.fire('click'),true);f.fire('touchstart');f.fire('touchend');assert.equal(f.fire('click'),false);}});
test('vertical and ambiguous diagonal gestures never prevent native scrolling',()=>{for(const [x,y] of [[198,150],[180,120]]){const f=fixture();f.fire('touchstart');assert.equal(f.fire('touchmove',x,y),false);f.fire('touchend');assert.equal(f.calls.length,0);assert.equal(f.fire('click'),false);}});
test('reverse swipe and endpoints clamp one card, reduced motion is instant',()=>{const f=fixture(true);f.strip.scrollLeft=700;f.fire('touchstart');f.fire('touchmove',230);f.fire('touchend');assert.equal(f.strip.scrollLeft,350);assert.equal(f.calls[0].behavior,'instant');f.strip.scrollLeft=0;f.fire('touchstart');f.fire('touchmove',230);f.fire('touchend');assert.equal(f.strip.scrollLeft,0);});
test('touchcancel, multitouch and noncancelable events return without advancing',()=>{for(const reason of ['touchcancel','multi','noncancelable']){const f=fixture();f.fire('touchstart');f.fire('touchmove',160);if(reason==='touchcancel')f.fire('touchcancel');else f.fire('touchmove',150,100,reason==='multi'?2:1,reason!=='noncancelable');f.fire('touchend');assert.equal(f.strip.scrollLeft,0);}});
test('cleanup removes listeners and restores snap without navigating',()=>{const f=fixture();f.fire('touchstart');f.fire('touchmove',170);f.dispose();assert.equal(f.listeners.size,0);assert.equal(f.strip.style.touchAction,'');assert.equal(f.strip.style.scrollSnapType,'');assert.equal(f.calls.length,0);});

test('coalesced tiny drag at touchend snaps back and cannot click card',()=>{const f=fixture();f.fire('touchstart');f.listeners.get('touchend')!({changedTouches:[{clientX:188,clientY:100}]});assert.equal(f.strip.scrollLeft,0);assert.equal(f.fire('click'),true);});

test('coalesced 15px swipe advances in either direction from touchend coordinates',()=>{for(const dx of [-15,15]){const f=fixture();f.strip.scrollLeft=350;f.fire('touchstart');f.listeners.get('touchend')!({changedTouches:[{clientX:200+dx,clientY:102}]});assert.equal(f.strip.scrollLeft,dx<0?700:0);assert.equal(f.fire('click'),true);}});

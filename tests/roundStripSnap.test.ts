import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachRoundStripSnap} from '../src/lib/roundStripSnap.ts';
function fixture(reduced=false){
 const listeners=new Map<string,Function>();const calls:any[]=[];
 const strip:any={scrollLeft:0,scrollWidth:1450,clientWidth:390,style:{scrollSnapType:'',touchAction:''},getBoundingClientRect:()=>({left:0}),addEventListener:(n:string,f:Function)=>listeners.set(n,f),removeEventListener:(n:string)=>listeners.delete(n),scrollTo:(p:any)=>{calls.push(p);strip.scrollLeft=p.left;}};
 strip.children=[0,350,700,1050].map(left=>({getBoundingClientRect:()=>({left:left+16-strip.scrollLeft})}));
 globalThis.getComputedStyle=(()=>({scrollPaddingLeft:'16px'})) as any;
 globalThis.matchMedia=(()=>({matches:reduced})) as any;
 let clock=performance.now(), ticket=0;
 const frames=new Map<number,FrameRequestCallback>();
 globalThis.requestAnimationFrame=cb=>{frames.set(++ticket,cb);return ticket;};
 globalThis.cancelAnimationFrame=id=>{frames.delete(id);};
 const frame=(ms=16)=>{clock+=ms;const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn(clock));};
 const flush=()=>{for(let i=0;frames.size&&i<30;i++)frame();assert.equal(frames.size,0);};
 const dispose=attachRoundStripSnap(strip);
 const fire=(name:string,x=200,y=100,count=1,cancelable=true)=>{let prevented=false;listeners.get(name)?.({touches:Array.from({length:count},()=>({clientX:x,clientY:y})),cancelable,detail:1,preventDefault:()=>{prevented=true;},stopPropagation:()=>{}});return prevented;};
 return {strip,calls,fire,dispose,listeners,frame,flush,frames};
}
test('light intentional horizontal swipe advances one measured card, long fling never skips',()=>{for(const delta of [15,16,24,50,900]){const f=fixture();f.fire('touchstart');assert.equal(f.fire('touchmove',200-delta),true);f.fire('touchend');f.flush();assert.equal(f.strip.scrollLeft,350);assert.equal(f.strip.style.scrollSnapType,'');assert.equal(f.fire('click'),true);}});
test('tiny horizontal drag returns to original card and ordinary tap is untouched',()=>{for(const delta of [8,10,12,14]){const f=fixture();f.fire('touchstart');f.fire('touchmove',200-delta);f.fire('touchend');f.flush();assert.equal(f.strip.scrollLeft,0);assert.equal(f.fire('click'),true);f.fire('touchstart');f.fire('touchend');f.flush();assert.equal(f.fire('click'),false);}});
test('vertical and ambiguous diagonal gestures never prevent native scrolling',()=>{for(const [x,y] of [[198,150],[180,120]]){const f=fixture();f.fire('touchstart');assert.equal(f.fire('touchmove',x,y),false);f.fire('touchend');f.flush();assert.equal(f.calls.length,0);assert.equal(f.fire('click'),false);}});
test('reverse swipe and endpoints clamp one card, reduced motion is instant',()=>{const f=fixture(true);f.strip.scrollLeft=700;f.fire('touchstart');f.fire('touchmove',230);f.fire('touchend');f.flush();assert.equal(f.strip.scrollLeft,350);assert.equal(f.calls[0].behavior,'instant');f.strip.scrollLeft=0;f.fire('touchstart');f.fire('touchmove',230);f.fire('touchend');f.flush();assert.equal(f.strip.scrollLeft,0);});
test('touchcancel, multitouch and noncancelable events return without advancing',()=>{for(const reason of ['touchcancel','multi','noncancelable']){const f=fixture();f.fire('touchstart');f.fire('touchmove',160);if(reason==='touchcancel')f.fire('touchcancel');else f.fire('touchmove',150,100,reason==='multi'?2:1,reason!=='noncancelable');f.fire('touchend');f.flush();assert.equal(f.strip.scrollLeft,0);}});
test('cleanup removes listeners and restores snap without navigating',()=>{const f=fixture();f.fire('touchstart');f.fire('touchmove',170);f.dispose();assert.equal(f.listeners.size,0);assert.equal(f.strip.style.touchAction,'');assert.equal(f.strip.style.scrollSnapType,'');assert.equal(f.calls.length,0);});

test('coalesced tiny drag at touchend snaps back and cannot click card',()=>{const f=fixture();f.fire('touchstart');f.listeners.get('touchend')!({changedTouches:[{clientX:188,clientY:100}]});f.flush();assert.equal(f.strip.scrollLeft,0);assert.equal(f.fire('click'),true);});

test('coalesced 15px swipe advances in either direction from touchend coordinates',()=>{for(const dx of [-15,15]){const f=fixture();f.strip.scrollLeft=350;f.fire('touchstart');f.listeners.get('touchend')!({changedTouches:[{clientX:200+dx,clientY:102}]});f.flush();assert.equal(f.strip.scrollLeft,dx<0?700:0);assert.equal(f.fire('click'),true);}});

test('drag writes latest touch once per frame; release is monotonic with native snap off until exact arrival',()=>{
 const f=fixture();f.fire('touchstart');f.fire('touchmove',165);f.fire('touchmove',150);
 assert.equal(f.frames.size,1);assert.equal(f.strip.scrollLeft,0);f.frame();assert.equal(f.strip.scrollLeft,50);
 f.fire('touchend');assert.equal(f.strip.style.scrollSnapType,'none');
 let previous=50;for(let i=0;i<5;i++){f.frame();assert.ok(f.strip.scrollLeft>previous && f.strip.scrollLeft<350);assert.equal(f.strip.style.scrollSnapType,'none');previous=f.strip.scrollLeft;}
 f.flush();assert.equal(f.strip.scrollLeft,350);assert.equal(f.strip.style.scrollSnapType,'');
});
test('rapid forward retouch interrupts easing without a jump or dropping the next card',()=>{
 const f=fixture();f.fire('touchstart');f.fire('touchmove',180);f.frame();f.fire('touchend');f.frame();
 const visible=f.strip.scrollLeft;assert.ok(visible>20 && visible<175);
 f.fire('touchstart');f.fire('touchmove',182);assert.equal(f.strip.scrollLeft,visible);
 f.frame();assert.equal(f.strip.scrollLeft,visible+18);f.fire('touchend');f.flush();assert.equal(f.strip.scrollLeft,700);
});
test('cleanup cancels scheduled animation and restores CSS snap',()=>{
 const f=fixture();f.fire('touchstart');f.fire('touchmove',180);f.frame();f.fire('touchend');assert.equal(f.frames.size,1);
 f.dispose();assert.equal(f.frames.size,0);assert.equal(f.strip.style.scrollSnapType,'');
});

test('three swipes before the first page arrives preserve the visual position',()=>{
 const f=fixture();
 for(let i=0;i<3;i++){
   const visible=f.strip.scrollLeft;assert.ok(visible<350);
   f.fire('touchstart');f.fire('touchmove',181);f.frame(1);
   assert.equal(f.strip.scrollLeft,visible+19);
   f.fire('touchend');
 }
 f.flush();assert.equal(f.strip.scrollLeft,1050);
});

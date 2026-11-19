const SWIPE_ADVANCE_PX = 15;

/** Home-only touch paging. Native mouse/trackpad/keyboard scrolling keeps CSS snapping. */
export function attachRoundStripSnap(strip: HTMLElement) {
  let gesture: { x:number; y:number; start:number; index:number; points:number[]; axis:'pending'|'x'|'y'; dx:number } | null = null;
  let suppressClickUntil = 0;
  const originalSnap = strip.style.scrollSnapType;
  const originalTouchAction = strip.style.touchAction;
  strip.style.touchAction = 'pan-y pinch-zoom';
  const points = () => {
    const padding = parseFloat(getComputedStyle(strip).scrollPaddingLeft) || 0;
    const left = strip.getBoundingClientRect().left;
    const max = Math.max(0, strip.scrollWidth - strip.clientWidth);
    return [...strip.children].map(child => Math.max(0, Math.min(max, child.getBoundingClientRect().left - left + strip.scrollLeft - padding)));
  };
  const finish = (cancelled: boolean) => {
    const g = gesture; gesture = null;
    if (!g || g.axis !== 'x') return;
    const step = !cancelled && Math.abs(g.dx) >= SWIPE_ADVANCE_PX ? (g.dx < 0 ? 1 : -1) : 0;
    const index = Math.max(0, Math.min(g.points.length - 1, g.index + step));
    strip.style.scrollSnapType = originalSnap;
    strip.scrollTo({left:g.points[index], behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    suppressClickUntil = Date.now() + 500;
  };
  const start = (event: TouchEvent) => {
    if (event.touches.length !== 1) { finish(true); return; }
    // A new deliberate tap is not a ghost click from the previous swipe.
    suppressClickUntil = 0;
    const p = points(); if (!p.length) return;
    const index = p.reduce((best, value, i) => Math.abs(value-strip.scrollLeft)<Math.abs(p[best]-strip.scrollLeft)?i:best,0);
    const touch = event.touches[0];
    gesture = {x:touch.clientX,y:touch.clientY,start:strip.scrollLeft,index,points:p,axis:'pending',dx:0};
  };
  const move = (event: TouchEvent) => {
    if (event.touches.length !== 1) { finish(true); return; }
    const g = gesture; if (!g) return;
    const dx = event.touches[0].clientX-g.x, dy = event.touches[0].clientY-g.y;
    if (g.axis === 'pending' && Math.max(Math.abs(dx),Math.abs(dy)) >= 8) {
      g.axis = Math.abs(dx) > Math.abs(dy)*1.2 ? 'x' : 'y';
      if (g.axis === 'x') strip.style.scrollSnapType = 'none';
    }
    if (g.axis !== 'x') return;
    if (!event.cancelable) { finish(true); return; }
    event.preventDefault(); g.dx = dx;
    // Track the finger without allowing a long fling to skip multiple cards.
    const lo = g.points[Math.max(0,g.index-1)], hi = g.points[Math.min(g.points.length-1,g.index+1)];
    strip.scrollLeft = Math.max(lo,Math.min(hi,g.start-dx));
  };
  const end = (event: TouchEvent) => {
    // Browsers may coalesce every move below their native touch slop. Read the
    // final coordinate too, so a small drag cannot become an accidental tap.
    const g = gesture, touch = event.changedTouches?.[0];
    if (g && touch && g.axis !== 'y') {
      const dx = touch.clientX-g.x, dy = touch.clientY-g.y;
      if (g.axis === 'x' || (Math.abs(dx)>=8 && Math.abs(dx)>Math.abs(dy)*1.2)) {
        g.axis='x'; g.dx=dx;
      }
    }
    finish(false);
  };
  const cancel = () => finish(true);
  const click = (event: MouseEvent) => { if (event.detail !== 0 && Date.now()<suppressClickUntil) {event.preventDefault();event.stopPropagation();} };
  strip.addEventListener('touchstart',start,{passive:true});
  strip.addEventListener('touchmove',move,{passive:false});
  strip.addEventListener('touchend',end);
  strip.addEventListener('touchcancel',cancel);
  strip.addEventListener('click',click,true);
  return () => {
    gesture=null; strip.style.scrollSnapType=originalSnap; strip.style.touchAction=originalTouchAction;
    strip.removeEventListener('touchstart',start); strip.removeEventListener('touchmove',move);
    strip.removeEventListener('touchend',end); strip.removeEventListener('touchcancel',cancel); strip.removeEventListener('click',click,true);
  };
}
